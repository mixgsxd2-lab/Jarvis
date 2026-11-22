"""Rotas do painel Serviços: clima, notícias, cotações, alertas e Spotify."""
from __future__ import annotations

import base64
import os
import secrets
import time
from urllib.parse import urlencode

import requests
from flask import Blueprint, g, jsonify, redirect, request, session
from sqlalchemy import select

from . import services
from .auth import current_user, login_required, require_owner
from .models import PriceAlert, UserSecret, db
from .util import iso, user_settings

bp = Blueprint("services", __name__, url_prefix="/api")


def _err(e: Exception, status=502):
    return jsonify({"error": f"Serviço indisponível no momento: {e}"}), status


@bp.get("/weather")
@login_required
def weather():
    city = request.args.get("city") or user_settings(g.user)["city"]
    try:
        return jsonify(services.weather(city))
    except services.ServiceError as e:
        return _err(e, 404)
    except Exception as e:  # noqa: BLE001
        return _err(e)


@bp.get("/news")
@login_required
def news():
    topic = request.args.get("topic", user_settings(g.user).get("news_topic", ""))
    try:
        return jsonify(services.news(topic))
    except Exception as e:  # noqa: BLE001
        return _err(e)


@bp.get("/quotes")
@login_required
def quotes():
    return jsonify(services.quotes())


@bp.get("/quotes/<symbol>/history")
@login_required
def quote_history(symbol):
    try:
        return jsonify(services.history(symbol, request.args.get("range", "1mo")))
    except Exception as e:  # noqa: BLE001
        return _err(e)


def alert_json(a: PriceAlert) -> dict:
    return {"id": a.id, "symbol": a.symbol, "direction": a.direction, "price": a.price, "active": a.active,
            "triggered_at": iso(a.triggered_at), "formatted": services.fmt_price(a.symbol, a.price)}


@bp.get("/alerts")
@login_required
def list_alerts():
    rows = db.scalars(select(PriceAlert).where(PriceAlert.user_id == g.user.id).order_by(PriceAlert.id.desc())).all()
    return jsonify([alert_json(a) for a in rows])


@bp.post("/alerts")
@login_required
def add_alert():
    data = request.get_json(silent=True) or {}
    sym = str(data.get("symbol", "")).upper()
    direction = data.get("direction")
    try:
        price = float(str(data.get("price", "")).replace(",", "."))
    except ValueError:
        return jsonify({"error": "valor inválido"}), 400
    if sym not in services.SYMBOLS or direction not in ("acima", "abaixo") or price <= 0:
        return jsonify({"error": "dados inválidos"}), 400
    a = PriceAlert(user_id=g.user.id, symbol=sym, direction=direction, price=price, active=True)
    db.add(a)
    db.commit()
    return jsonify(alert_json(a)), 201


@bp.patch("/alerts/<int:aid>")
@login_required
def patch_alert(aid):
    a = require_owner(db.get(PriceAlert, aid))
    data = request.get_json(silent=True) or {}
    if "active" in data:
        a.active = bool(data["active"])
        if a.active:
            a.triggered_at = None
    db.commit()
    return jsonify(alert_json(a))


@bp.delete("/alerts/<int:aid>")
@login_required
def del_alert(aid):
    a = require_owner(db.get(PriceAlert, aid))
    db.delete(a)
    db.commit()
    return jsonify({"ok": True})


# ------------------------------------------------------------------ Spotify
def _redirect_uri() -> str:
    base = os.environ.get("PUBLIC_URL") or os.environ.get("RENDER_EXTERNAL_URL") or request.host_url.rstrip("/")
    return base.rstrip("/") + "/api/spotify/callback"


def _basic() -> str:
    raw = f"{os.environ['SPOTIFY_CLIENT_ID']}:{os.environ['SPOTIFY_CLIENT_SECRET']}".encode()
    return "Basic " + base64.b64encode(raw).decode()


def _get_secret(user_id: int) -> UserSecret | None:
    return db.scalar(select(UserSecret).where(UserSecret.user_id == user_id, UserSecret.name == "spotify"))


def spotify_call(user_id: int, method: str, path: str, **kw):
    sec = _get_secret(user_id)
    if not sec:
        raise services.ServiceError("Spotify não conectado")
    tok = dict(sec.value)
    if tok.get("expires_at", 0) < time.time() + 30:
        r = requests.post("https://accounts.spotify.com/api/token", timeout=10,
                          data={"grant_type": "refresh_token", "refresh_token": tok["refresh_token"]},
                          headers={"Authorization": _basic()})
        if r.status_code != 200:
            raise services.ServiceError("não foi possível renovar o acesso ao Spotify")
        new = r.json()
        tok["access_token"] = new["access_token"]
        tok["expires_at"] = time.time() + int(new.get("expires_in", 3600))
        if new.get("refresh_token"):
            tok["refresh_token"] = new["refresh_token"]
        sec.value = tok
        db.commit()
    return requests.request(method, "https://api.spotify.com/v1" + path, timeout=10,
                            headers={"Authorization": f"Bearer {tok['access_token']}"}, **kw)


def spotify_control(user_id: int, action: str, query: str = "") -> str:
    """Executa um comando no Spotify e devolve uma frase de resposta."""
    if action == "search_play" and query:
        r = spotify_call(user_id, "GET", "/search", params={"q": query, "type": "track", "limit": 1, "market": "BR"})
        tracks = (r.json().get("tracks") or {}).get("items") or [] if r.ok else []
        if not tracks:
            return f"Não encontrei “{query}” no Spotify."
        t = tracks[0]
        p = spotify_call(user_id, "PUT", "/me/player/play", json={"uris": [t["uri"]]})
        if p.status_code == 404:
            return "Abra o Spotify em algum aparelho para eu poder tocar."
        if p.status_code == 403:
            return "O controle de reprodução exige Spotify Premium."
        return f"Tocando {t['name']}, de {t['artists'][0]['name']}."
    mapping = {"play": ("PUT", "/me/player/play", "Retomando a música."),
               "pause": ("PUT", "/me/player/pause", "Música pausada."),
               "next": ("POST", "/me/player/next", "Próxima faixa."),
               "previous": ("POST", "/me/player/previous", "Faixa anterior.")}
    if action not in mapping:
        return "Comando do Spotify não reconhecido."
    method, path, msg = mapping[action]
    r = spotify_call(user_id, method, path)
    if r.status_code == 404:
        return "Nenhum aparelho do Spotify ativo. Abra o Spotify primeiro."
    if r.status_code == 403:
        return "O controle de reprodução exige Spotify Premium."
    return msg


@bp.get("/spotify/status")
@login_required
def spotify_status():
    out = {"configured": services.spotify_configured(), "connected": bool(_get_secret(g.user.id)),
           "embed": user_settings(g.user).get("spotify_embed", "")}
    if out["connected"]:
        try:
            r = spotify_call(g.user.id, "GET", "/me/player/currently-playing")
            if r.status_code == 200 and r.content:
                d = r.json()
                item = d.get("item") or {}
                imgs = (item.get("album") or {}).get("images") or []
                out["playing"] = {"is_playing": d.get("is_playing"), "name": item.get("name"),
                                  "artist": ", ".join(a["name"] for a in item.get("artists", [])),
                                  "image": imgs[0]["url"] if imgs else None,
                                  "url": (item.get("external_urls") or {}).get("spotify")}
        except Exception as e:  # noqa: BLE001
            out["error"] = str(e)
    return jsonify(out)


@bp.post("/spotify/control")
@login_required
def spotify_control_route():
    data = request.get_json(silent=True) or {}
    try:
        msg = spotify_control(g.user.id, data.get("action", ""), str(data.get("query", ""))[:200])
    except Exception as e:  # noqa: BLE001
        return jsonify({"error": str(e)}), 400
    return jsonify({"message": msg})


@bp.get("/spotify/login")
def spotify_login():
    user = current_user()
    if not user:
        return redirect("/")
    if not services.spotify_configured():
        return redirect("/#servicos")
    state = secrets.token_urlsafe(16)
    session["sp_state"] = state
    q = urlencode({"client_id": os.environ["SPOTIFY_CLIENT_ID"], "response_type": "code",
                   "redirect_uri": _redirect_uri(), "scope": services.SPOTIFY_SCOPES, "state": state})
    return redirect("https://accounts.spotify.com/authorize?" + q)


@bp.get("/spotify/callback")
def spotify_callback():
    user = current_user()
    if not user or request.args.get("state") != session.pop("sp_state", None) or "code" not in request.args:
        return redirect("/#servicos")
    r = requests.post("https://accounts.spotify.com/api/token", timeout=10,
                      data={"grant_type": "authorization_code", "code": request.args["code"],
                            "redirect_uri": _redirect_uri()},
                      headers={"Authorization": _basic()})
    if r.status_code == 200:
        tok = r.json()
        sec = _get_secret(user.id) or UserSecret(user_id=user.id, name="spotify", value={})
        sec.value = {"access_token": tok["access_token"], "refresh_token": tok.get("refresh_token"),
                     "expires_at": time.time() + int(tok.get("expires_in", 3600))}
        db.add(sec)
        db.commit()
    return redirect("/#servicos")


@bp.post("/spotify/disconnect")
@login_required
def spotify_disconnect():
    sec = _get_secret(g.user.id)
    if sec:
        db.delete(sec)
        db.commit()
    return jsonify({"ok": True})
