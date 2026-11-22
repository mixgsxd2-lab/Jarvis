"""Testa o laço de ferramentas do Claude com um cliente falso (sem rede)."""
from types import SimpleNamespace as NS

import anthropic


class FakeMessages:
    def __init__(self):
        self.calls = []

    def create(self, **kw):
        self.calls.append(kw)
        if len(self.calls) == 1:
            return NS(stop_reason="tool_use", content=[
                NS(type="thinking", thinking=""),
                NS(type="tool_use", id="t1", name="get_weather", input={}),
                NS(type="tool_use", id="t2", name="propose_change",
                   input={"action": {"type": "create_item", "kind": "task", "title": "Levar guarda-chuva"}}),
            ])
        return NS(stop_reason="end_turn", content=[NS(type="text", text="Vai fazer sol. Posso criar a tarefa?")])


class FakeClient:
    def __init__(self, *a, **k):
        self.beta = NS(messages=FAKE)


FAKE = FakeMessages()


def test_ai_tool_loop(user, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-teste")
    monkeypatch.setattr(anthropic, "Anthropic", FakeClient)
    FAKE.calls.clear()
    r = user.say("vai chover? se sim crie uma tarefa")
    assert r["engine"] == "ia"
    assert r["reply"].startswith("Vai fazer sol")
    assert r["pending"][0]["summary"] == "Criar tarefa “Levar guarda-chuva”"
    assert user.get("/api/items?kind=task").json == []  # só depois de confirmar
    second = FAKE.calls[1]
    results = second["messages"][-1]["content"]
    assert [x["tool_use_id"] for x in results] == ["t1", "t2"]
    assert second["model"] == "claude-opus-5-5" and second["fallbacks"] == "default"
    # “sim” continua sendo tratado localmente
    assert "criada" in user.say("sim")["reply"]


def test_ai_failure_falls_back_to_rules(user, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-teste")

    class Broken:
        def __init__(self, *a, **k):
            raise RuntimeError("sem rede")
    monkeypatch.setattr(anthropic, "Anthropic", Broken)
    r = user.say("que horas são")
    assert r["engine"] == "regras" and "Agora são" in r["reply"]
