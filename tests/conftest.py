import pytest

from jarvis import create_app
from jarvis.auth import reset_attempts


@pytest.fixture
def app():
    reset_attempts()
    return create_app({"DATABASE_URL": "sqlite://", "SECRET_KEY": "teste", "TESTING": True, "CRON_SECRET": "cron123"})


@pytest.fixture
def client(app):
    return app.test_client()


class Authed:
    def __init__(self, client, csrf):
        self.c = client
        self.csrf = csrf

    def _h(self):
        return {"X-CSRF-Token": self.csrf}

    def get(self, url, **kw):
        return self.c.get(url, **kw)

    def post(self, url, json=None, **kw):
        return self.c.post(url, json=json, headers=self._h(), **kw)

    def patch(self, url, json=None):
        return self.c.patch(url, json=json, headers=self._h())

    def put(self, url, json=None):
        return self.c.put(url, json=json, headers=self._h())

    def delete(self, url, json=None):
        return self.c.delete(url, json=json, headers=self._h())

    def capture(self, text, kind="task", **extra):
        return self.post("/api/capture", json={"text": text, "kind": kind, **extra})


@pytest.fixture
def user(client):
    r = client.post("/api/auth/register", json={"username": "tony", "password": "senha-forte-123", "name": "Tony"})
    assert r.status_code == 200
    return Authed(client, r.json["csrf"])
