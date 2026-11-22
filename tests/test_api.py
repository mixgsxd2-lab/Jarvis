from datetime import datetime, timedelta

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

from jarvis import push
from jarvis.models import Event, utcnow
from jarvis.util import fold, occurrences, parse_when


# ---------------------------------------------------------------- login seguro
def test_signup_login_logout_and_csrf(client):
    assert client.get("/api/auth/state").json == {"authenticated": False, "signup": True}
    assert client.post("/api/auth/register", json={"username": "ab", "password": "x"}).status_code == 400
    r = client.post("/api/auth/register", json={"username": "tony", "password": "senha-forte-123"})
    assert r.status_code == 200
    csrf = r.json["csrf"]
    # sem token CSRF, alterações são recusadas
    assert client.post("/api/items", json={"kind": "task", "title": "x"}).status_code == 403
    assert client.post("/api/items", json={"kind": "task", "title": "x"}, headers={"X-CSRF-Token": csrf}).status_code == 201
    client.post("/api/auth/logout")
    assert client.get("/api/items").status_code == 401
    # segundo cadastro fechado por padrão
    assert client.post("/api/auth/register", json={"username": "outro", "password": "senha-forte-123"}).status_code == 403
    assert client.post("/api/auth/login", json={"username": "tony", "password": "errada!!"}).status_code == 401
    assert client.post("/api/auth/login", json={"username": "tony", "password": "senha-forte-123"}).status_code == 200


def test_login_rate_limit(client, user):
    client.post("/api/auth/logout")
    for _ in range(8):
        client.post("/api/auth/login", json={"username": "tony", "password": "errada!!"})
    assert client.post("/api/auth/login", json={"username": "tony", "password": "senha-forte-123"}).status_code == 429


def test_password_change_invalidates_other_sessions(app, user):
    other = app.test_client()
    assert other.post("/api/auth/login", json={"username": "tony", "password": "senha-forte-123"}).status_code == 200
    r = user.post("/api/auth/password", json={"current": "senha-forte-123", "new": "nova-senha-456"})
    assert r.status_code == 200
    user.csrf = r.json["csrf"]
    assert other.get("/api/items").status_code == 401
    assert user.get("/api/items").status_code == 200


# ---------------------------------------------------------------- Meu Espaço
def test_items_subtasks_convert_keeps_original(user):
    idea = user.post("/api/items", json={"kind": "idea", "title": "App de receitas", "body": "detalhes"}).json
    sub = user.post("/api/items", json={"kind": "subtask", "title": "Pesquisar APIs", "parent_id": idea["id"]})
    assert sub.status_code == 201
    proj = user.post(f"/api/items/{idea['id']}/convert", json={"to": "project"}).json
    assert proj["kind"] == "project" and proj["origin"]["id"] == idea["id"]
    assert proj["body"] == "detalhes" and len(proj["children"]) == 1
    original = user.get(f"/api/items/{idea['id']}").json
    assert original["title"] == "App de receitas" and original["status"] == "convertida"
    assert original["derived"][0]["id"] == proj["id"]
    # autosave: PATCH parcial
    r = user.patch(f"/api/items/{proj['id']}", json={"body": "novo texto", "tags": "casa, app"})
    assert r.json["body"] == "novo texto" and r.json["tags"] == ["casa", "app"]
    r = user.patch(f"/api/items/{proj['id']}", json={"status": "concluida"})
    assert r.json["done_at"]
    lst = user.get("/api/items?kind=project&top=1").json
    assert lst[0]["children_count"] == 1
    assert user.delete(f"/api/items/{proj['id']}").json["deleted"] == 2


def test_attachments(user):
    from io import BytesIO
    it = user.post("/api/items", json={"kind": "note", "title": "Nota"}).json
    r = user.post(f"/api/items/{it['id']}/attachments",
                  data={"file": (BytesIO(b"conteudo"), "arquivo.txt")}, content_type="multipart/form-data")
    assert r.status_code == 201
    aid = r.json["id"]
    d = user.get(f"/api/attachments/{aid}")
    assert d.data == b"conteudo"
    big = user.post(f"/api/items/{it['id']}/attachments",
                    data={"file": (BytesIO(b"x" * (5 * 1024 * 1024 + 10)), "grande.bin")}, content_type="multipart/form-data")
    assert big.status_code == 413


def test_general_search(user):
    user.post("/api/items", json={"kind": "note", "title": "Receita de bolo"})
    user.post("/api/memories", json={"content": "Gosto de bolo de cenoura"})
    r = user.get("/api/search?q=bolo").json
    assert len(r["items"]) == 1 and len(r["memories"]) == 1


def test_users_are_isolated(app, user):
    it = user.post("/api/items", json={"kind": "task", "title": "secreta"}).json
    app.config["ALLOW_SIGNUP"] = True
    other = app.test_client()
    r = other.post("/api/auth/register", json={"username": "pepper", "password": "senha-forte-123"})
    h = {"X-CSRF-Token": r.json["csrf"]}
    assert other.get(f"/api/items/{it['id']}").status_code == 404
    assert other.delete(f"/api/items/{it['id']}", headers=h).status_code == 404
    assert other.get("/api/items").json == []


# ---------------------------------------------------------------- Agenda
def test_events_recurrence_and_conflicts(user):
    r = user.post("/api/events", json={"title": "Daily", "start": "2030-01-07T09:00", "end": "2030-01-07T09:30",
                                       "recurrence": "weekdays"})
    assert r.status_code == 201
    occ = user.get("/api/events?start=2030-01-06T00:00&end=2030-01-13T00:00").json
    assert [o["occ_start"][:10] for o in occ] == ["2030-01-07", "2030-01-08", "2030-01-09", "2030-01-10", "2030-01-11"]
    chk = user.post("/api/events/check", json={"title": "Médico", "start": "2030-01-09T09:15", "end": "2030-01-09T10:00"}).json
    assert chk["conflicts"] and chk["conflicts"][0]["title"] == "Daily"
    ok = user.post("/api/events/check", json={"title": "Sábado", "start": "2030-01-12T09:15"}).json
    assert ok["conflicts"] == []


def test_monthly_recurrence_skips_short_months(app):
    with app.app_context():
        ev = Event(id=1, user_id=1, title="x", start=datetime(2030, 1, 31, 10), end=datetime(2030, 1, 31, 11),
                   recurrence="monthly", all_day=False)
        occ = occurrences(ev, datetime(2030, 1, 1), datetime(2030, 6, 1))
        assert [o[0].month for o in occ] == [1, 3, 5]


def test_reminders_alarms_and_tick(user):
    user.put("/api/settings", json={"timezone": "UTC"})
    past = (utcnow() - timedelta(minutes=1)).strftime("%Y-%m-%dT%H:%M")
    user.post("/api/reminders", json={"title": "Remédio", "at": past, "kind": "alarme", "repeat": "daily"})
    r = user.get("/api/tick").json
    assert r["notifications"][0]["title"] == "Remédio" and r["notifications"][0]["kind"] == "alarme"
    assert user.get("/api/tick").json["notifications"] == []  # não repete
    rem = user.get("/api/reminders").json[0]
    assert rem["at"] > past  # reagendado para amanhã


def test_event_reminder_notification(user):
    user.put("/api/settings", json={"timezone": "UTC"})
    start = (utcnow() + timedelta(minutes=10)).strftime("%Y-%m-%dT%H:%M")
    user.post("/api/events", json={"title": "Reunião", "start": start, "reminder_minutes": 15})
    n = user.get("/api/tick").json["notifications"]
    assert n and n[0]["title"] == "Reunião"


# ---------------------------------------------------------------- Assistente (regras) e confirmação
def test_assistant_requires_confirmation(user):
    r = user.say("crie uma tarefa pagar a conta de luz amanhã às 10h")
    assert r["pending"] and "Pagar a conta de luz" in r["pending"][0]["summary"]
    assert user.get("/api/items?kind=task").json == []  # nada alterado ainda
    pid = r["pending"][0]["id"]
    res = user.post(f"/api/assistant/confirm/{pid}", json={"accept": True}).json
    assert res["status"] == "done"
    tasks = user.get("/api/items?kind=task").json
    assert tasks[0]["title"] == "Pagar a conta de luz" and tasks[0]["due"].endswith("10:00:00")
    # confirmar de novo não duplica
    assert user.post(f"/api/assistant/confirm/{pid}", json={"accept": True}).json["status"] == "done"
    assert len(user.get("/api/items?kind=task").json) == 1


def test_assistant_voice_yes_no(user):
    user.say("lembre que eu prefiro café sem açúcar")
    assert user.get("/api/memories").json == []
    assert "Guardado" in user.say("sim")["reply"]
    assert user.get("/api/memories").json[0]["content"].startswith("Eu prefiro café")
    user.say("anote comprar pilhas")
    assert "cancelei" in user.say("não")["reply"]
    assert user.get("/api/items?kind=note").json == []


def test_assistant_commands(user):
    assert "graus" in user.say("como está o tempo em Curitiba?")["reply"]
    assert "Curitiba" in user.say("como está o tempo em Curitiba?")["reply"]
    q = user.say("qual a cotação do dólar?")["reply"]
    assert "Dólar" in q and "Euro" not in q
    assert "Notícia de teste" in user.say("quais as notícias?")["reply"]
    assert user.say("inicie um pomodoro")["client_actions"][0]["type"] == "pomodoro"
    t = user.say("temporizador de 5 minutos")["client_actions"][0]
    assert t["seconds"] == 300
    r = user.say("marque reunião com o time sexta às 14h30")
    assert r["pending"][0]["summary"].startswith("Agendar “Reunião com o time”")
    r = user.say("me lembre de ligar para a Ana às 15h")
    assert "ligar para a Ana" in r["pending"][0]["summary"]
    assert "Para que horas" in user.say("coloque um alarme")["reply"]
    assert user.say("abra o bloco de notas")["reply"].startswith("“bloco de notas” não está")


def test_assistant_history(user):
    user.say("que horas são")
    h = user.get("/api/assistant/history").json
    assert [m["role"] for m in h] == ["user", "assistant"]
    user.delete("/api/assistant/history")
    assert user.get("/api/assistant/history").json == []


def test_parse_when_portuguese():
    now = datetime(2026, 11, 22, 16, 0)  # domingo
    dt, rest, has = parse_when("pagar boleto amanhã às 10h", now)
    assert dt == datetime(2026, 11, 23, 10, 0) and rest == "pagar boleto" and has
    dt, _, _ = parse_when("reunião sexta às 14:30", now)
    assert dt == datetime(2026, 11, 27, 14, 30)
    dt, _, _ = parse_when("ligar em 20 minutos", now)
    assert dt == datetime(2026, 11, 22, 16, 20)
    dt, _, _ = parse_when("dentista dia 5 às 9 da manhã", now)
    assert dt == datetime(2026, 12, 5, 9, 0)
    dt, _, _ = parse_when("jantar às 8 da noite", now)
    assert dt == datetime(2026, 11, 22, 20, 0)
    dt, _, _ = parse_when("aniversário 25/12", now)
    assert dt == datetime(2026, 12, 25, 9, 0)
    assert parse_when("sem data nenhuma", now)[0] is None
    assert fold("Ação") == "acao"


# ---------------------------------------------------------------- Serviços
def test_services_endpoints_and_alerts(user):
    assert user.get("/api/weather").json["city"] == "São Paulo"
    assert len(user.get("/api/quotes").json) == 4
    assert user.post("/api/alerts", json={"symbol": "USD", "direction": "abaixo", "price": "5,50"}).status_code == 201
    assert user.post("/api/alerts", json={"symbol": "XXX", "direction": "acima", "price": 1}).status_code == 400
    n = user.get("/api/tick").json["notifications"]
    assert n and n[0]["kind"] == "alerta"
    assert user.get("/api/alerts").json[0]["active"] is False


def test_quote_providers_fallback(monkeypatch):
    from jarvis import services as s
    s.clear_cache()

    def fake_json(url, params=None, headers=None, timeout=8):
        if "yahoo" in url:
            raise RuntimeError("bloqueado")
        if "awesomeapi" in url:
            return {"USDBRL": {"bid": "5.2345", "pctChange": "0.5", "timestamp": "1700000000"}}
        raise RuntimeError("x")
    monkeypatch.setattr(s, "http_get_json", fake_json)
    q = s.quote("USD")
    assert q["price"] == 5.2345 and q["source"] == "AwesomeAPI"
    s.clear_cache()

    def yahoo(url, params=None, headers=None, timeout=8):
        return {"chart": {"result": [{"meta": {"regularMarketPrice": 27.0, "chartPreviousClose": 26.0},
                                      "timestamp": [1, 2], "indicators": {"quote": [{"close": [26.5, 27.0]}]}}]}}
    monkeypatch.setattr(s, "http_get_json", yahoo)
    q = s.quote("BBAS3")
    assert q["price"] == 27.0 and round(q["change_pct"], 2) == 3.85
    assert s.history("BBAS3", "1mo")["points"] == [[1, 26.5], [2, 27.0]]
    s.clear_cache()


def test_news_rss_parsing(monkeypatch):
    from jarvis import services as s
    s.clear_cache()
    rss = """<?xml version="1.0"?><rss><channel><item><title>Manchete X - Fonte Y</title><link>https://n/1</link>
    <pubDate>Sun, 22 Nov 2026 12:00:00 GMT</pubDate><source url="https://y">Fonte Y</source></item></channel></rss>"""
    monkeypatch.setattr(s, "http_get_text", lambda url, params=None, timeout=8: rss)
    n = s.news("")
    assert n[0]["title"] == "Manchete X" and n[0]["source"] == "Fonte Y"
    s.clear_cache()


# ---------------------------------------------------------------- Produtividade
def test_focus_goals_routines_report(user):
    assert user.post("/api/focus", json={"minutes": 25, "label": "Estudo"}).status_code == 201
    st = user.get("/api/focus/stats").json
    assert st["today"] == 25 and st["sessions"] == 1
    g = user.post("/api/goals", json={"title": "Ler", "target": 10, "unit": "livros"}).json
    assert user.patch(f"/api/goals/{g['id']}", json={"increment": 1}).json["progress"] == 10
    r = user.post("/api/routines", json={"name": "Bom dia", "time": "07:00", "days": [0, 1, 2, 3, 4, 5, 6],
                                         "actions": [{"type": "briefing"}, {"type": "task", "value": "Ler e-mails"}]}).json
    assert user.post(f"/api/routines/{r['id']}/run").status_code == 200
    n = user.get("/api/tick").json["notifications"]
    assert any("Bom dia" in x["title"] for x in n)
    assert any(i["title"] == "Ler e-mails" for i in user.get("/api/items?kind=task").json)
    pdf = user.get("/api/report.pdf?days=7")
    assert pdf.status_code == 200 and pdf.data[:4] == b"%PDF"


def test_scheduled_routine_runs_once(user):
    user.put("/api/settings", json={"timezone": "UTC"})
    now = utcnow() - timedelta(minutes=1)
    user.post("/api/routines", json={"name": "Agora", "time": now.strftime("%H:%M"), "days": list(range(7)),
                                     "actions": [{"type": "message", "value": "Olá"}]})
    first = user.get("/api/tick").json["notifications"]
    assert [n["title"] for n in first] == ["Rotina: Agora"]
    assert user.get("/api/tick").json["notifications"] == []


# ---------------------------------------------------------------- Windows
def test_windows_agent_flow(user, client):
    user.put("/api/settings", json={"windows_apps": ["Bloco de Notas"], "windows_sites": ["youtube.com"]})
    dev = user.post("/api/windows/devices", json={"name": "PC"}).json
    token = dev["token"]
    auth = {"Authorization": f"Bearer {token}"}
    assert client.post("/api/agent/poll", json={}, headers={"Authorization": "Bearer errado"}).status_code == 401
    client.post("/api/agent/poll", json={"info": {"cpu_percent": 10}}, headers=auth)
    assert user.get("/api/windows/devices").json[0]["online"] is True
    # não autorizado
    assert user.post("/api/windows/commands", json={"type": "open_app", "payload": {"name": "cmd"}}).status_code == 400
    assert user.post("/api/windows/commands", json={"type": "open_site", "payload": {"url": "https://evil.com"}}).status_code == 400
    assert user.post("/api/windows/commands", json={"type": "open_site", "payload": {"url": "https://youtube.com.evil.com"}}).status_code == 400
    c = user.post("/api/windows/commands", json={"type": "open_app", "payload": {"name": "bloco de notas"}}).json
    assert c["payload"] == {"name": "Bloco de Notas"}
    user.post("/api/windows/commands", json={"type": "volume", "payload": {"level": 150}})
    got = client.post("/api/agent/poll", json={}, headers=auth).json["commands"]
    assert [x["type"] for x in got] == ["open_app", "volume"] and got[1]["payload"]["level"] == 100
    assert client.post("/api/agent/result", json={"id": got[0]["id"], "ok": True, "result": {"message": "ok"}},
                       headers=auth).status_code == 200
    assert user.get(f"/api/windows/commands/{got[0]['id']}").json["status"] == "ok"
    # o assistente usa o mesmo caminho
    assert user.say("abra o bloco de notas")["reply"] == "Abrindo Bloco de Notas."


# ---------------------------------------------------------------- Configurações e exportação
def test_settings_and_export(user):
    s = user.put("/api/settings", json={"city": "Recife", "timezone": "Invalida/Zona", "voice_rate": "1.2",
                                        "pomodoro_focus": 50, "hacker": 1}).json
    assert s["city"] == "Recife" and s["timezone"] == "America/Sao_Paulo" and s["voice_rate"] == 1.2
    assert "hacker" not in s
    user.post("/api/items", json={"kind": "task", "title": "Exportar"})
    r = user.get("/api/export")
    assert r.status_code == 200 and "attachment" in r.headers["Content-Disposition"]
    data = r.get_json()
    assert data["items"][0]["title"] == "Exportar" and data["user"]["settings"]["city"] == "Recife"


def test_delete_account(user, client):
    assert user.delete("/api/account", json={"password": "errada"}).status_code == 400
    assert user.delete("/api/account", json={"password": "senha-forte-123"}).status_code == 200
    assert client.get("/api/auth/state").json["authenticated"] is False


# ---------------------------------------------------------------- Push e cron
def test_webpush_encryption_roundtrip(app):
    with app.app_context():
        ua_key = ec.generate_private_key(ec.SECP256R1())
        ua_pub = ua_key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
        auth = push.b64u(b"0123456789abcdef")
        body = push.encrypt(b'{"title":"Oi"}', push.b64u(ua_pub), auth)
        assert push.decrypt(body, ua_key, auth) == b'{"title":"Oi"}'
        hdr = push.vapid_header("https://fcm.googleapis.com/fcm/send/abc")
        assert hdr.startswith("vapid t=") and ", k=" in hdr
        assert len(push.b64u_dec(push.public_key_b64())) == 65


def test_cron_requires_secret(client, user, monkeypatch):
    assert client.get("/cron/tick").status_code == 403
    assert client.get("/cron/tick?key=errada").status_code == 403
    r = client.get("/cron/tick?key=cron123")
    assert r.status_code == 200 and r.json["users"] == 1


def test_pwa_files_served(client):
    assert client.get("/").status_code == 200
    m = client.get("/manifest.webmanifest")
    assert m.status_code == 200 and m.json["display"] == "standalone"
    sw = client.get("/sw.js")
    assert sw.status_code == 200 and "push" in sw.get_data(as_text=True)
    assert client.get("/static/icons/apple-touch-icon.png").status_code == 200
    assert "Content-Security-Policy" in client.get("/").headers
    assert client.get("/download/jarvis_agent.py").status_code == 200
