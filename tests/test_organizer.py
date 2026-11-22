"""Captura rápida, painel Hoje, projetos/quadro, notas fixadas e migração de colunas."""
from datetime import datetime, timedelta

from sqlalchemy import create_engine, text

from jarvis.models import utcnow


def local(dt):
    return dt.strftime("%Y-%m-%dT%H:%M")


def test_capture_task_with_date_and_project(user):
    p = user.post("/api/items", json={"kind": "project", "title": "Site novo"}).json
    prev = user.capture("enviar orçamento amanhã às 10h", dry_run=True).json
    assert prev["title"] == "Enviar orçamento" and "amanhã" in prev["label"]
    r = user.capture("enviar orçamento amanhã às 10h", project_id=p["id"], priority=3)
    assert r.status_code == 201
    it = r.json["item"]
    assert it["title"] == "Enviar orçamento" and it["due"].endswith("10:00:00") and it["parent_id"] == p["id"] and it["priority"] == 3
    only_day = user.capture("pagar boleto sexta").json["item"]
    assert only_day["due"].endswith("00:00:00")
    assert user.capture("sem data nenhuma").json["item"]["due"] is None
    tasks = user.get("/api/items?kind=task").json
    assert any(t.get("parent", {}).get("title") == "Site novo" for t in tasks)


def test_capture_other_kinds(user):
    assert user.capture("App de receitas", kind="idea").json["item"]["kind"] == "idea"
    n = user.capture("Reunião de pauta\nitem 1\nitem 2", kind="note").json["item"]
    assert n["title"] == "Reunião de pauta" and n["body"] == "item 1\nitem 2"
    assert user.capture("ligar para a Ana", kind="reminder").status_code == 400  # falta quando
    r = user.capture("ligar para a Ana em 30 minutos", kind="reminder", reminder_kind="alarme").json
    assert r["type"] == "reminder" and r["reminder"]["kind"] == "alarme"
    e = user.capture("dentista sexta 14h30", kind="event").json
    assert e["type"] == "event" and e["event"]["start"].endswith("14:30:00")
    e2 = user.capture("outra coisa sexta 14h30", kind="event").json
    assert e2["conflicts"][0]["title"] == "Dentista"
    assert user.capture("", kind="task").status_code == 400
    assert user.capture("x", kind="hack").status_code == 400


def test_today_dashboard(user):
    user.put("/api/settings", json={"timezone": "UTC"})
    now = utcnow()
    user.post("/api/items", json={"kind": "task", "title": "Atrasada", "due": local(now - timedelta(days=2))})
    user.post("/api/items", json={"kind": "task", "title": "Hoje", "due": now.strftime("%Y-%m-%dT23:59")})
    user.post("/api/items", json={"kind": "task", "title": "Semana", "due": local(now + timedelta(days=3))})
    user.post("/api/items", json={"kind": "task", "title": "Importante", "priority": 3})
    done = user.post("/api/items", json={"kind": "task", "title": "Feita"}).json
    user.patch(f"/api/items/{done['id']}", json={"status": "concluida"})
    p = user.post("/api/items", json={"kind": "project", "title": "Projeto X", "status": "andamento"}).json
    user.post("/api/items", json={"kind": "task", "title": "T1", "parent_id": p["id"]})
    user.post("/api/items", json={"kind": "idea", "title": "Ideia 1"})
    user.post("/api/reminders", json={"title": "Remédio", "at": now.strftime("%Y-%m-%dT23:58")})
    t = user.get("/api/today").json
    assert [x["title"] for x in t["overdue"]] == ["Atrasada"]
    assert [x["title"] for x in t["today"]] == ["Hoje"]
    assert [x["title"] for x in t["upcoming"]] == ["Semana"]
    assert [x["title"] for x in t["important"]] == ["Importante"]
    assert t["counts"]["done_today"] == 1
    assert t["projects"][0]["title"] == "Projeto X" and t["projects"][0]["children_count"] == 1
    assert t["ideas"][0]["title"] == "Ideia 1"
    assert any(a["title"] == "Remédio" for a in t["agenda"])


def test_project_board_and_color(user):
    p = user.post("/api/items", json={"kind": "project", "title": "P", "color": "#ef4444"}).json
    assert p["color"] == "#ef4444"
    assert user.patch(f"/api/items/{p['id']}", json={"color": "javascript:alert(1)"}).json["color"] == "#ef4444"
    t = user.post("/api/items", json={"kind": "task", "title": "Card", "parent_id": p["id"]}).json
    user.patch(f"/api/items/{t['id']}", json={"status": "andamento"})
    kids = user.get(f"/api/items/{p['id']}").json["children"]
    assert kids[0]["status"] == "andamento"
    lst = user.get("/api/items?kind=project&top=1").json
    assert lst[0]["children_count"] == 1 and lst[0]["children_done"] == 0


def test_notes_pinned_first(user):
    a = user.post("/api/items", json={"kind": "note", "title": "A"}).json
    user.post("/api/items", json={"kind": "note", "title": "B"})
    user.patch(f"/api/items/{a['id']}", json={"pinned": True})
    notes = user.get("/api/items?kind=note").json
    assert notes[0]["title"] == "A" and notes[0]["pinned"] is True


def test_task_due_notification(user):
    user.put("/api/settings", json={"timezone": "UTC"})
    user.post("/api/items", json={"kind": "task", "title": "Entregar", "due": local(utcnow() - timedelta(minutes=2))})
    n = user.get("/api/tick").json["notifications"]
    assert n and n[0]["title"] == "Entregar" and n[0]["kind"] == "prazo"


def test_migration_adds_new_columns(tmp_path):
    """Banco criado pela versão anterior (sem color/pinned) continua funcionando."""
    from jarvis import create_app
    url = f"sqlite:///{tmp_path / 'old.db'}"
    eng = create_engine(url)
    with eng.begin() as c:
        c.execute(text("CREATE TABLE items (id INTEGER PRIMARY KEY, user_id INTEGER, kind VARCHAR(20), title VARCHAR(300), "
                       "body TEXT, status VARCHAR(20), priority INTEGER, due DATETIME, tags JSON, parent_id INTEGER, "
                       "origin_id INTEGER, position INTEGER, done_at DATETIME, created_at DATETIME, updated_at DATETIME)"))
    app = create_app({"DATABASE_URL": url, "SECRET_KEY": "x"})
    c = app.test_client()
    r = c.post("/api/auth/register", json={"username": "velho", "password": "senha-forte-123"})
    h = {"X-CSRF-Token": r.json["csrf"]}
    it = c.post("/api/items", json={"kind": "project", "title": "Ok", "color": "#10b981"}, headers=h)
    assert it.status_code == 201 and it.json["color"] == "#10b981"
    assert datetime  # import usado
