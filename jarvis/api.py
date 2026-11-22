"""API do Meu Espaço, Agenda, Memória, Configurações, exportação e notificações."""
from __future__ import annotations

import io
import json
from datetime import datetime, timedelta

from flask import Blueprint, Response, g, jsonify, request, send_file
from sqlalchemy import delete, or_, select

from . import push, scheduler
from .auth import login_required, require_owner
from .models import (Attachment, Command, Device, Event, FocusSession, Goal, Item,
                     Memory, Message, Notification, PendingAction, PriceAlert,
                     PushSubscription, Reminder, Routine, db, utcnow)
from .util import (DEFAULT_SETTINGS, RECURRENCES, find_conflicts, iso, now_local,
                   occurrences, parse_dt, user_settings)

bp = Blueprint("api", __name__, url_prefix="/api")

KINDS = ("task", "subtask", "idea", "note", "project", "research")
MAX_ATTACHMENT = 5 * 1024 * 1024


def body():
    return request.get_json(silent=True) or {}


# ------------------------------------------------------------------ serialização
def item_json(it: Item, with_children=False) -> dict:
    d = {
        "id": it.id, "kind": it.kind, "title": it.title, "body": it.body, "status": it.status,
        "priority": it.priority, "due": iso(it.due), "tags": it.tags or [], "parent_id": it.parent_id,
        "origin_id": it.origin_id, "position": it.position, "done_at": iso(it.done_at),
        "created_at": iso(it.created_at), "updated_at": iso(it.updated_at),
    }
    if with_children:
        kids = db.scalars(select(Item).where(Item.user_id == it.user_id, Item.parent_id == it.id)
                          .order_by(Item.position, Item.id)).all()
        d["children"] = [item_json(k) for k in kids]
        atts = db.scalars(select(Attachment).where(Attachment.item_id == it.id)).all()
        d["attachments"] = [att_json(a) for a in atts]
        derived = db.scalars(select(Item).where(Item.user_id == it.user_id, Item.origin_id == it.id)).all()
        d["derived"] = [{"id": x.id, "kind": x.kind, "title": x.title} for x in derived]
        if it.origin_id:
            o = db.get(Item, it.origin_id)
            if o and o.user_id == it.user_id:
                d["origin"] = {"id": o.id, "kind": o.kind, "title": o.title}
    return d


def att_json(a: Attachment) -> dict:
    return {"id": a.id, "item_id": a.item_id, "filename": a.filename, "mime": a.mime,
            "size": a.size, "created_at": iso(a.created_at)}


def event_json(ev: Event) -> dict:
    return {"id": ev.id, "title": ev.title, "start": iso(ev.start), "end": iso(ev.end),
            "all_day": ev.all_day, "recurrence": ev.recurrence, "until": iso(ev.until),
            "reminder_minutes": ev.reminder_minutes, "alarm": ev.alarm,
            "location": ev.location, "notes": ev.notes}


def reminder_json(r: Reminder) -> dict:
    return {"id": r.id, "title": r.title, "at": iso(r.at), "kind": r.kind,
            "repeat": r.repeat, "done": r.done}


def memory_json(m: Memory) -> dict:
    return {"id": m.id, "content": m.content, "created_at": iso(m.created_at)}


# ------------------------------------------------------------------ itens
def apply_item_fields(it: Item, data: dict) -> None:
    if "title" in data:
        it.title = str(data["title"] or "")[:300]
    if "body" in data:
        it.body = str(data["body"] or "")[:200_000]
    if "status" in data:
        new = str(data["status"] or "pendente")[:20]
        if new == "concluida" and it.status != "concluida":
            it.done_at = utcnow()
        elif new != "concluida":
            it.done_at = None
        it.status = new
    if "priority" in data:
        it.priority = max(0, min(3, int(data["priority"] or 0)))
    if "due" in data:
        it.due = parse_dt(data["due"])
    if "tags" in data:
        tags = data["tags"]
        if isinstance(tags, str):
            tags = [t.strip() for t in tags.split(",")]
        it.tags = [str(t)[:40] for t in tags if str(t).strip()][:20]
    if "parent_id" in data:
        pid = data["parent_id"]
        if pid:
            parent = db.get(Item, int(pid))
            if not parent or parent.user_id != it.user_id or parent.id == it.id:
                raise ValueError("item pai inválido")
            it.parent_id = parent.id
        else:
            it.parent_id = None
    if "position" in data:
        it.position = int(data["position"] or 0)


def create_item(user_id: int, data: dict) -> Item:
    kind = data.get("kind", "task")
    if kind not in KINDS:
        raise ValueError("tipo inválido")
    it = Item(user_id=user_id, kind=kind, title="", body="", tags=[],
              status="nova" if kind == "idea" else "pendente")
    apply_item_fields(it, data)
    db.add(it)
    db.commit()
    return it


@bp.get("/items")
@login_required
def list_items():
    q = select(Item).where(Item.user_id == g.user.id)
    kind = request.args.get("kind")
    if kind:
        q = q.where(Item.kind.in_(kind.split(",")))
    if request.args.get("parent"):
        q = q.where(Item.parent_id == int(request.args["parent"]))
    elif request.args.get("top") == "1":
        q = q.where(Item.parent_id.is_(None))
    status = request.args.get("status")
    if status:
        q = q.where(Item.status.in_(status.split(",")))
    text = request.args.get("q", "").strip()
    if text:
        like = f"%{text}%"
        q = q.where(or_(Item.title.ilike(like), Item.body.ilike(like)))
    q = q.order_by(Item.status == "concluida", Item.priority.desc(), Item.updated_at.desc()).limit(500)
    items = db.scalars(q).all()
    counts = {}
    if items:
        ids = [i.id for i in items]
        for child in db.scalars(select(Item).where(Item.parent_id.in_(ids))).all():
            c = counts.setdefault(child.parent_id, [0, 0])
            c[0] += 1
            if child.status == "concluida":
                c[1] += 1
    out = []
    for i in items:
        d = item_json(i)
        d["children_count"], d["children_done"] = counts.get(i.id, [0, 0])
        out.append(d)
    return jsonify(out)


@bp.post("/items")
@login_required
def post_item():
    try:
        it = create_item(g.user.id, body())
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    return jsonify(item_json(it, True)), 201


@bp.get("/items/<int:item_id>")
@login_required
def get_item(item_id):
    return jsonify(item_json(require_owner(db.get(Item, item_id)), True))


@bp.patch("/items/<int:item_id>")
@login_required
def patch_item(item_id):
    it = require_owner(db.get(Item, item_id))
    try:
        apply_item_fields(it, body())
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    it.updated_at = utcnow()
    db.commit()
    return jsonify(item_json(it, True))


def delete_item_tree(user_id: int, item_id: int) -> int:
    ids = [item_id]
    frontier = [item_id]
    while frontier:
        kids = db.scalars(select(Item.id).where(Item.user_id == user_id, Item.parent_id.in_(frontier))).all()
        frontier = [k for k in kids if k not in ids]
        ids.extend(frontier)
    db.execute(delete(Attachment).where(Attachment.item_id.in_(ids)))
    db.execute(delete(Item).where(Item.id.in_(ids), Item.user_id == user_id))
    db.commit()
    return len(ids)


@bp.delete("/items/<int:item_id>")
@login_required
def del_item(item_id):
    require_owner(db.get(Item, item_id))
    n = delete_item_tree(g.user.id, item_id)
    return jsonify({"ok": True, "deleted": n})


def convert_item(user_id: int, item_id: int, to: str) -> Item:
    src = db.get(Item, item_id)
    if not src or src.user_id != user_id:
        raise ValueError("item não encontrado")
    if to not in ("task", "project", "note", "idea"):
        raise ValueError("conversão inválida")
    new = Item(user_id=user_id, kind=to, title=src.title, body=src.body, tags=list(src.tags or []),
               priority=src.priority, due=src.due, origin_id=src.id,
               status="nova" if to == "idea" else "pendente")
    db.add(new)
    db.flush()
    # copia subtarefas/itens filhos como subtarefas do novo item
    for child in db.scalars(select(Item).where(Item.parent_id == src.id)).all():
        db.add(Item(user_id=user_id, kind="subtask" if to in ("task", "project") else child.kind,
                    title=child.title, body=child.body, tags=list(child.tags or []),
                    parent_id=new.id, status=child.status))
    if src.kind == "idea":
        src.status = "convertida"
    db.commit()
    return new


@bp.post("/items/<int:item_id>/convert")
@login_required
def convert(item_id):
    try:
        new = convert_item(g.user.id, item_id, body().get("to", "task"))
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    return jsonify(item_json(new, True)), 201


# ------------------------------------------------------------------ anexos
@bp.post("/items/<int:item_id>/attachments")
@login_required
def upload(item_id):
    it = require_owner(db.get(Item, item_id))
    f = request.files.get("file")
    if not f or not f.filename:
        return jsonify({"error": "arquivo ausente"}), 400
    data = f.read(MAX_ATTACHMENT + 1)
    if len(data) > MAX_ATTACHMENT:
        return jsonify({"error": "Arquivo maior que 5 MB."}), 413
    name = f.filename.replace("\\", "/").split("/")[-1][:255]
    a = Attachment(user_id=g.user.id, item_id=it.id, filename=name,
                   mime=(f.mimetype or "application/octet-stream")[:120], size=len(data), data=data)
    db.add(a)
    it.updated_at = utcnow()
    db.commit()
    return jsonify(att_json(a)), 201


@bp.get("/attachments/<int:att_id>")
@login_required
def download(att_id):
    a = require_owner(db.get(Attachment, att_id))
    inline = a.mime.startswith("image/") or a.mime == "application/pdf"
    resp = send_file(io.BytesIO(a.data), mimetype=a.mime, as_attachment=not inline, download_name=a.filename)
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["Content-Security-Policy"] = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox"
    return resp


@bp.delete("/attachments/<int:att_id>")
@login_required
def del_attachment(att_id):
    a = require_owner(db.get(Attachment, att_id))
    db.delete(a)
    db.commit()
    return jsonify({"ok": True})


# ------------------------------------------------------------------ pesquisa geral
@bp.get("/search")
@login_required
def search():
    text = request.args.get("q", "").strip()
    if len(text) < 2:
        return jsonify({"items": [], "events": [], "memories": [], "messages": []})
    like = f"%{text}%"
    uid = g.user.id
    items = db.scalars(select(Item).where(Item.user_id == uid, or_(Item.title.ilike(like), Item.body.ilike(like)))
                       .order_by(Item.updated_at.desc()).limit(50)).all()
    events = db.scalars(select(Event).where(Event.user_id == uid, or_(Event.title.ilike(like), Event.notes.ilike(like),
                                                                       Event.location.ilike(like))).limit(30)).all()
    mems = db.scalars(select(Memory).where(Memory.user_id == uid, Memory.content.ilike(like)).limit(30)).all()
    msgs = db.scalars(select(Message).where(Message.user_id == uid, Message.content.ilike(like))
                      .order_by(Message.id.desc()).limit(30)).all()
    return jsonify({
        "items": [item_json(i) for i in items],
        "events": [event_json(e) for e in events],
        "memories": [memory_json(m) for m in mems],
        "messages": [{"id": m.id, "role": m.role, "content": m.content, "created_at": iso(m.created_at)} for m in msgs],
    })


# ------------------------------------------------------------------ agenda
def apply_event_fields(ev: Event, data: dict) -> None:
    if "title" in data:
        ev.title = str(data["title"] or "Compromisso")[:300]
    if "start" in data:
        ev.start = parse_dt(data["start"], required=True)
    if "end" in data:
        ev.end = parse_dt(data["end"])
    if ev.end is None or ev.end <= ev.start:
        ev.end = ev.start + timedelta(hours=1)
    if "all_day" in data:
        ev.all_day = bool(data["all_day"])
    if ev.all_day:
        ev.start = ev.start.replace(hour=0, minute=0, second=0)
        if ev.end - ev.start < timedelta(days=1):
            ev.end = ev.start + timedelta(days=1) - timedelta(minutes=1)
    if "recurrence" in data:
        rec = data["recurrence"] or "none"
        if rec not in RECURRENCES:
            raise ValueError("recorrência inválida")
        ev.recurrence = rec
    if "until" in data:
        ev.until = parse_dt(data["until"])
    if "reminder_minutes" in data:
        rm = data["reminder_minutes"]
        ev.reminder_minutes = None if rm in (None, "", "none") else max(0, int(rm))
    if "alarm" in data:
        ev.alarm = bool(data["alarm"])
    if "location" in data:
        ev.location = str(data["location"] or "")[:300]
    if "notes" in data:
        ev.notes = str(data["notes"] or "")[:20000]


def event_conflicts(user_id: int, ev: Event) -> list:
    others = db.scalars(select(Event).where(Event.user_id == user_id)).all()
    if ev.all_day:
        return []
    found = {}
    horizon = ev.start + timedelta(days=90)
    for s, e in occurrences(ev, ev.start, horizon, limit=60):
        for c in find_conflicts(others, s, e, exclude_id=ev.id):
            found.setdefault(c["id"], c)
        if len(found) >= 10:
            break
    return list(found.values())


def create_event(user_id: int, data: dict) -> tuple[Event, list]:
    ev = Event(user_id=user_id, title="Compromisso", recurrence="none", location="", notes="")
    if not data.get("start"):
        raise ValueError("Informe a data e a hora de início.")
    apply_event_fields(ev, {"title": "Compromisso", **data})
    conflicts = event_conflicts(user_id, ev)
    db.add(ev)
    db.commit()
    return ev, conflicts


@bp.get("/events")
@login_required
def list_events():
    now = now_local(g.user)
    start = parse_dt(request.args.get("start")) or now.replace(day=1, hour=0, minute=0, second=0)
    end = parse_dt(request.args.get("end")) or start + timedelta(days=42)
    evs = db.scalars(select(Event).where(Event.user_id == g.user.id, Event.start < end)).all()
    out = []
    for ev in evs:
        base = event_json(ev)
        for s, e in occurrences(ev, start, end):
            out.append({**base, "occ_start": iso(s), "occ_end": iso(e)})
    out.sort(key=lambda x: x["occ_start"])
    return jsonify(out)


@bp.get("/events/all")
@login_required
def all_events():
    evs = db.scalars(select(Event).where(Event.user_id == g.user.id).order_by(Event.start)).all()
    return jsonify([event_json(e) for e in evs])


@bp.post("/events/check")
@login_required
def check_event():
    data = body()
    ev = Event(user_id=g.user.id, title="x", recurrence="none", id=int(data.get("id") or 0) or None)
    try:
        apply_event_fields(ev, {"title": "x", **data})
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    return jsonify({"conflicts": event_conflicts(g.user.id, ev)})


@bp.post("/events")
@login_required
def post_event():
    try:
        ev, conflicts = create_event(g.user.id, body())
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    return jsonify({"event": event_json(ev), "conflicts": conflicts}), 201


@bp.patch("/events/<int:ev_id>")
@login_required
def patch_event(ev_id):
    ev = require_owner(db.get(Event, ev_id))
    try:
        apply_event_fields(ev, body())
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    conflicts = event_conflicts(g.user.id, ev)
    db.commit()
    return jsonify({"event": event_json(ev), "conflicts": conflicts})


@bp.delete("/events/<int:ev_id>")
@login_required
def del_event(ev_id):
    ev = require_owner(db.get(Event, ev_id))
    db.delete(ev)
    db.commit()
    return jsonify({"ok": True})


# ------------------------------------------------------------------ lembretes e alarmes
def create_reminder(user_id: int, data: dict) -> Reminder:
    at = parse_dt(data.get("at"), required=True)
    kind = data.get("kind", "lembrete")
    if kind not in ("lembrete", "alarme"):
        kind = "lembrete"
    repeat = data.get("repeat", "none")
    if repeat not in ("none", "daily", "weekdays", "weekly"):
        repeat = "none"
    r = Reminder(user_id=user_id, title=str(data.get("title") or ("Alarme" if kind == "alarme" else "Lembrete"))[:300],
                 at=at, kind=kind, repeat=repeat, done=False)
    db.add(r)
    db.commit()
    return r


@bp.get("/reminders")
@login_required
def list_reminders():
    q = select(Reminder).where(Reminder.user_id == g.user.id)
    if request.args.get("all") != "1":
        q = q.where(Reminder.done.is_(False))
    return jsonify([reminder_json(r) for r in db.scalars(q.order_by(Reminder.at)).all()])


@bp.post("/reminders")
@login_required
def post_reminder():
    try:
        r = create_reminder(g.user.id, body())
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    return jsonify(reminder_json(r)), 201


@bp.patch("/reminders/<int:rid>")
@login_required
def patch_reminder(rid):
    r = require_owner(db.get(Reminder, rid))
    data = body()
    try:
        if "title" in data:
            r.title = str(data["title"])[:300]
        if "at" in data:
            r.at = parse_dt(data["at"], required=True)
            r.done = False
        if "kind" in data and data["kind"] in ("lembrete", "alarme"):
            r.kind = data["kind"]
        if "repeat" in data and data["repeat"] in ("none", "daily", "weekdays", "weekly"):
            r.repeat = data["repeat"]
        if "done" in data:
            r.done = bool(data["done"])
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    db.commit()
    return jsonify(reminder_json(r))


@bp.delete("/reminders/<int:rid>")
@login_required
def del_reminder(rid):
    r = require_owner(db.get(Reminder, rid))
    db.delete(r)
    db.commit()
    return jsonify({"ok": True})


# ------------------------------------------------------------------ memória autorizada
@bp.get("/memories")
@login_required
def list_memories():
    ms = db.scalars(select(Memory).where(Memory.user_id == g.user.id).order_by(Memory.id.desc())).all()
    return jsonify([memory_json(m) for m in ms])


@bp.post("/memories")
@login_required
def add_memory():
    # adicionar manualmente pelo painel já é a autorização explícita do usuário
    content = str(body().get("content", "")).strip()[:2000]
    if not content:
        return jsonify({"error": "conteúdo vazio"}), 400
    m = Memory(user_id=g.user.id, content=content)
    db.add(m)
    db.commit()
    return jsonify(memory_json(m)), 201


@bp.delete("/memories/<int:mid>")
@login_required
def del_memory(mid):
    m = require_owner(db.get(Memory, mid))
    db.delete(m)
    db.commit()
    return jsonify({"ok": True})


# ------------------------------------------------------------------ configurações
@bp.get("/settings")
@login_required
def get_settings():
    return jsonify(user_settings(g.user))


def update_settings(user, data: dict) -> dict:
    current = user_settings(user)
    for key, default in DEFAULT_SETTINGS.items():
        if key not in data:
            continue
        val = data[key]
        try:
            if isinstance(default, bool):
                val = bool(val)
            elif isinstance(default, int) and not isinstance(default, bool):
                val = int(val)
            elif isinstance(default, float):
                val = float(val)
            elif isinstance(default, list):
                if isinstance(val, str):
                    val = [v.strip() for v in val.split("\n")]
                val = [str(v).strip()[:300] for v in val if str(v).strip()][:50]
            else:
                val = str(val)[:300]
        except (TypeError, ValueError):
            continue
        if key == "timezone":
            from zoneinfo import ZoneInfo
            try:
                ZoneInfo(val)
            except Exception:
                continue
        current[key] = val
    user.settings = current
    db.commit()
    return current


@bp.put("/settings")
@login_required
def put_settings():
    return jsonify(update_settings(g.user, body()))


# ------------------------------------------------------------------ exportar meus dados
@bp.get("/export")
@login_required
def export():
    import base64
    uid = g.user.id

    def rows(model, fn):
        return [fn(r) for r in db.scalars(select(model).where(model.user_id == uid)).all()]

    data = {
        "exported_at": iso(utcnow()) + "Z",
        "user": {"username": g.user.username, "created_at": iso(g.user.created_at), "settings": user_settings(g.user)},
        "items": rows(Item, item_json),
        "attachments": rows(Attachment, lambda a: {**att_json(a), "data_base64": base64.b64encode(a.data).decode()}),
        "events": rows(Event, event_json),
        "reminders": rows(Reminder, reminder_json),
        "memories": rows(Memory, memory_json),
        "messages": rows(Message, lambda m: {"role": m.role, "content": m.content, "created_at": iso(m.created_at)}),
        "routines": rows(Routine, lambda r: {"name": r.name, "time": r.time, "days": r.days, "actions": r.actions,
                                             "enabled": r.enabled}),
        "focus_sessions": rows(FocusSession, lambda f: {"kind": f.kind, "minutes": f.minutes, "label": f.label,
                                                         "started_at": iso(f.started_at), "ended_at": iso(f.ended_at)}),
        "goals": rows(Goal, lambda x: {"title": x.title, "target": x.target, "current": x.current,
                                       "unit": x.unit, "period": x.period}),
        "price_alerts": rows(PriceAlert, lambda a: {"symbol": a.symbol, "direction": a.direction, "price": a.price,
                                                    "active": a.active}),
        "devices": rows(Device, lambda d: {"name": d.name, "last_seen": iso(d.last_seen)}),
    }
    payload = json.dumps(data, ensure_ascii=False, indent=2)
    stamp = datetime.now().strftime("%Y%m%d")
    return Response(payload, mimetype="application/json",
                    headers={"Content-Disposition": f'attachment; filename="jarvis-dados-{stamp}.json"'})


@bp.delete("/account")
@login_required
def delete_account():
    from werkzeug.security import check_password_hash
    if not check_password_hash(g.user.password_hash, str(body().get("password", ""))):
        return jsonify({"error": "Senha incorreta."}), 400
    uid = g.user.id
    for model in (Attachment, Command, Device, Item, Event, Reminder, Memory, Message, PendingAction,
                  Notification, Routine, FocusSession, Goal, PriceAlert, PushSubscription):
        db.execute(delete(model).where(model.user_id == uid))
    db.delete(g.user)
    db.commit()
    from flask import session
    session.clear()
    return jsonify({"ok": True})


# ------------------------------------------------------------------ notificações
@bp.get("/tick")
@login_required
def tick():
    """Chamado pelo app aberto a cada ~30 s: dispara lembretes, alarmes, rotinas e alertas."""
    scheduler.process_user(g.user)
    pending = db.scalars(select(Notification).where(Notification.user_id == g.user.id,
                                                    Notification.delivered.is_(False))
                         .order_by(Notification.id)).all()
    out = []
    for n in pending:
        out.append({"id": n.id, "title": n.title, "body": n.body, "kind": n.kind})
        n.delivered = True
    db.commit()
    return jsonify({"notifications": out, "now": iso(now_local(g.user))})


@bp.get("/push/key")
@login_required
def push_key():
    return jsonify({"key": push.public_key_b64()})


@bp.post("/push/subscribe")
@login_required
def push_subscribe():
    data = body()
    endpoint = str(data.get("endpoint", ""))
    keys = data.get("keys") or {}
    if not endpoint.startswith("https://") or not keys.get("p256dh") or not keys.get("auth"):
        return jsonify({"error": "inscrição inválida"}), 400
    db.execute(delete(PushSubscription).where(PushSubscription.endpoint == endpoint))
    db.add(PushSubscription(user_id=g.user.id, endpoint=endpoint, p256dh=keys["p256dh"], auth=keys["auth"]))
    db.commit()
    return jsonify({"ok": True})


@bp.post("/push/test")
@login_required
def push_test():
    sent = push.send_to_user(g.user.id, {"title": "JARVIS", "body": "Notificações ativadas com sucesso."})
    return jsonify({"sent": sent})


@bp.get("/pending")
@login_required
def list_pending():
    ps = db.scalars(select(PendingAction).where(PendingAction.user_id == g.user.id,
                                                PendingAction.status == "pending").order_by(PendingAction.id)).all()
    return jsonify([{"id": p.id, "summary": p.summary, "action": p.action} for p in ps])
