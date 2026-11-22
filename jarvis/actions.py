"""Ações que alteram dados do usuário. O assistente apenas PROPÕE estas ações;
elas só são executadas depois que o usuário confirma."""
from __future__ import annotations

from datetime import timedelta

from sqlalchemy import select

from .models import Event, Item, Memory, PendingAction, db
from .util import RECURRENCE_NAMES, fmt_dt, now_local, parse_dt

KIND_NAMES = {"task": "tarefa", "subtask": "subtarefa", "idea": "ideia", "note": "anotação",
              "project": "projeto", "research": "pesquisa"}


def describe(user, action: dict) -> str:
    t = action.get("type")
    now = now_local(user)
    if t == "create_item":
        s = f"Criar {KIND_NAMES.get(action.get('kind', 'task'), 'item')} “{action.get('title', '')}”"
        if action.get("due"):
            s += f" com prazo {fmt_dt(parse_dt(action['due']), now)}"
        return s
    if t == "update_item":
        it = db.get(Item, int(action.get("id", 0)))
        name = f"“{it.title}”" if it else f"#{action.get('id')}"
        f = action.get("fields", {})
        if f.get("status") == "concluida":
            return f"Marcar {name} como concluída"
        return f"Atualizar {name} ({', '.join(f.keys())})"
    if t == "delete_item":
        it = db.get(Item, int(action.get("id", 0)))
        return f"Excluir {KIND_NAMES.get(it.kind, 'item') if it else 'item'} “{it.title if it else action.get('id')}”"
    if t == "convert_item":
        it = db.get(Item, int(action.get("id", 0)))
        return f"Transformar “{it.title if it else '?'}” em {KIND_NAMES.get(action.get('to'), 'tarefa')} (mantendo o original)"
    if t == "create_event":
        s = f"Agendar “{action.get('title', 'Compromisso')}” {fmt_dt(parse_dt(action['start']), now)}"
        rec = action.get("recurrence", "none")
        if rec and rec != "none":
            s += f", {RECURRENCE_NAMES.get(rec, rec)}"
        if action.get("reminder_minutes") is not None:
            s += f", lembrete {action['reminder_minutes']} min antes"
        return s
    if t == "delete_event":
        ev = db.get(Event, int(action.get("id", 0)))
        return f"Excluir o compromisso “{ev.title if ev else action.get('id')}”"
    if t == "create_reminder":
        kind = "alarme" if action.get("kind") == "alarme" else "lembrete"
        s = f"Criar {kind} “{action.get('title', '')}” para {fmt_dt(parse_dt(action['at']), now)}"
        if action.get("repeat", "none") != "none":
            s += f" ({RECURRENCE_NAMES.get(action['repeat'], action['repeat'])})"
        return s
    if t == "save_memory":
        return f"Guardar na memória: “{action.get('content', '')}”"
    if t == "delete_memory":
        m = db.get(Memory, int(action.get("id", 0)))
        return f"Esquecer: “{m.content if m else action.get('id')}”"
    if t == "update_settings":
        nomes = {"city": "cidade", "timezone": "fuso horário", "name": "seu nome"}
        partes = [f"{nomes.get(k, k)} para “{v}”" for k, v in action.get("values", {}).items()]
        return "Alterar " + ", ".join(partes)
    return "Ação desconhecida"


def validate(user, action: dict) -> str | None:
    """Retorna mensagem de erro ou None."""
    t = action.get("type")
    try:
        if t == "create_item":
            if action.get("kind", "task") not in KIND_NAMES:
                return "tipo inválido"
            if not str(action.get("title", "")).strip():
                return "título vazio"
            parse_dt(action.get("due"))
        elif t in ("update_item", "delete_item", "convert_item"):
            it = db.get(Item, int(action.get("id", 0)))
            if not it or it.user_id != user.id:
                return "item não encontrado"
            if t == "convert_item" and action.get("to") not in ("task", "project", "note", "idea"):
                return "conversão inválida"
        elif t == "create_event":
            parse_dt(action.get("start"), required=True)
        elif t == "delete_event":
            ev = db.get(Event, int(action.get("id", 0)))
            if not ev or ev.user_id != user.id:
                return "compromisso não encontrado"
        elif t == "create_reminder":
            parse_dt(action.get("at"), required=True)
        elif t == "save_memory":
            if not str(action.get("content", "")).strip():
                return "memória vazia"
        elif t == "delete_memory":
            m = db.get(Memory, int(action.get("id", 0)))
            if not m or m.user_id != user.id:
                return "memória não encontrada"
        elif t == "update_settings":
            if not isinstance(action.get("values"), dict) or not action["values"]:
                return "nada para alterar"
            if set(action["values"]) - {"city", "timezone", "name"}:
                return "configuração não permitida"
        else:
            return "ação desconhecida"
    except (TypeError, ValueError) as e:
        return str(e)
    return None


def propose(user, action: dict) -> dict:
    err = validate(user, action)
    if err:
        raise ValueError(err)
    p = PendingAction(user_id=user.id, action=action, summary=describe(user, action)[:500], status="pending")
    db.add(p)
    db.commit()
    return {"id": p.id, "summary": p.summary}


def execute(user, action: dict) -> str:
    from . import api
    t = action["type"]
    if t == "create_item":
        data = {k: action[k] for k in ("kind", "title", "body", "due", "parent_id", "priority", "tags") if k in action}
        it = api.create_item(user.id, data)
        return f"{KIND_NAMES.get(it.kind, 'Item').capitalize()} “{it.title}” criada." if it.kind in ("task", "subtask", "idea", "note", "research") else f"Projeto “{it.title}” criado."
    if t == "update_item":
        it = db.get(Item, int(action["id"]))
        api.apply_item_fields(it, action.get("fields", {}))
        db.commit()
        return f"“{it.title}” atualizada."
    if t == "delete_item":
        it = db.get(Item, int(action["id"]))
        title = it.title
        api.delete_item_tree(user.id, it.id)
        return f"“{title}” excluída."
    if t == "convert_item":
        new = api.convert_item(user.id, int(action["id"]), action["to"])
        return f"Pronto: criei {KIND_NAMES.get(new.kind)} “{new.title}”. O original foi mantido."
    if t == "create_event":
        data = {k: action[k] for k in ("title", "start", "end", "recurrence", "until", "reminder_minutes",
                                        "location", "notes", "alarm", "all_day") if k in action}
        if "end" not in data:
            data["end"] = (parse_dt(data["start"]) + timedelta(hours=1)).isoformat()
        ev, conflicts = api.create_event(user.id, data)
        msg = f"Compromisso “{ev.title}” agendado para {fmt_dt(ev.start, now_local(user))}."
        if conflicts:
            msg += " Atenção: conflita com " + ", ".join(f"“{c['title']}”" for c in conflicts[:3]) + "."
        return msg
    if t == "delete_event":
        ev = db.get(Event, int(action["id"]))
        title = ev.title
        db.delete(ev)
        db.commit()
        return f"Compromisso “{title}” excluído."
    if t == "create_reminder":
        r = api.create_reminder(user.id, action)
        return f"{'Alarme' if r.kind == 'alarme' else 'Lembrete'} definido para {fmt_dt(r.at, now_local(user))}."
    if t == "save_memory":
        db.add(Memory(user_id=user.id, content=str(action["content"]).strip()[:2000]))
        db.commit()
        return "Guardado na memória."
    if t == "delete_memory":
        m = db.get(Memory, int(action["id"]))
        db.delete(m)
        db.commit()
        return "Esqueci essa informação."
    if t == "update_settings":
        api.update_settings(user, action["values"])
        return "Configurações atualizadas."
    raise ValueError("ação desconhecida")


def resolve(user, pending_id: int, accept: bool) -> dict:
    p = db.get(PendingAction, pending_id)
    if not p or p.user_id != user.id:
        raise LookupError("pendência não encontrada")
    if p.status != "pending":
        return {"id": p.id, "status": p.status, "message": "Essa ação já foi resolvida."}
    if not accept:
        p.status = "cancelled"
        db.commit()
        return {"id": p.id, "status": "cancelled", "message": "Tudo bem, cancelei."}
    err = validate(user, p.action)
    if err:
        p.status = "failed"
        db.commit()
        return {"id": p.id, "status": "failed", "message": f"Não foi possível: {err}."}
    try:
        msg = execute(user, p.action)
    except Exception as e:  # noqa: BLE001
        db.rollback()
        p = db.get(PendingAction, pending_id)
        p.status = "failed"
        db.commit()
        return {"id": p.id, "status": "failed", "message": f"Não foi possível: {e}."}
    p.status = "done"
    db.commit()
    return {"id": p.id, "status": "done", "message": msg}


def recent_pending(user, minutes: int = 15) -> list[PendingAction]:
    from .models import utcnow
    since = utcnow() - timedelta(minutes=minutes)
    return db.scalars(select(PendingAction).where(PendingAction.user_id == user.id,
                                                  PendingAction.status == "pending",
                                                  PendingAction.created_at >= since)
                      .order_by(PendingAction.id)).all()
