from sqlalchemy import create_engine, text


# ---------------------------------------------------------------- login
def test_signup_login_logout_and_csrf(client):
    assert client.get("/api/auth/state").json == {"authenticated": False, "signup": True}
    assert client.post("/api/auth/register", json={"username": "ab", "password": "x"}).status_code == 400
    r = client.post("/api/auth/register", json={"username": "tony", "password": "senha-forte-123"})
    assert r.status_code == 200
    csrf = r.json["csrf"]
    assert client.post("/api/ideias", json={"text": "x"}).status_code == 403  # sem token CSRF
    assert client.post("/api/ideias", json={"text": "x"}, headers={"X-CSRF-Token": csrf}).status_code == 201
    client.post("/api/auth/logout")
    assert client.get("/api/ideias").status_code == 401
    # só o primeiro cadastro é permitido
    assert client.post("/api/auth/register", json={"username": "outro", "password": "senha-forte-123"}).status_code == 403
    assert client.post("/api/auth/login", json={"username": "tony", "password": "errada!!"}).status_code == 401
    assert client.post("/api/auth/login", json={"username": "tony", "password": "senha-forte-123"}).status_code == 200


def test_login_rate_limit(client, user):
    client.post("/api/auth/logout")
    for _ in range(8):
        client.post("/api/auth/login", json={"username": "tony", "password": "errada!!"})
    assert client.post("/api/auth/login", json={"username": "tony", "password": "senha-forte-123"}).status_code == 429


# ---------------------------------------------------------------- ideias
def test_add_list_edit_delete(user):
    a = user.add("  Comprar presente da mãe  ").json
    b = user.add("Ligar para o banco").json
    assert a["text"] == "Comprar presente da mãe"
    assert [i["text"] for i in user.get("/api/ideias").json] == ["Ligar para o banco", "Comprar presente da mãe"]
    assert user.patch(f"/api/ideias/{a['id']}", json={"text": "Comprar presente do pai"}).json["text"] == "Comprar presente do pai"
    assert user.patch(f"/api/ideias/{a['id']}", json={"text": "   "}).status_code == 400
    assert user.delete(f"/api/ideias/{b['id']}").status_code == 200
    assert [i["text"] for i in user.get("/api/ideias").json] == ["Comprar presente do pai"]
    assert user.add("").status_code == 400
    assert len(user.add("x" * 500).json["text"]) == 300


def test_users_are_isolated(app, user):
    idea = user.add("secreta").json
    app.config["ALLOW_SIGNUP"] = True
    other = app.test_client()
    r = other.post("/api/auth/register", json={"username": "pepper", "password": "senha-forte-123"})
    h = {"X-CSRF-Token": r.json["csrf"]}
    assert other.get("/api/ideias").json == []
    assert other.patch(f"/api/ideias/{idea['id']}", json={"text": "hack"}, headers=h).status_code == 404
    assert other.delete(f"/api/ideias/{idea['id']}", headers=h).status_code == 404


def test_old_database_keeps_ideas(tmp_path):
    """Banco da versão anterior: as ideias já salvas continuam aparecendo."""
    from jarvis import create_app
    url = f"sqlite:///{tmp_path / 'old.db'}"
    app = create_app({"DATABASE_URL": url, "SECRET_KEY": "x"})
    c = app.test_client()
    csrf = c.post("/api/auth/register", json={"username": "tony", "password": "senha-forte-123"}).json["csrf"]
    eng = create_engine(url)
    with eng.begin() as conn:
        conn.execute(text("INSERT INTO items (user_id, kind, title, body, status, priority, tags, position, created_at, updated_at) "
                          "VALUES (1, 'idea', 'Ideia antiga', '', 'nova', 0, '[]', 0, '2026-01-01 10:00:00', '2026-01-01 10:00:00'), "
                          "(1, 'task', 'Tarefa antiga', '', 'pendente', 0, '[]', 0, '2026-01-01 10:00:00', '2026-01-01 10:00:00')"))
    assert [i["text"] for i in c.get("/api/ideias").json] == ["Ideia antiga"]
    assert csrf


def test_pwa_files_served(client):
    assert client.get("/").status_code == 200
    m = client.get("/manifest.webmanifest")
    assert m.status_code == 200 and m.json["background_color"] == "#ffffff"
    assert client.get("/sw.js").status_code == 200
    assert client.get("/static/js/app.js").status_code == 200
    assert client.get("/static/icons/apple-touch-icon.png").status_code == 200
    assert "Content-Security-Policy" in client.get("/").headers
