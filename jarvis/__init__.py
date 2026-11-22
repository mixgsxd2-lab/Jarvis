"""JARVIS AI — assistente pessoal em português do Brasil."""
from __future__ import annotations

import logging
import os
import secrets
from datetime import timedelta
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory

from .models import db, init_db

ROOT = Path(__file__).resolve().parent.parent
STATIC = ROOT / "static"


def _secret_key() -> str:
    key = os.environ.get("SECRET_KEY")
    if key:
        return key
    # Sem SECRET_KEY: gera e guarda no banco para as sessões sobreviverem a reinícios.
    from .models import get_config, set_config
    key = get_config("secret_key")
    if not key:
        key = secrets.token_urlsafe(48)
        set_config("secret_key", key)
    return key


def create_app(config: dict | None = None) -> Flask:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    app = Flask(__name__, static_folder=None)
    config = config or {}
    db_url = config.get("DATABASE_URL") or os.environ.get("DATABASE_URL")
    if not db_url:
        (ROOT / "data").mkdir(exist_ok=True)
        db_url = f"sqlite:///{ROOT / 'data' / 'jarvis.db'}"
    init_db(db_url)

    on_https = bool(os.environ.get("RENDER") or os.environ.get("FORCE_HTTPS"))
    app.config.update(
        SECRET_KEY=config.get("SECRET_KEY") or _secret_key(),
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_SECURE=on_https,
        SESSION_COOKIE_NAME="jarvis_session",
        PERMANENT_SESSION_LIFETIME=timedelta(days=30),
        MAX_CONTENT_LENGTH=6 * 1024 * 1024,
        ALLOW_SIGNUP=os.environ.get("ALLOW_SIGNUP", "").lower() in ("1", "true", "sim", "yes"),
        CRON_SECRET=os.environ.get("CRON_SECRET", ""),
        JSON_AS_ASCII=False,
    )
    app.config.update({k: v for k, v in config.items() if k != "DATABASE_URL"})
    app.json.ensure_ascii = False

    if on_https:
        from werkzeug.middleware.proxy_fix import ProxyFix
        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)

    from . import api, assistant, auth, productivity, services_api, windows
    for bp in (auth.bp, api.bp, assistant.bp, services_api.bp, productivity.bp, windows.bp):
        app.register_blueprint(bp)

    @app.teardown_appcontext
    def _remove_session(_exc=None):
        db.remove()

    @app.after_request
    def _headers(resp):
        resp.headers.setdefault("X-Content-Type-Options", "nosniff")
        resp.headers.setdefault("Referrer-Policy", "same-origin")
        resp.headers.setdefault("X-Frame-Options", "DENY")
        resp.headers.setdefault("Permissions-Policy", "microphone=(self), geolocation=(self), camera=()")
        resp.headers.setdefault(
            "Content-Security-Policy",
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data: blob: https:; media-src 'self' data: blob:; connect-src 'self'; "
            "frame-src https://open.spotify.com; object-src 'none'; base-uri 'none'; form-action 'self'",
        )
        if on_https:
            resp.headers.setdefault("Strict-Transport-Security", "max-age=31536000")
        if request.path.startswith("/api/"):
            resp.headers.setdefault("Cache-Control", "no-store")
        return resp

    @app.errorhandler(404)
    def _nf(_e):
        if request.path.startswith("/api/"):
            return jsonify({"error": "não encontrado"}), 404
        return send_from_directory(STATIC, "index.html")

    @app.errorhandler(413)
    def _too_big(_e):
        return jsonify({"error": "Arquivo grande demais (máx. 5 MB)."}), 413

    @app.errorhandler(500)
    def _err(_e):
        db.rollback()
        return jsonify({"error": "erro interno"}), 500

    @app.get("/healthz")
    def health():
        return {"ok": True}

    @app.route("/cron/tick", methods=["GET", "POST"])
    def cron_tick():
        """Chamado por um agendador externo (cron-job.org etc.) para lembretes com o app fechado."""
        from .scheduler import process_all
        key = request.args.get("key") or request.headers.get("X-Cron-Key", "")
        secret = app.config["CRON_SECRET"]
        if not secret or not secrets.compare_digest(key, secret):
            return jsonify({"error": "não autorizado"}), 403
        return jsonify(process_all())

    @app.get("/")
    def index():
        return send_from_directory(STATIC, "index.html")

    @app.get("/sw.js")
    def sw():
        resp = send_from_directory(STATIC, "sw.js", mimetype="application/javascript")
        resp.headers["Cache-Control"] = "no-cache"
        resp.headers["Service-Worker-Allowed"] = "/"
        return resp

    @app.get("/manifest.webmanifest")
    def manifest():
        return send_from_directory(STATIC, "manifest.webmanifest", mimetype="application/manifest+json")

    @app.get("/static/<path:path>")
    def static_files(path):
        resp = send_from_directory(STATIC, path)
        if path.startswith("windows/"):
            resp.headers["Content-Disposition"] = f'attachment; filename="{Path(path).name}"'
        return resp

    @app.get("/download/jarvis_agent.py")
    def agent_download():
        return send_from_directory(ROOT / "windows_agent", "jarvis_agent.py", as_attachment=True,
                                   mimetype="text/x-python")

    return app
