"""API das ideias: listar, adicionar, editar e apagar."""
from __future__ import annotations

from flask import Blueprint, g, jsonify, request
from sqlalchemy import select

from .auth import login_required, require_owner
from .models import Item, db, utcnow

bp = Blueprint("ideas", __name__, url_prefix="/api")


def idea_json(it: Item) -> dict:
    return {"id": it.id, "text": it.title, "created_at": it.created_at.isoformat()}


def _text(data) -> str:
    return str(data.get("text", "")).strip()[:300]


@bp.get("/ideias")
@login_required
def list_ideas():
    rows = db.scalars(select(Item).where(Item.user_id == g.user.id, Item.kind == "idea")
                      .order_by(Item.created_at.desc(), Item.id.desc())).all()
    return jsonify([idea_json(i) for i in rows])


@bp.post("/ideias")
@login_required
def add_idea():
    text = _text(request.get_json(silent=True) or {})
    if not text:
        return jsonify({"error": "Escreva a ideia."}), 400
    it = Item(user_id=g.user.id, kind="idea", title=text, body="", status="nova", tags=[])
    db.add(it)
    db.commit()
    return jsonify(idea_json(it)), 201


@bp.patch("/ideias/<int:iid>")
@login_required
def edit_idea(iid):
    it = require_owner(db.get(Item, iid))
    data = request.get_json(silent=True) or {}
    text = _text(data)
    if not text:
        return jsonify({"error": "A ideia não pode ficar vazia."}), 400
    it.title = text
    it.updated_at = utcnow()
    db.commit()
    return jsonify(idea_json(it))


@bp.delete("/ideias/<int:iid>")
@login_required
def delete_idea(iid):
    it = require_owner(db.get(Item, iid))
    db.delete(it)
    db.commit()
    return jsonify({"ok": True})
