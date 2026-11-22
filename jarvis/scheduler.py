"""Gera avisos devidos: lembretes, alarmes, compromissos e tarefas com prazo.

No Render Free o servidor "dorme" sem acessos. Por isso o processamento acontece:
 * quando o app está aberto (o navegador chama /api/tick a cada 30 s);
 * quando um agendador externo gratuito (ex.: cron-job.org) chama /cron/tick?key=... —
   aí também são enviadas notificações push para o celular, mesmo com o app fechado.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from .models import Event, Item, Notification, Reminder, User, db
from .util import fmt_dt, now_local, occurrences

log = logging.getLogger("jarvis.scheduler")
WINDOW = timedelta(hours=6)  # não dispara avisos atrasados há mais tempo que isso


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


def next_repeat(at: datetime, repeat: str, now: datetime) -> datetime | None:
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
        else:
            return None
        if nxt > now:
            return nxt
    return None


def process_user(user: User) -> None:
    now = now_local(user)

    # lembretes e alarmes
    for r in db.scalars(select(Reminder).where(Reminder.user_id == user.id, Reminder.done.is_(False),
                                               Reminder.at <= now)).all():
        if now - r.at <= WINDOW:
            notify(user.id, f"rem:{r.id}:{r.at.isoformat()}", r.title,
                   ("Alarme" if r.kind == "alarme" else "Lembrete") + f" · {r.at.strftime('%H:%M')}",
                   "alarme" if r.kind == "alarme" else "lembrete")
        nxt = next_repeat(r.at, r.repeat, now)
        if nxt:
            r.at = nxt
        else:
            r.done = True
        db.commit()

    # avisos de compromissos
    evs = db.scalars(select(Event).where(Event.user_id == user.id, Event.reminder_minutes.is_not(None),
                                         Event.start < now + timedelta(days=3))).all()
    for ev in evs:
        for s, _e in occurrences(ev, now - WINDOW, now + timedelta(days=2), limit=20):
            fire = s - timedelta(minutes=ev.reminder_minutes or 0)
            if fire <= now and now - fire <= WINDOW and s >= now - timedelta(minutes=30):
                mins = ev.reminder_minutes or 0
                quando = "agora" if mins == 0 else f"em {mins} min" if mins < 60 else fmt_dt(s, now)
                notify(user.id, f"ev:{ev.id}:{s.isoformat()}", ev.title,
                       f"Compromisso {quando} ({s.strftime('%H:%M')})" + (f" · {ev.location}" if ev.location else ""),
                       "alarme" if ev.alarm else "lembrete")

    # tarefas cujo prazo (com horário) chegou
    tasks = db.scalars(select(Item).where(Item.user_id == user.id, Item.kind.in_(("task", "subtask")),
                                          Item.status != "concluida", Item.due.is_not(None),
                                          Item.due <= now, Item.due >= now - WINDOW)).all()
    for t in tasks:
        if t.due.hour == 0 and t.due.minute == 0:
            continue  # prazo só com data: aparece em "Hoje", sem aviso sonoro
        notify(user.id, f"due:{t.id}:{t.due.isoformat()}", t.title, f"Prazo da tarefa · {t.due.strftime('%H:%M')}", "prazo")


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
