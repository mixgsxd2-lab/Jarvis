"""Integração opcional com Windows.

O servidor (no Render) não acessa o seu PC diretamente. Um pequeno agente
(windows_agent/jarvis_agent.py) roda no Windows, consulta o JARVIS a cada poucos
segundos e executa apenas comandos que estejam autorizados duas vezes:
na lista do painel Windows e na lista local do próprio agente.
"""
from __future__ import annotations

import hashlib
import secrets
from datetime import timedelta
from urllib.parse import urlparse

from flask import Blueprint, g, jsonify, request
from sqlalchemy import select

from .auth import login_required, require_owner
from .models import utcnow, Command, Device, User, db
from .util import iso, user_settings

bp = Blueprint("windows", __name__, url_prefix="/api")
COMMAND_TTL = timedelta(minutes=2)
ONLINE_WINDOW = timedelta(seconds=40)
TYPES = ("open_app", "open_site", "volume", "system_info", "timer")


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def device_json(d: Device) -> dict:
    online = bool(d.last_seen and utcnow() - d.last_seen < ONLINE_WINDOW)
    return {"id": d.id, "name": d.name, "last_seen": iso(d.last_seen), "online": online, "info": d.info or {}}


def command_json(c: Command) -> dict:
    return {"id": c.id, "device_id": c.device_id, "type": c.type, "payload": c.payload, "status": c.status,
            "result": c.result, "created_at": iso(c.created_at)}


def site_allowed(url: str, allowed: list[str]) -> bool:
    host = (urlparse(url).hostname or "").lower()
    if not host or urlparse(url).scheme not in ("http", "https"):
        return False
    for d in allowed:
        d = d.lower().strip()
        d = urlparse(d).hostname or d if "://" in d else d.split("/")[0]
        if d and (host == d or host.endswith("." + d)):
            return True
    return False


def validate_command(user: User, ctype: str, payload: dict) -> tuple[dict | None, str | None]:
    s = user_settings(user)
    if ctype not in TYPES:
        return None, "Comando desconhecido."
    if ctype == "open_app":
        name = str(payload.get("name", "")).strip()
        match = next((a for a in s["windows_apps"] if a.lower() == name.lower()), None)
        if not match:
            return None, f"O aplicativo “{name}” não está na lista de autorizados."
        return {"name": match}, None
    if ctype == "open_site":
        url = str(payload.get("url", "")).strip()
        if url and "://" not in url:
            url = "https://" + url
        if not site_allowed(url, s["windows_sites"]):
            return None, "Esse site não está na lista de autorizados."
        return {"url": url}, None
    if ctype == "volume":
        if payload.get("action") in ("up", "down", "mute", "unmute"):
            return {"action": payload["action"]}, None
        try:
            level = int(payload.get("level"))
        except (TypeError, ValueError):
            return None, "Volume inválido."
        return {"level": max(0, min(100, level))}, None
    if ctype == "timer":
        try:
            seconds = int(payload.get("seconds"))
        except (TypeError, ValueError):
            return None, "Tempo inválido."
        if not 1 <= seconds <= 24 * 3600:
            return None, "O temporizador deve ter entre 1 segundo e 24 horas."
        return {"seconds": seconds, "label": str(payload.get("label") or "Temporizador")[:100]}, None
    return {}, None


def default_device(user_id: int) -> Device | None:
    devs = db.scalars(select(Device).where(Device.user_id == user_id).order_by(Device.last_seen.desc())).all()
    return devs[0] if devs else None


def queue_command(user: User, ctype: str, payload: dict, device_id: int | None = None):
    clean, err = validate_command(user, ctype, payload or {})
    if err:
        return None, err
    dev = db.get(Device, device_id) if device_id else default_device(user.id)
    if not dev or dev.user_id != user.id:
        return None, "Nenhum computador Windows conectado. Configure o agente no painel Windows."
    c = Command(user_id=user.id, device_id=dev.id, type=ctype, payload=clean, status="pendente", result={})
    db.add(c)
    db.commit()
    if not device_json(dev)["online"]:
        return c, "O comando ficou na fila, mas o computador parece desligado (expira em 2 min)."
    return c, None


# ------------------------------------------------------------------ painel
@bp.get("/windows/devices")
@login_required
def list_devices():
    devs = db.scalars(select(Device).where(Device.user_id == g.user.id).order_by(Device.id)).all()
    return jsonify([device_json(d) for d in devs])


@bp.post("/windows/devices")
@login_required
def add_device():
    name = str((request.get_json(silent=True) or {}).get("name") or "Meu PC")[:100]
    token = "jv_" + secrets.token_urlsafe(32)
    d = Device(user_id=g.user.id, name=name, token_hash=hash_token(token), info={})
    db.add(d)
    db.commit()
    return jsonify({**device_json(d), "token": token}), 201


@bp.delete("/windows/devices/<int:did>")
@login_required
def del_device(did):
    d = require_owner(db.get(Device, did))
    db.delete(d)
    db.commit()
    return jsonify({"ok": True})


@bp.post("/windows/commands")
@login_required
def post_command():
    data = request.get_json(silent=True) or {}
    c, err = queue_command(g.user, data.get("type", ""), data.get("payload") or {}, data.get("device_id"))
    if c is None:
        return jsonify({"error": err}), 400
    return jsonify({**command_json(c), "warning": err}), 201


@bp.get("/windows/commands")
@login_required
def list_commands():
    rows = db.scalars(select(Command).where(Command.user_id == g.user.id).order_by(Command.id.desc()).limit(30)).all()
    return jsonify([command_json(c) for c in rows])


@bp.get("/windows/commands/<int:cid>")
@login_required
def get_command(cid):
    return jsonify(command_json(require_owner(db.get(Command, cid))))


# ------------------------------------------------------------------ agente
def _agent_device() -> Device | None:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return None
    return db.scalar(select(Device).where(Device.token_hash == hash_token(auth[7:].strip())))


@bp.post("/agent/poll")
def agent_poll():
    dev = _agent_device()
    if not dev:
        return jsonify({"error": "token inválido"}), 401
    data = request.get_json(silent=True) or {}
    dev.last_seen = utcnow()
    if isinstance(data.get("info"), dict):
        dev.info = {k: data["info"][k] for k in list(data["info"])[:30]}
    now = utcnow()
    cmds = db.scalars(select(Command).where(Command.device_id == dev.id, Command.status == "pendente")
                      .order_by(Command.id)).all()
    out = []
    for c in cmds:
        if now - c.created_at > COMMAND_TTL:
            c.status = "expirado"
            continue
        c.status = "enviado"
        out.append({"id": c.id, "type": c.type, "payload": c.payload})
    db.commit()
    return jsonify({"commands": out, "poll_seconds": 4})


@bp.post("/agent/result")
def agent_result():
    dev = _agent_device()
    if not dev:
        return jsonify({"error": "token inválido"}), 401
    data = request.get_json(silent=True) or {}
    c = db.get(Command, int(data.get("id") or 0))
    if not c or c.device_id != dev.id:
        return jsonify({"error": "comando não encontrado"}), 404
    c.status = "ok" if data.get("ok") else "erro"
    res = data.get("result")
    c.result = res if isinstance(res, dict) else {"message": str(res)[:1000]}
    if c.type == "system_info" and c.status == "ok":
        dev.info = {**(dev.info or {}), **c.result}
    db.commit()
    return jsonify({"ok": True})
