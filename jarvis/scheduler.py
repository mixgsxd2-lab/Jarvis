"""Gera notificações devidas: lembretes, alarmes, compromissos, rotinas e alertas de preço.

No Render Free o servidor "dorme" sem acessos. Por isso o processamento acontece:
 * quando o app está aberto (o navegador chama /api/tick a cada 30 s);
 * quando um serviço externo gratuito (ex.: cron-job.org) chama /cron/tick?key=... —
   aí o JARVIS também envia notificações push para o celular, mesmo com o app fechado.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from .models import (Event, Item, Notification, PriceAlert, Reminder, Routine, User,
                     db, utcnow)
from .util import fmt_dt, now_local, occurrences, user_settings

log = logging.getLogger("jarvis.scheduler")
WINDOW = timedelta(hours=6)  # não dispara itens atrasados há mais tempo que isso


def notify(user_id: int, key: str, title: str, body: str = "", kind: str = "lembrete") -> bool:
    exists = db.scalar(select(Notification.id).where(Notification.user_id == user_id, Notification.key == key))
    if exists:
        return False
    db.add(Notification(user_id=user_id, key=key, title=title[:300], body=body, kind=kind))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        return False
    return True


def _next_repeat(at: datetime, repeat: str, now: datetime) -> datetime | None:
    if repeat == "none":
        return None
    nxt = at
    for _ in range(4000):
        if repeat == "daily":
            nxt += timedelta(days=1)
        elif repeat == "weekly":
            nxt += timedelta(days=7)
        elif repeat == "weekdays":
            nxt += timedelta(days=1)
            while nxt.weekday() >= 5:
                nxt += timedelta(days=1)
        if nxt > now:
            return nxt
    return None


def briefing(user) -> str:
    from . import services
    s = user_settings(user)
    now = now_local(user)
    parts = []
    nome = s.get("name") or ""
    hora = now.hour
    saud = "Bom dia" if hora < 12 else "Boa tarde" if hora < 18 else "Boa noite"
    parts.append(f"{saud}{', ' + nome if nome else ''}.")
    try:
        w = services.weather(s["city"])
        c = w["current"]
        parts.append(f"Em {w['city']}, {c['description'].lower()}, {round(c['temperature'])} graus.")
    except Exception:
        pass
    start = now.replace(hour=0, minute=0, second=0)
    evs = db.scalars(select(Event).where(Event.user_id == user.id, Event.start < start + timedelta(days=1))).all()
    occ = []
    for ev in evs:
        for a, _b in occurrences(ev, start, start + timedelta(days=1)):
            occ.append((a, ev.title))
    occ.sort()
    if occ:
        lista = "; ".join(f"{t} às {a.strftime('%H:%M')}" for a, t in occ[:5])
        parts.append(f"Hoje você tem {len(occ)} compromisso{'s' if len(occ) > 1 else ''}: {lista}.")
    else:
        parts.append("Sua agenda de hoje está livre.")
    pend = db.scalars(select(Item).where(Item.user_id == user.id, Item.kind == "task",
                                         Item.status != "concluida")).all()
    if pend:
        parts.append(f"Há {len(pend)} tarefa{'s' if len(pend) > 1 else ''} pendente{'s' if len(pend) > 1 else ''}.")
    return " ".join(parts)


def run_routine(user, r: Routine, today: str) -> None:
    from .api import create_item
    texts = []
    kind = "rotina"
    for act in r.actions or []:
        t = act.get("type")
        val = str(act.get("value") or "")
        if t == "briefing":
            texts.append(briefing(user))
        elif t == "message" and val:
            texts.append(val)
        elif t == "task" and val:
            create_item(user.id, {"kind": "task", "title": val})
            texts.append(f"Tarefa criada: {val}.")
        elif t == "focus":
            kind = "rotina_foco"
            texts.append("Hora de focar. Iniciando um Pomodoro.")
    r.last_run = today
    db.commit()
    notify(user.id, f"rot:{r.id}:{today}", f"Rotina: {r.name}", " ".join(texts) or r.name, kind)


def process_user(user: User) -> None:
    now = now_local(user)
    # lembretes e alarmes
    for r in db.scalars(select(Reminder).where(Reminder.user_id == user.id, Reminder.done.is_(False),
                                               Reminder.at <= now)).all():
        if now - r.at <= WINDOW:
            notify(user.id, f"rem:{r.id}:{r.at.isoformat()}", r.title,
                   ("Alarme" if r.kind == "alarme" else "Lembrete") + f" — {r.at.strftime('%H:%M')}",
                   "alarme" if r.kind == "alarme" else "lembrete")
        nxt = _next_repeat(r.at, r.repeat, now)
        if nxt:
            r.at = nxt
        else:
            r.done = True
        db.commit()

    # lembretes de compromissos
    horizon_start = now - WINDOW
    evs = db.scalars(select(Event).where(Event.user_id == user.id, Event.reminder_minutes.is_not(None),
                                         Event.start < now + timedelta(days=3))).all()
    for ev in evs:
        for s, _e in occurrences(ev, horizon_start, now + timedelta(days=2), limit=20):
            fire = s - timedelta(minutes=ev.reminder_minutes or 0)
            if fire <= now and now - fire <= WINDOW and s >= now - timedelta(minutes=30):
                mins = ev.reminder_minutes or 0
                quando = "agora" if mins == 0 else f"em {mins} min" if mins < 60 else fmt_dt(s, now)
                notify(user.id, f"ev:{ev.id}:{s.isoformat()}", ev.title,
                       f"Compromisso {quando} ({s.strftime('%H:%M')})" + (f" — {ev.location}" if ev.location else ""),
                       "alarme" if ev.alarm else "lembrete")

    # rotinas automáticas
    today = now.strftime("%Y-%m-%d")
    for r in db.scalars(select(Routine).where(Routine.user_id == user.id, Routine.enabled.is_(True))).all():
        if r.last_run == today or now.weekday() not in (r.days or []):
            continue
        try:
            hh, mm = [int(x) for x in r.time.split(":")]
        except ValueError:
            continue
        due = now.replace(hour=hh, minute=mm, second=0)
        if due <= now and now - due <= timedelta(hours=3):
            try:
                run_routine(user, r, today)
            except Exception:  # noqa: BLE001
                log.exception("falha na rotina %s", r.id)
                db.rollback()

    # alertas de cotação
    alerts = db.scalars(select(PriceAlert).where(PriceAlert.user_id == user.id, PriceAlert.active.is_(True))).all()
    if alerts:
        from . import services
        try:
            quotes = {q["symbol"]: q for q in services.quotes()}
        except Exception:
            quotes = {}
        for a in alerts:
            q = quotes.get(a.symbol)
            if not q or q.get("price") is None:
                continue
            p = q["price"]
            if (a.direction == "acima" and p >= a.price) or (a.direction == "abaixo" and p <= a.price):
                a.active = False
                a.triggered_at = utcnow()
                db.commit()
                notify(user.id, f"alert:{a.id}", f"Alerta: {q['name']}",
                       f"{q['name']} está em {services.fmt_price(a.symbol, p)} ({a.direction} de "
                       f"{services.fmt_price(a.symbol, a.price)}).", "alerta")


def process_all(send_push: bool = True) -> dict:
    from . import push
    users = db.scalars(select(User)).all()
    sent = 0
    for u in users:
        try:
            process_user(u)
        except Exception:  # noqa: BLE001
            log.exception("falha ao processar usuário %s", u.id)
            db.rollback()
            continue
        if not send_push:
            continue
        pend = db.scalars(select(Notification).where(Notification.user_id == u.id,
                                                     Notification.delivered.is_(False))).all()
        for n in pend:
            if push.send_to_user(u.id, {"title": n.title, "body": n.body, "kind": n.kind, "tag": n.key}):
                n.delivered = True
                sent += 1
        db.commit()
    return {"users": len(users), "push_sent": sent}
