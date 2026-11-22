"""Cérebro do JARVIS.

* Com ANTHROPIC_API_KEY configurada, a conversa usa o Claude com ferramentas.
* Sem chave (ou se a IA falhar), um interpretador de comandos em português assume.

Em ambos os casos, qualquer alteração nos dados vira uma *proposta* que o
usuário precisa confirmar (botão ou dizendo “sim”/“confirmo”).
"""
from __future__ import annotations

import json
import logging
import os
import re
import time
from datetime import timedelta

from flask import Blueprint, g, jsonify, request
from sqlalchemy import delete, or_, select

from . import actions, services
from .auth import login_required
from .models import Command, Device, Event, Item, Memory, Message, db
from .util import (DIAS_NOME, MESES_NOME, fmt_dt, fold, iso, now_local, occurrences,
                   parse_when, user_settings)

log = logging.getLogger("jarvis.assistant")
bp = Blueprint("assistant", __name__, url_prefix="/api/assistant")

MODEL = os.environ.get("JARVIS_MODEL", "claude-opus-5-5")
HISTORY_TURNS = 16


# ====================================================================== utilidades
def _plural(n, s, p=None):
    return s if n == 1 else (p or s + "s")


def find_item(user, query: str, kinds=None):
    q = select(Item).where(Item.user_id == user.id)
    if kinds:
        q = q.where(Item.kind.in_(kinds))
    cands = db.scalars(q.where(Item.title.ilike(f"%{query.strip()}%")).order_by(Item.updated_at.desc())).all()
    if cands:
        return cands[0]
    fq = fold(query)
    words = [w for w in re.findall(r"\w+", fq) if len(w) > 2]
    best, score = None, 0
    for it in db.scalars(q).all():
        ft = fold(it.title)
        s = sum(1 for w in words if w in ft)
        if s > score:
            best, score = it, s
    return best if score else None


def agenda_text(user, day_offset=0, days=1) -> str:
    now = now_local(user)
    start = (now + timedelta(days=day_offset)).replace(hour=0, minute=0, second=0)
    end = start + timedelta(days=days)
    occ = []
    for ev in db.scalars(select(Event).where(Event.user_id == user.id, Event.start < end)).all():
        for a, _b in occurrences(ev, start, end):
            occ.append((a, ev))
    occ.sort(key=lambda x: x[0])
    if days > 1:
        label = "nos próximos dias"
    elif day_offset == 0:
        label = "hoje"
    elif day_offset == 1:
        label = "amanhã"
    else:
        label = f"em {DIAS_NOME[start.weekday()]}, {start.day} de {MESES_NOME[start.month - 1]}"
    if not occ:
        return f"Você não tem compromissos {label}."
    parts = []
    for a, ev in occ[:8]:
        quando = "dia inteiro" if ev.all_day else a.strftime("%H:%M")
        if days > 1:
            quando = f"{DIAS_NOME[a.weekday()]} {a.day}, {quando}"
        parts.append(f"{ev.title} ({quando})")
    return f"Você tem {len(occ)} {_plural(len(occ), 'compromisso')} {label}: " + "; ".join(parts) + "."


def tasks_text(user) -> str:
    rows = db.scalars(select(Item).where(Item.user_id == user.id, Item.kind == "task", Item.status != "concluida")
                      .order_by(Item.priority.desc(), Item.due.is_(None), Item.due, Item.id.desc())).all()
    if not rows:
        return "Você não tem tarefas pendentes. Muito bem!"
    top = "; ".join(r.title + (f" (prazo {r.due.strftime('%d/%m')})" if r.due else "") for r in rows[:6])
    return f"Você tem {len(rows)} {_plural(len(rows), 'tarefa pendente', 'tarefas pendentes')}: {top}."


def weather_text(city: str) -> str:
    w = services.weather(city)
    c = w["current"]
    today = w["days"][0] if w["days"] else None
    s = (f"Agora em {w['city']}: {c['description'].lower()}, {round(c['temperature'])} graus, "
         f"sensação de {round(c['feels_like'])}.")
    if today:
        s += f" Hoje a mínima é {round(today['min'])} e a máxima {round(today['max'])} graus"
        if today.get("rain") is not None:
            s += f", com {today['rain']}% de chance de chuva"
        s += "."
    return s


def quotes_text(symbols=None) -> str:
    qs = services.quotes()
    parts = []
    for q in qs:
        if symbols and q["symbol"] not in symbols:
            continue
        if q.get("price") is None:
            parts.append(f"{q['name']}: indisponível")
            continue
        ch = q.get("change_pct")
        var = f" ({'+' if ch >= 0 else ''}{ch:.2f}%)".replace(".", ",") if ch is not None else ""
        parts.append(f"{q['name']}: {q['formatted']}{var}")
    return ". ".join(parts) + "."


def news_text(topic="") -> str:
    ns = services.news(topic, 5)
    if not ns:
        return "Não encontrei notícias agora."
    return "Principais notícias: " + " | ".join(n["title"] for n in ns[:5]) + "."


def online_device(user):
    from .windows import device_json
    dev = db.scalar(select(Device).where(Device.user_id == user.id).order_by(Device.last_seen.desc()))
    return dev if dev and device_json(dev)["online"] else None


def wait_command(cid: int, seconds: float = 8.0):
    end = time.time() + seconds
    while time.time() < end:
        db.expire_all()
        c = db.get(Command, cid)
        if c and c.status in ("ok", "erro"):
            return c
        time.sleep(0.5)
    return None


def system_info_text(info: dict) -> str:
    parts = []
    if "cpu_percent" in info:
        parts.append(f"processador em {info['cpu_percent']:.0f}%")
    if "memory_percent" in info:
        parts.append(f"memória em {info['memory_percent']:.0f}%")
    if "disk_percent" in info:
        parts.append(f"disco {info['disk_percent']:.0f}% ocupado")
    if info.get("battery_percent") is not None:
        parts.append(f"bateria em {info['battery_percent']:.0f}%")
    return ("O computador está com " + ", ".join(parts) + ".") if parts else "Recebi os dados do computador."


def windows_text(user, ctype: str, payload: dict) -> str:
    from .windows import queue_command
    c, err = queue_command(user, ctype, payload)
    if c is None:
        return err
    if ctype == "system_info":
        done = wait_command(c.id)
        if done and done.status == "ok":
            return system_info_text(done.result or {})
        return "Pedi os dados ao computador; confira o painel Windows em instantes."
    if err:
        return err
    names = {"open_app": f"Abrindo {payload.get('name')}.", "open_site": "Abrindo o site no computador.",
             "volume": "Ajustando o volume.", "timer": "Temporizador iniciado no computador."}
    return names.get(ctype, "Comando enviado.")


# ====================================================================== interpretador de regras
YES = re.compile(r"^(sim|s|confirmo|confirmar|confirma|pode|pode sim|ok|okay|isso|claro|beleza|manda ver|faca|faça|positivo|com certeza)[.! ]*$")
NO = re.compile(r"^(nao|n|cancela|cancelar|cancele|negativo|deixa|esquece|deixa pra la|nao precisa)[.! ]*$")

HELP = ("Posso conversar, criar tarefas, ideias, anotações e projetos, agendar compromissos, "
        "criar lembretes e alarmes, guardar memórias que você autorizar, informar clima, notícias "
        "e cotações do dólar, euro, Ibovespa e BBAS3, iniciar um Pomodoro, controlar o Spotify e, "
        "com o agente instalado, abrir apps e sites autorizados no Windows. Exemplos: "
        "“crie uma tarefa pagar a conta amanhã”, “me lembre de ligar para a Ana às 15h”, "
        "“como está o tempo?”, “cotação do dólar”.")


def _clean_title(t: str) -> str:
    t = re.sub(r"^\s*(?:de|para|pra|que|:|-)\s+", "", t.strip(), flags=re.I)
    return t.strip(" .,:;!?\"'“”").strip()


def rules(user, text: str) -> dict:
    s = user_settings(user)
    now = now_local(user)
    raw = re.sub(r"^\s*(?:ei\s+|ok\s+|oi\s+)?jarvis[,!.:]?\s*", "", text.strip(), flags=re.I)
    f = fold(raw).strip().rstrip("?!. ")
    out = {"reply": "", "pending": [], "client_actions": []}

    def say(msg):
        out["reply"] = msg
        return out

    def prop(action):
        try:
            p = actions.propose(user, action)
        except ValueError as e:
            return say(f"Não consegui preparar isso: {e}.")
        out["pending"].append(p)
        return say(f"{p['summary']}. Posso confirmar?")

    if not f:
        return say("Estou ouvindo.")

    # confirmações por voz
    pend = actions.recent_pending(user)
    if pend and YES.match(f):
        msgs = [actions.resolve(user, p.id, True)["message"] for p in pend]
        out["resolved"] = [p.id for p in pend]
        return say(" ".join(msgs))
    if pend and NO.match(f):
        for p in pend:
            actions.resolve(user, p.id, False)
        out["resolved"] = [p.id for p in pend]
        return say("Tudo bem, cancelei.")

    if re.search(r"\b(ajuda|o que voce (sabe|pode|consegue) fazer|comandos)\b", f):
        return say(HELP)
    if re.search(r"\bque horas?\b|\bhoras sao\b", f):
        return say(f"Agora são {now.strftime('%H:%M')}.")
    if re.search(r"\b(que dia e hoje|que dia eh hoje|data de hoje|qual a data|que dia e hj)\b", f):
        return say(f"Hoje é {DIAS_NOME[now.weekday()]}, {now.day} de {MESES_NOME[now.month - 1]} de {now.year}.")

    # memória
    if re.search(r"\b(o que voce sabe sobre mim|minhas memorias|do que voce (se )?lembra|o que voce lembra)\b", f):
        ms = db.scalars(select(Memory).where(Memory.user_id == user.id).order_by(Memory.id.desc()).limit(10)).all()
        if not ms:
            return say("Ainda não guardei nenhuma memória sobre você. Diga, por exemplo, “lembre que eu prefiro café sem açúcar”.")
        return say("Eu lembro que: " + "; ".join(m.content for m in ms) + ".")
    m = re.match(r"^(?:esqueca|esquece|apague da memoria|apaga da memoria)\s+(?:que|de que|sobre|o que)?\s*(.+)$", f)
    if m:
        frag = raw[m.start(1):].strip(" .")
        cands = db.scalars(select(Memory).where(Memory.user_id == user.id)).all()
        words = [w for w in re.findall(r"\w+", fold(frag)) if len(w) > 2]
        best = max(cands, key=lambda x: sum(w in fold(x.content) for w in words), default=None)
        if not best or not any(w in fold(best.content) for w in words):
            return say("Não encontrei essa informação na minha memória.")
        return prop({"type": "delete_memory", "id": best.id})

    # lembretes
    m = re.match(r"^(?:me lembre|me lembra|lembre-me|lembra-me|lembre me|crie um lembrete|criar lembrete|novo lembrete|lembrete)\s*(?:de|para|pra|que|:)?\s+(.+)$", f)
    if m:
        frag = raw[m.start(1):]
        dt, rest, _ = parse_when(frag, now)
        title = _clean_title(rest) or "Lembrete"
        if not dt:
            return say(f"Para quando devo lembrar de “{title}”? Diga, por exemplo, “me lembre de {title} amanhã às 9h”.")
        return prop({"type": "create_reminder", "title": title, "at": iso(dt), "kind": "lembrete",
                     "repeat": _repeat_from(f)})

    if re.search(r"\b(alarme|despertador|me acorde|me acorda)\b", f) and not re.search(r"\b(cancel|apag|exclu)", f):
        dt, rest, has_time = parse_when(raw, now)
        if not dt or not has_time:
            return say("Para que horas devo colocar o alarme?")
        label = re.sub(r"(?i)\b(crie|criar|coloque|coloca|ponha|defina|definir|um|uma|o|alarme|despertador|me acorde|me acorda|para|pra)\b", " ", rest)
        title = _clean_title(label) or "Alarme"
        return prop({"type": "create_reminder", "title": title, "at": iso(dt), "kind": "alarme",
                     "repeat": _repeat_from(f)})

    # memória explícita (“lembre que…”, “guarde que…”)
    m = re.match(r"^(?:lembre|lembra|memorize|memoriza|guarde|guarda|grave|grava|saiba|anote na memoria)(?:-se)?\s+(?:que|de que|isso:)\s+(.+)$", f)
    if m:
        content = raw[m.start(1):].strip(" .")
        return prop({"type": "save_memory", "content": content[:1].upper() + content[1:]})

    # temporizador / pomodoro
    m = re.search(r"\b(temporizador|cronometro|timer)\b.*?\b(\d+|um|uma|dois|cinco|dez|quinze|vinte|trinta)\s*(segundos?|minutos?|min|horas?)\b", f) \
        or re.search(r"\b(\d+|um|uma|dois|cinco|dez|quinze|vinte|trinta)\s*(segundos?|minutos?|min|horas?)\b.*\b(temporizador|cronometro|timer)\b()", f)
    if m:
        from .util import _num
        groups = [x for x in m.groups() if x]
        num = next((_num(x) for x in groups if _num(x)), None) or 1
        unit = next(x for x in groups if x.startswith(("seg", "min", "hor")))
        seconds = num * (1 if unit.startswith("seg") else 60 if unit.startswith("min") else 3600)
        label = f"Temporizador de {num} {unit}"
        if re.search(r"\b(no computador|no pc|no windows|no notebook)\b", f):
            return say(windows_text(user, "timer", {"seconds": seconds, "label": label}))
        out["client_actions"].append({"type": "timer", "seconds": seconds, "label": label})
        return say(f"{label} iniciado.")
    if re.search(r"\b(pomodoro|modo foco|iniciar foco|inicie o foco|comecar a focar|hora de focar|sessao de foco)\b", f):
        mm = re.search(r"(\d+)\s*min", f)
        minutes = int(mm.group(1)) if mm else s["pomodoro_focus"]
        out["client_actions"].append({"type": "pomodoro", "minutes": minutes})
        return say(f"Iniciando um Pomodoro de {minutes} minutos. Bom foco!")

    # compromissos
    if re.search(r"\b(marque|marca|marcar|agende|agendar|agenda uma|agenda um|novo compromisso|nova reuniao|crie um compromisso|criar compromisso|crie uma reuniao|adicione um compromisso|adicionar compromisso)\b", f):
        dt, rest, has_time = parse_when(raw, now)
        title = re.sub(r"(?i)\b(marque|marca|marcar|agende|agendar|agenda|novo|nova|crie|criar|adicione|adicionar|um|uma|compromisso|evento|na agenda|na minha agenda)\b", " ", rest)
        title = _clean_title(re.sub(r"\s{2,}", " ", title)) or "Compromisso"
        title = title[:1].upper() + title[1:]
        if not dt:
            return say(f"Para quando devo agendar “{title}”?")
        if not has_time:
            return say(f"Que horas é “{title}” em {fmt_dt(dt, now).split(' às')[0]}?")
        from .api import event_conflicts
        from .models import Event as Ev
        probe = Ev(user_id=user.id, title=title, start=dt, end=dt + timedelta(hours=1), recurrence=_repeat_from(f),
                   all_day=False)
        found = event_conflicts(user.id, probe)
        res = prop({"type": "create_event", "title": title, "start": iso(dt), "end": iso(dt + timedelta(hours=1)),
                    "recurrence": _repeat_from(f), "reminder_minutes": 15})
        if found and out["pending"]:
            out["reply"] = (f"Atenção: esse horário conflita com “{found[0]['title']}”. " + out["reply"])
        return res
    if re.search(r"\b(agenda|compromissos|o que (eu )?tenho)\b", f) and not re.search(r"\b(tarefa|fazer)\b", f):
        if "semana" in f:
            return say(agenda_text(user, 0, 7))
        dt, _r, _h = parse_when(raw, now)
        offset = max(0, (dt.date() - now.date()).days) if dt and re.search(r"\b(hoje|amanha|segunda|terca|quarta|quinta|sexta|sabado|domingo|dia|/)", f) else 0
        return say(agenda_text(user, offset))

    # itens do Meu Espaço
    m = re.match(r"^(?:crie|criar|cria|adicione|adicionar|adiciona|nova|novo|inclua|incluir|coloque|colocar|registre|registrar|salve|salvar)\s+(?:uma |um |a |o |na lista )?(tarefa|ideia|nota|anotacao|projeto|pesquisa)s?\s*(?:de|para|pra|:|-|chamad[oa]|com o nome)?\s*(.*)$", f) \
        or re.match(r"^(?:tenho uma |anote a |anota a )?(ideia)\s*[:,-]?\s+(.+)$", f) \
        or re.match(r"^(?:anote|anota|anotar|tome nota|toma nota)()\s*(?:que|de que|:)?\s+(.+)$", f)
    if m:
        kmap = {"tarefa": "task", "ideia": "idea", "nota": "note", "anotacao": "note", "projeto": "project",
                "pesquisa": "research", "": "note"}
        kind = kmap[m.group(1)]
        frag = raw[m.start(2):] if m.group(2) else ""
        due = None
        if kind == "task":
            dt, frag2, _ = parse_when(frag, now)
            if dt:
                due, frag = iso(dt), frag2
        title = _clean_title(frag)
        if not title:
            return say(f"Qual o título da {actions.KIND_NAMES[kind]}?")
        title = title[:1].upper() + title[1:]
        act = {"type": "create_item", "kind": kind, "title": title[:300]}
        if due:
            act["due"] = due
        return prop(act)
    m = re.match(r"^(?:conclua|concluir|conclui|marque|marcar|marca|finalize|finalizar|finaliza|terminei|completei|fiz)\s+(?:a |o )?(?:tarefa\s+)?(.+?)(?:\s+como\s+(?:concluida|feita|pronta|finalizada))?$", f)
    if m and ("tarefa" in f or "concluida" in f or "feita" in f or f.startswith(("terminei", "completei", "conclu", "finaliz"))):
        frag = raw[m.start(1):m.end(1)]
        it = find_item(user, frag, ("task", "subtask"))
        if not it:
            return say(f"Não encontrei a tarefa “{frag.strip()}”.")
        return prop({"type": "update_item", "id": it.id, "fields": {"status": "concluida"}})
    m = re.match(r"^(?:transforme|transformar|converta|converter)\s+(?:a )?(?:ideia\s+)?(.+?)\s+em\s+(?:uma |um )?(tarefa|projeto)$", f)
    if m:
        frag = raw[m.start(1):m.end(1)]
        it = find_item(user, frag)
        if not it:
            return say(f"Não encontrei “{frag.strip()}”.")
        return prop({"type": "convert_item", "id": it.id, "to": "task" if m.group(2) == "tarefa" else "project"})
    if re.search(r"\b(minhas tarefas|tarefas pendentes|lista de tarefas|o que (eu )?tenho (para|pra) fazer|quais (sao )?(as )?(minhas )?tarefas)\b", f):
        return say(tasks_text(user))
    m = re.match(r"^(?:pesquise|pesquisar|procure|procurar|busque|buscar|encontre)\s+(?:por |sobre )?(.+)$", f)
    if m:
        frag = raw[m.start(1):].strip(" ?.")
        like = f"%{frag}%"
        its = db.scalars(select(Item).where(Item.user_id == user.id, or_(Item.title.ilike(like), Item.body.ilike(like)))
                         .limit(5)).all()
        out["client_actions"].append({"type": "open_panel", "panel": "espaco", "search": frag})
        if its:
            return say(f"Encontrei {len(its)} {_plural(len(its), 'resultado')} no seu espaço: " +
                       "; ".join(f"{actions.KIND_NAMES[i.kind]} “{i.title}”" for i in its) + ".")
        return say(f"Não encontrei “{frag}” nos seus dados. Abri a pesquisa no Meu Espaço.")

    # serviços
    if re.search(r"\b(clima|tempo|previsao|temperatura|chover|chuva|vai chover|calor|frio)\b", f) and not re.search(r"\btempo de foco\b", f):
        mm = re.search(r"\b(?:em|no|na|de|para)\s+([a-z][a-z .'-]{2,40})$", f)
        city = s["city"]
        if mm and mm.group(1).strip() not in ("hoje", "amanha", "agora", "semana"):
            city = raw[mm.start(1):].strip(" ?.!")
        try:
            return say(weather_text(city))
        except Exception as e:  # noqa: BLE001
            return say(f"Não consegui consultar o clima agora ({e}).")
    if re.search(r"\b(noticias|noticia|manchetes)\b", f):
        mm = re.search(r"\b(?:sobre|de)\s+(.+)$", f)
        topic = raw[mm.start(1):].strip(" ?.") if mm else s.get("news_topic", "")
        try:
            return say(news_text(topic))
        except Exception as e:  # noqa: BLE001
            return say(f"Não consegui buscar as notícias agora ({e}).")
    if re.search(r"\b(dolar|euro|ibovespa|bovespa|bbas3|banco do brasil|cotacao|cotacoes|bolsa|mercado)\b", f):
        syms = set()
        if "dolar" in f:
            syms.add("USD")
        if "euro" in f:
            syms.add("EUR")
        if "ibovespa" in f or "bovespa" in f or "bolsa" in f:
            syms.add("IBOV")
        if "bbas3" in f or "banco do brasil" in f:
            syms.add("BBAS3")
        return say(quotes_text(syms or None))

    # Spotify
    if re.search(r"\b(pausar?|pause|para|parar)\b.*\b(musica|spotify)\b", f):
        return say(_spotify(user, "pause"))
    if re.search(r"\b(proxima|pular|pula)\b.*\b(musica|faixa)\b|\bproxima faixa\b", f):
        return say(_spotify(user, "next"))
    if re.search(r"\b(musica|faixa) anterior\b|\bvoltar (a )?musica\b", f):
        return say(_spotify(user, "previous"))
    if re.search(r"\b(continuar|continue|retomar|retome|despausar?)\b.*\b(musica|spotify)\b", f):
        return say(_spotify(user, "play"))
    m = re.match(r"^(?:toque|tocar|toca|coloque|coloca|bota|ponha|ouvir|quero ouvir)\s+(.+?)(?:\s+no spotify)?$", f)
    if m:
        q = raw[m.start(1):m.end(1)].strip(" .")
        q = re.sub(r"(?i)^(a musica|uma musica|música|a música|musica)\s+", "", q)
        return say(_spotify(user, "search_play", q, out))

    # Windows
    m = re.search(r"\bvolume\b.*?\b(\d{1,3})\b", f) or re.search(r"\b(\d{1,3})\s*%?\s*(?:de|do|no)?\s*volume\b", f)
    if m:
        return say(windows_text(user, "volume", {"level": int(m.group(1))}))
    if re.search(r"\b(aumente|aumenta|aumentar|suba|sobe)\b.*\bvolume\b", f):
        return say(windows_text(user, "volume", {"action": "up"}))
    if re.search(r"\b(abaixe|abaixa|abaixar|diminua|diminui|diminuir|baixe|baixa)\b.*\bvolume\b", f):
        return say(windows_text(user, "volume", {"action": "down"}))
    if re.search(r"\b(mudo|silencie|silenciar|tire o som|mute)\b", f):
        return say(windows_text(user, "volume", {"action": "mute"}))
    if re.search(r"\b(uso do (computador|pc)|cpu|processador|memoria do (computador|pc)|como esta o (computador|pc)|desempenho do pc)\b", f):
        return say(windows_text(user, "system_info", {}))
    m = re.match(r"^(?:abra|abrir|abre|inicie|iniciar|inicia|execute|executar|rode)\s+(?:o |a |os |as )?(.+?)(?:\s+no (?:computador|pc|windows))?$", f)
    if m:
        target = raw[m.start(1):m.end(1)].strip(" .")
        ft = fold(target)
        apps = s["windows_apps"]
        app = next((a for a in apps if fold(a) == ft), None) or next((a for a in apps if fold(a) in ft or ft in fold(a)), None)
        if app:
            return say(windows_text(user, "open_app", {"name": app}))
        panels = {"agenda": "agenda", "assistente": "assistente", "meu espaco": "espaco", "tarefas": "espaco",
                  "servicos": "servicos", "produtividade": "produtividade", "pomodoro": "produtividade",
                  "configuracoes": "config", "windows": "windows", "spotify": "servicos"}
        if ft in panels:
            out["client_actions"].append({"type": "open_panel", "panel": panels[ft]})
            return say(f"Abrindo {target}.")
        site = re.sub(r"\s+", "", ft)
        if "." in site or any(fold(x).split(".")[0] == site for x in s["windows_sites"]):
            url = site if "." in site else next(x for x in s["windows_sites"] if fold(x).split(".")[0] == site)
            if online_device(user):
                return say(windows_text(user, "open_site", {"url": url}))
            out["client_actions"].append({"type": "open_url", "url": url if "://" in url else "https://" + url})
            return say(f"Abrindo {url}.")
        return say(f"“{target}” não está na lista de aplicativos autorizados. Adicione no painel Windows.")

    if re.search(r"\b(bom dia|boa tarde|boa noite|resumo do dia|meu dia|briefing)\b", f):
        from .scheduler import briefing
        return say(briefing(user))
    if re.search(r"^(oi|ola|e ai|eai|hey|opa|tudo bem|como vai|salve)\b", f):
        nome = s.get("name")
        return say(f"Olá{', ' + nome if nome else ''}! Como posso ajudar?")
    if re.search(r"\b(obrigad[oa]|valeu|agradeco)\b", f):
        return say("Às ordens.")
    if re.search(r"\b(quem e voce|qual (e )?o seu nome|o que e voce)\b", f):
        return say("Sou o JARVIS, seu assistente pessoal.")

    return say("Não entendi bem. Diga “ajuda” para ver o que posso fazer." +
               ("" if ai_available() else " Para conversas livres, configure a chave de IA no servidor."))


def _repeat_from(f: str) -> str:
    if re.search(r"\b(todo dia|todos os dias|diariamente)\b", f):
        return "daily"
    if re.search(r"\b(dias uteis|de segunda a sexta)\b", f):
        return "weekdays"
    if re.search(r"\b(toda semana|todas as semanas|semanalmente|toda (segunda|terca|quarta|quinta|sexta)|todo (sabado|domingo))\b", f):
        return "weekly"
    if re.search(r"\b(todo mes|mensalmente)\b", f):
        return "monthly"
    return "none"


def _spotify(user, action, query="", out=None):
    from .services_api import spotify_control
    if not services.spotify_configured():
        if action == "search_play" and out is not None:
            from urllib.parse import quote
            out["client_actions"].append({"type": "open_url", "url": f"https://open.spotify.com/search/{quote(query)}"})
            return f"Abrindo a busca por “{query}” no Spotify."
        return "O controle do Spotify não está configurado no servidor."
    try:
        return spotify_control(user.id, action, query)
    except Exception as e:  # noqa: BLE001
        return f"Spotify: {e}."


# ====================================================================== IA (Claude)
def ai_available() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY"))


TOOLS = [
    {"name": "list_items", "description": "Lista itens do Meu Espaço do usuário (tarefas, ideias, anotações, projetos, pesquisas).",
     "input_schema": {"type": "object", "properties": {
         "kind": {"type": "string", "enum": ["task", "subtask", "idea", "note", "project", "research"]},
         "status": {"type": "string", "description": "pendente, andamento, concluida, nova, convertida"},
         "query": {"type": "string"}}}},
    {"name": "list_agenda", "description": "Lista compromissos a partir de uma data (AAAA-MM-DD) por N dias.",
     "input_schema": {"type": "object", "properties": {"start_date": {"type": "string"}, "days": {"type": "integer"}}}},
    {"name": "get_weather", "description": "Clima atual e previsão de 7 dias.",
     "input_schema": {"type": "object", "properties": {"city": {"type": "string"}}}},
    {"name": "get_quotes", "description": "Cotações reais de BBAS3, Ibovespa, dólar e euro.",
     "input_schema": {"type": "object", "properties": {}}},
    {"name": "get_news", "description": "Manchetes do Google Notícias Brasil (opcionalmente sobre um tema).",
     "input_schema": {"type": "object", "properties": {"topic": {"type": "string"}}}},
    {"name": "search_my_data", "description": "Pesquisa geral nos dados do usuário (itens, compromissos, memórias).",
     "input_schema": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}},
    {"name": "propose_change", "description": (
        "Propõe uma alteração nos dados do usuário. NADA é alterado até o usuário confirmar na tela. "
        "Tipos: create_item{kind,title,body?,due?,parent_id?}, update_item{id,fields{title?,body?,status?,priority?,due?}}, "
        "delete_item{id}, convert_item{id,to: task|project} (mantém o original), "
        "create_event{title,start,end?,recurrence?: none|daily|weekdays|weekly|monthly|yearly,until?,reminder_minutes?,location?,alarm?}, "
        "delete_event{id}, create_reminder{title,at,kind?: lembrete|alarme,repeat?: none|daily|weekdays|weekly}, "
        "save_memory{content} (só quando o usuário pedir para lembrar algo sobre ele), delete_memory{id}, "
        "update_settings{values{city?,timezone?,name?}}. Datas no formato AAAA-MM-DDTHH:MM em hora local."),
     "input_schema": {"type": "object", "properties": {"action": {"type": "object"}}, "required": ["action"]}},
    {"name": "device_action", "description": (
        "Ações imediatas que não alteram dados: pomodoro{minutes?}, timer{seconds,label?,on_computer?}, "
        "open_panel{panel: assistente|espaco|agenda|servicos|produtividade|windows|config}, open_url{url}, "
        "windows{type: open_app|open_site|volume|system_info|timer, name?, url?, level?, action?: up|down|mute, seconds?}, "
        "spotify{action: play|pause|next|previous|search_play, query?}."),
     "input_schema": {"type": "object", "properties": {"kind": {"type": "string"}, "params": {"type": "object"}},
                      "required": ["kind"]}},
]


def system_prompt(user) -> str:
    s = user_settings(user)
    now = now_local(user)
    mems = db.scalars(select(Memory).where(Memory.user_id == user.id).order_by(Memory.id).limit(60)).all()
    mem_txt = "\n".join(f"- (#{m.id}) {m.content}" for m in mems) or "(nenhuma)"
    return f"""Você é o J.A.R.V.I.S., assistente pessoal do usuário, sempre em português do Brasil.
Personalidade: educado, eficiente, levemente espirituoso, como um mordomo de alta tecnologia.
Suas respostas são lidas em voz alta: seja breve (1 a 3 frases), sem markdown, listas ou emojis.

Agora: {DIAS_NOME[now.weekday()]}, {now.strftime('%d/%m/%Y %H:%M')} (fuso {s['timezone']}).
Cidade padrão: {s['city']}. Nome do usuário: {s.get('name') or 'não informado'}.
Apps autorizados no Windows: {', '.join(s['windows_apps']) or 'nenhum'}. Sites autorizados: {', '.join(s['windows_sites']) or 'nenhum'}.

Memórias que o usuário autorizou guardar:
{mem_txt}

Regras:
- Use as ferramentas para consultar dados reais; nunca invente cotações, clima, compromissos ou tarefas.
- Toda criação, edição ou exclusão de dados deve ser feita com propose_change. Depois diga em uma frase o que
  vai fazer e peça confirmação; nunca diga que já fez algo que ainda depende de confirmação.
- Só guarde memórias quando o usuário pedir explicitamente (ex.: “lembre que…”, “guarde que…”).
- Para lembrar o usuário de algo em um horário, use create_reminder; para reuniões e compromissos, create_event.
- Se faltar informação essencial (ex.: horário), pergunte antes de propor."""


def _tool(user, name: str, inp: dict, out: dict) -> str:
    from .api import event_json, item_json
    if name == "list_items":
        q = select(Item).where(Item.user_id == user.id)
        if inp.get("kind"):
            q = q.where(Item.kind == inp["kind"])
        if inp.get("status"):
            q = q.where(Item.status == inp["status"])
        if inp.get("query"):
            like = f"%{inp['query']}%"
            q = q.where(or_(Item.title.ilike(like), Item.body.ilike(like)))
        rows = db.scalars(q.order_by(Item.updated_at.desc()).limit(40)).all()
        return json.dumps([{k: v for k, v in item_json(r).items() if k in ("id", "kind", "title", "status", "priority", "due", "parent_id")}
                           | {"body": (r.body or "")[:200]} for r in rows], ensure_ascii=False)
    if name == "list_agenda":
        from .util import parse_dt
        now = now_local(user)
        start = parse_dt(inp.get("start_date")) or now.replace(hour=0, minute=0, second=0)
        days = max(1, min(60, int(inp.get("days") or 7)))
        end = start + timedelta(days=days)
        res = []
        for ev in db.scalars(select(Event).where(Event.user_id == user.id, Event.start < end)).all():
            for a, b in occurrences(ev, start, end):
                res.append({**{k: v for k, v in event_json(ev).items() if k in ("id", "title", "location", "recurrence", "all_day")},
                            "start": iso(a), "end": iso(b)})
        res.sort(key=lambda x: x["start"])
        return json.dumps(res[:80], ensure_ascii=False)
    if name == "get_weather":
        return json.dumps(services.weather(inp.get("city") or user_settings(user)["city"]), ensure_ascii=False)
    if name == "get_quotes":
        return json.dumps([{k: q.get(k) for k in ("symbol", "name", "price", "formatted", "change_pct", "source")}
                           for q in services.quotes()], ensure_ascii=False)
    if name == "get_news":
        return json.dumps(services.news(inp.get("topic", ""), 8), ensure_ascii=False)
    if name == "search_my_data":
        like = f"%{inp.get('query', '')}%"
        its = db.scalars(select(Item).where(Item.user_id == user.id, or_(Item.title.ilike(like), Item.body.ilike(like))).limit(15)).all()
        evs = db.scalars(select(Event).where(Event.user_id == user.id, Event.title.ilike(like)).limit(10)).all()
        mems = db.scalars(select(Memory).where(Memory.user_id == user.id, Memory.content.ilike(like)).limit(10)).all()
        return json.dumps({"items": [{"id": i.id, "kind": i.kind, "title": i.title, "status": i.status} for i in its],
                           "events": [{"id": e.id, "title": e.title, "start": iso(e.start)} for e in evs],
                           "memories": [{"id": m.id, "content": m.content} for m in mems]}, ensure_ascii=False)
    if name == "propose_change":
        action = inp.get("action") or {}
        p = actions.propose(user, action)
        out["pending"].append(p)
        return f"Proposta #{p['id']} registrada: {p['summary']}. Aguardando confirmação do usuário."
    if name == "device_action":
        kind = inp.get("kind")
        params = inp.get("params") or {}
        if kind == "pomodoro":
            out["client_actions"].append({"type": "pomodoro", "minutes": int(params.get("minutes") or user_settings(user)["pomodoro_focus"])})
            return "Pomodoro iniciado no aparelho do usuário."
        if kind == "timer":
            secs = int(params.get("seconds") or 60)
            if params.get("on_computer"):
                return windows_text(user, "timer", {"seconds": secs, "label": params.get("label")})
            out["client_actions"].append({"type": "timer", "seconds": secs, "label": params.get("label") or "Temporizador"})
            return "Temporizador iniciado."
        if kind == "open_panel":
            out["client_actions"].append({"type": "open_panel", "panel": params.get("panel", "assistente")})
            return "Painel aberto."
        if kind == "open_url":
            url = str(params.get("url", ""))
            if not url.startswith(("http://", "https://")):
                url = "https://" + url
            out["client_actions"].append({"type": "open_url", "url": url})
            return "Link aberto no aparelho."
        if kind == "windows":
            ctype = params.get("type", "")
            return windows_text(user, ctype, {k: v for k, v in params.items() if k != "type"})
        if kind == "spotify":
            return _spotify(user, params.get("action", ""), params.get("query", ""), out)
        return "Ação desconhecida."
    return "Ferramenta desconhecida."


def ai_reply(user, text: str, out: dict) -> str:
    import anthropic
    client = anthropic.Anthropic(timeout=60, max_retries=1)
    hist = db.scalars(select(Message).where(Message.user_id == user.id).order_by(Message.id.desc())
                      .limit(HISTORY_TURNS)).all()[::-1]
    messages = []
    for m in hist:
        role = "assistant" if m.role == "assistant" else "user"
        if messages and messages[-1]["role"] == role:
            messages[-1]["content"] += "\n" + m.content
        else:
            messages.append({"role": role, "content": m.content})
    while messages and messages[0]["role"] != "user":
        messages.pop(0)
    if messages and messages[-1]["role"] == "user":
        messages[-1]["content"] += "\n" + text
    else:
        messages.append({"role": "user", "content": text})

    system = system_prompt(user)
    final = ""
    for _ in range(6):
        resp = client.beta.messages.create(
            model=MODEL, max_tokens=4000, system=system, tools=TOOLS, messages=messages,
            thinking={"type": "adaptive"}, output_config={"effort": os.environ.get("JARVIS_EFFORT", "low")},
            betas=["server-side-fallback-2026-07-01"], fallbacks="default",
        )
        if resp.stop_reason == "refusal":
            return "Desculpe, não posso ajudar com isso."
        texts = [b.text for b in resp.content if b.type == "text"]
        if texts:
            final = " ".join(t.strip() for t in texts if t.strip())
        if resp.stop_reason == "pause_turn":
            messages.append({"role": "assistant", "content": resp.content})
            continue
        uses = [b for b in resp.content if b.type == "tool_use"]
        if resp.stop_reason != "tool_use" or not uses:
            break
        messages.append({"role": "assistant", "content": resp.content})
        results = []
        for u in uses:
            try:
                res = _tool(user, u.name, dict(u.input or {}), out)
                results.append({"type": "tool_result", "tool_use_id": u.id, "content": res[:20000]})
            except Exception as e:  # noqa: BLE001
                results.append({"type": "tool_result", "tool_use_id": u.id, "content": f"Erro: {e}", "is_error": True})
        messages.append({"role": "user", "content": results})
    return final or "Certo."


def handle(user, text: str) -> dict:
    text = text.strip()[:4000]
    out = {"reply": "", "pending": [], "client_actions": []}
    f = fold(text).strip(" .!")
    use_ai = ai_available() and user_settings(user).get("ai_enabled", True)
    # confirmações por voz e comandos simples ficam sempre no interpretador local (rápido)
    if not use_ai or YES.match(f) or NO.match(f):
        out = rules(user, text)
    else:
        try:
            out["reply"] = ai_reply(user, text, out)
            out["engine"] = "ia"
        except Exception as e:  # noqa: BLE001
            log.warning("IA indisponível, usando regras: %s", e)
            db.rollback()
            out = rules(user, text)
    out.setdefault("engine", "regras")
    db.add(Message(user_id=user.id, role="user", content=text))
    db.add(Message(user_id=user.id, role="assistant", content=out["reply"]))
    db.commit()
    return out


# ====================================================================== rotas
@bp.post("/chat")
@login_required
def chat():
    data = request.get_json(silent=True) or {}
    text = str(data.get("text", "")).strip()
    if not text:
        return jsonify({"error": "mensagem vazia"}), 400
    return jsonify(handle(g.user, text))


@bp.post("/confirm/<int:pid>")
@login_required
def confirm(pid):
    accept = bool((request.get_json(silent=True) or {}).get("accept", True))
    try:
        res = actions.resolve(g.user, pid, accept)
    except LookupError:
        return jsonify({"error": "pendência não encontrada"}), 404
    db.add(Message(user_id=g.user.id, role="assistant", content=res["message"]))
    db.commit()
    return jsonify(res)


@bp.get("/history")
@login_required
def history():
    rows = db.scalars(select(Message).where(Message.user_id == g.user.id).order_by(Message.id.desc()).limit(200)).all()
    return jsonify([{"id": m.id, "role": m.role, "content": m.content, "created_at": iso(m.created_at)} for m in rows[::-1]])


@bp.delete("/history")
@login_required
def clear_history():
    db.execute(delete(Message).where(Message.user_id == g.user.id))
    db.commit()
    return jsonify({"ok": True})


@bp.get("/status")
@login_required
def status():
    return jsonify({"ai": ai_available(), "model": MODEL if ai_available() else None})
