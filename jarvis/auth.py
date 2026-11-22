"""Login seguro: senhas com hash, sessão assinada, CSRF e limite de tentativas."""
from __future__ import annotations

import secrets
import time
from collections import defaultdict
from functools import wraps
from threading import Lock

from flask import Blueprint, abort, g, jsonify, request, session
from sqlalchemy import func, select
from werkzeug.security import check_password_hash, generate_password_hash

from .models import User, db
from .util import DEFAULT_SETTINGS, user_settings

bp = Blueprint("auth", __name__, url_prefix="/api/auth")

_attempts: dict[str, list[float]] = defaultdict(list)
_lock = Lock()
MAX_ATTEMPTS = 8
WINDOW = 15 * 60


def _client_ip() -> str:
    fwd = request.headers.get("X-Forwarded-For", "")
    return (fwd.split(",")[0].strip() if fwd else request.remote_addr) or "?"


def _too_many(key: str, limit: int = MAX_ATTEMPTS) -> bool:
    now = time.time()
    with _lock:
        _attempts[key] = [t for t in _attempts[key] if now - t < WINDOW]
        return len(_attempts[key]) >= limit


def _record_fail(key: str) -> None:
    with _lock:
        _attempts[key].append(time.time())


def reset_attempts() -> None:
    with _lock:
        _attempts.clear()


def current_user():
    uid = session.get("uid")
    if not uid:
        return None
    user = db.get(User, uid)
    if not user or session.get("sv") != user.session_version:
        session.clear()
        return None
    return user


def login_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        user = current_user()
        if not user:
            return jsonify({"error": "não autenticado"}), 401
        if request.method not in ("GET", "HEAD", "OPTIONS"):
            token = request.headers.get("X-CSRF-Token", "")
            if not token or not secrets.compare_digest(token, session.get("csrf", "")):
                return jsonify({"error": "token CSRF inválido"}), 403
        g.user = user
        return fn(*args, **kwargs)
    return wrapper


def _start_session(user: User) -> None:
    session.clear()
    session.permanent = True
    session["uid"] = user.id
    session["sv"] = user.session_version
    session["csrf"] = secrets.token_urlsafe(32)


def signup_allowed() -> bool:
    from flask import current_app
    if current_app.config.get("ALLOW_SIGNUP"):
        return True
    return (db.scalar(select(func.count(User.id))) or 0) == 0


def _validate(username: str, password: str):
    if not (3 <= len(username) <= 40) or not username.replace("_", "").replace(".", "").replace("-", "").isalnum():
        return "Usuário deve ter de 3 a 40 letras, números, ponto, hífen ou sublinhado."
    if len(password) < 8:
        return "A senha precisa ter pelo menos 8 caracteres."
    return None


def public_user(user: User) -> dict:
    return {"id": user.id, "username": user.username, "settings": user_settings(user)}


@bp.get("/state")
def state():
    user = current_user()
    if not user:
        return jsonify({"authenticated": False, "signup": signup_allowed()})
    if "csrf" not in session:
        session["csrf"] = secrets.token_urlsafe(32)
    return jsonify({"authenticated": True, "csrf": session["csrf"], "user": public_user(user)})


@bp.post("/register")
def register():
    if not signup_allowed():
        return jsonify({"error": "Cadastro fechado. Peça acesso ao administrador."}), 403
    data = request.get_json(silent=True) or {}
    username = str(data.get("username", "")).strip().lower()
    password = str(data.get("password", ""))
    err = _validate(username, password)
    if err:
        return jsonify({"error": err}), 400
    if db.scalar(select(User).where(User.username == username)):
        return jsonify({"error": "Esse usuário já existe."}), 409
    settings = dict(DEFAULT_SETTINGS)
    if data.get("name"):
        settings["name"] = str(data["name"])[:60]
    if data.get("timezone"):
        settings["timezone"] = str(data["timezone"])[:60]
    user = User(username=username, password_hash=generate_password_hash(password), settings=settings)
    db.add(user)
    db.commit()
    _start_session(user)
    return jsonify({"ok": True, "csrf": session["csrf"], "user": public_user(user)})


@bp.post("/login")
def login():
    data = request.get_json(silent=True) or {}
    username = str(data.get("username", "")).strip().lower()
    password = str(data.get("password", ""))
    key = f"{_client_ip()}|{username}"
    if _too_many(key) or _too_many(_client_ip() + "|*", 30):
        return jsonify({"error": "Muitas tentativas. Aguarde 15 minutos."}), 429
    user = db.scalar(select(User).where(User.username == username))
    if not user or not check_password_hash(user.password_hash, password):
        _record_fail(key)
        _record_fail(_client_ip() + "|*")
        return jsonify({"error": "Usuário ou senha incorretos."}), 401
    _start_session(user)
    return jsonify({"ok": True, "csrf": session["csrf"], "user": public_user(user)})


@bp.post("/logout")
def logout():
    session.clear()
    return jsonify({"ok": True})


@bp.post("/password")
@login_required
def change_password():
    data = request.get_json(silent=True) or {}
    user = g.user
    if not check_password_hash(user.password_hash, str(data.get("current", ""))):
        return jsonify({"error": "Senha atual incorreta."}), 400
    new = str(data.get("new", ""))
    if len(new) < 8:
        return jsonify({"error": "A nova senha precisa ter pelo menos 8 caracteres."}), 400
    user.password_hash = generate_password_hash(new)
    user.session_version += 1  # encerra as outras sessões
    db.commit()
    _start_session(user)
    return jsonify({"ok": True, "csrf": session["csrf"]})


def require_owner(obj):
    if obj is None or getattr(obj, "user_id", None) != g.user.id:
        abort(404)
    return obj
