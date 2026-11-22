import pytest

from jarvis import create_app, services
from jarvis.auth import reset_attempts


FAKE_WEATHER = {"city": "São Paulo", "region": "SP, Brasil",
                "current": {"temperature": 24.3, "feels_like": 25.1, "humidity": 60, "wind": 8, "code": 1,
                            "description": "Predomínio de sol", "icon": "🌤️", "time": "2026-11-22T10:00"},
                "days": [{"date": "2026-11-22", "code": 1, "description": "Predomínio de sol", "icon": "🌤️",
                          "max": 28, "min": 18, "rain": 10}], "hours": []}


def fake_quotes():
    return [
        {"symbol": "BBAS3", "name": "Banco do Brasil (BBAS3)", "kind": "acao", "price": 27.5, "formatted": "R$ 27,50",
         "change_pct": 1.2, "source": "teste", "spark": []},
        {"symbol": "IBOV", "name": "Ibovespa", "kind": "indice", "price": 128000.0, "formatted": "128.000 pontos",
         "change_pct": -0.4, "source": "teste", "spark": []},
        {"symbol": "USD", "name": "Dólar (USD/BRL)", "kind": "moeda", "price": 5.1, "formatted": "R$ 5,1000",
         "change_pct": 0.1, "source": "teste", "spark": []},
        {"symbol": "EUR", "name": "Euro (EUR/BRL)", "kind": "moeda", "price": 5.6, "formatted": "R$ 5,6000",
         "change_pct": 0.0, "source": "teste", "spark": []},
    ]


@pytest.fixture
def app(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setattr(services, "weather", lambda city: {**FAKE_WEATHER, "city": city})
    monkeypatch.setattr(services, "quotes", fake_quotes)
    monkeypatch.setattr(services, "news", lambda topic="", limit=15: [
        {"title": "Notícia de teste", "link": "https://example.com", "source": "Teste", "published": ""}])
    reset_attempts()
    app = create_app({"DATABASE_URL": "sqlite://", "SECRET_KEY": "teste", "TESTING": True, "CRON_SECRET": "cron123"})
    yield app


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

    def say(self, text):
        r = self.post("/api/assistant/chat", json={"text": text})
        assert r.status_code == 200, r.json
        return r.json


@pytest.fixture
def user(client):
    r = client.post("/api/auth/register", json={"username": "tony", "password": "senha-forte-123", "name": "Tony"})
    assert r.status_code == 200
    return Authed(client, r.json["csrf"])
