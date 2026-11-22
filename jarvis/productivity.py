"""Produtividade: rotinas automáticas, Pomodoro/foco, metas e relatórios em PDF."""
from __future__ import annotations

import io
from datetime import datetime, timedelta

from flask import Blueprint, g, jsonify, request, send_file
from sqlalchemy import select

from . import scheduler
from .auth import login_required, require_owner
from .models import utcnow, FocusSession, Goal, Item, Routine, db
from .util import DIAS_NOME, iso, now_local, parse_dt, user_settings

bp = Blueprint("productivity", __name__, url_prefix="/api")

ROUTINE_ACTIONS = ("briefing", "message", "task", "focus")


def routine_json(r: Routine) -> dict:
    return {"id": r.id, "name": r.name, "time": r.time, "days": r.days, "actions": r.actions,
            "enabled": r.enabled, "last_run": r.last_run}


def apply_routine(r: Routine, data: dict) -> None:
    if "name" in data:
        r.name = str(data["name"] or "Rotina")[:200]
    if "time" in data:
        t = str(data["time"])
        hh, mm = t.split(":")[:2]
        if not (0 <= int(hh) <= 23 and 0 <= int(mm) <= 59):
            raise ValueError("horário inválido")
        r.time = f"{int(hh):02d}:{int(mm):02d}"
    if "days" in data:
        r.days = sorted({int(d) for d in data["days"] if 0 <= int(d) <= 6})
    if "actions" in data:
        acts = []
        for a in data["actions"] or []:
            if a.get("type") in ROUTINE_ACTIONS:
                acts.append({"type": a["type"], "value": str(a.get("value") or "")[:300]})
        r.actions = acts
    if "enabled" in data:
        r.enabled = bool(data["enabled"])


@bp.get("/routines")
@login_required
def list_routines():
    rows = db.scalars(select(Routine).where(Routine.user_id == g.user.id).order_by(Routine.time)).all()
    return jsonify([routine_json(r) for r in rows])


@bp.post("/routines")
@login_required
def add_routine():
    r = Routine(user_id=g.user.id, name="Rotina", time="07:00", days=[0, 1, 2, 3, 4],
                actions=[{"type": "briefing", "value": ""}], enabled=True, last_run="")
    try:
        apply_routine(r, request.get_json(silent=True) or {})
    except (ValueError, TypeError):
        return jsonify({"error": "dados inválidos"}), 400
    db.add(r)
    db.commit()
    return jsonify(routine_json(r)), 201


@bp.patch("/routines/<int:rid>")
@login_required
def patch_routine(rid):
    r = require_owner(db.get(Routine, rid))
    try:
        apply_routine(r, request.get_json(silent=True) or {})
    except (ValueError, TypeError):
        return jsonify({"error": "dados inválidos"}), 400
    db.commit()
    return jsonify(routine_json(r))


@bp.delete("/routines/<int:rid>")
@login_required
def del_routine(rid):
    r = require_owner(db.get(Routine, rid))
    db.delete(r)
    db.commit()
    return jsonify({"ok": True})


@bp.post("/routines/<int:rid>/run")
@login_required
def run_routine_now(rid):
    r = require_owner(db.get(Routine, rid))
    stamp = now_local(g.user).strftime("%Y-%m-%dT%H:%M:%S")
    previous = r.last_run
    scheduler.run_routine(g.user, r, "manual-" + stamp)
    r.last_run = previous  # execução manual não impede a execução agendada de hoje
    db.commit()
    return jsonify({"ok": True})


@bp.get("/briefing")
@login_required
def get_briefing():
    return jsonify({"text": scheduler.briefing(g.user)})


# ------------------------------------------------------------------ foco
@bp.post("/focus")
@login_required
def add_focus():
    data = request.get_json(silent=True) or {}
    try:
        minutes = float(data.get("minutes", 0))
    except (TypeError, ValueError):
        return jsonify({"error": "minutos inválidos"}), 400
    if not 0 < minutes <= 600:
        return jsonify({"error": "minutos inválidos"}), 400
    end = parse_dt(data.get("ended_at")) or now_local(g.user)
    start = parse_dt(data.get("started_at")) or end - timedelta(minutes=minutes)
    kind = data.get("kind") if data.get("kind") in ("foco", "pausa") else "foco"
    s = FocusSession(user_id=g.user.id, kind=kind, minutes=round(minutes, 2),
                     label=str(data.get("label") or "")[:200], started_at=start, ended_at=end)
    db.add(s)
    db.commit()
    return jsonify({"id": s.id}), 201


def focus_stats(user, days: int = 14) -> dict:
    now = now_local(user)
    start = (now - timedelta(days=days - 1)).replace(hour=0, minute=0, second=0)
    rows = db.scalars(select(FocusSession).where(FocusSession.user_id == user.id,
                                                 FocusSession.started_at >= start)
                      .order_by(FocusSession.started_at)).all()
    per_day = {(start + timedelta(days=i)).strftime("%Y-%m-%d"): 0.0 for i in range(days)}
    sessions = 0
    breaks = 0.0
    for r in rows:
        k = r.started_at.strftime("%Y-%m-%d")
        if r.kind == "foco":
            if k in per_day:
                per_day[k] += r.minutes
            sessions += 1
        else:
            breaks += r.minutes
    today = now.strftime("%Y-%m-%d")
    total = sum(per_day.values())
    streak = 0
    for i in range(days):
        k = (now - timedelta(days=i)).strftime("%Y-%m-%d")
        if per_day.get(k, 0) > 0:
            streak += 1
        elif i > 0:
            break
    recent = db.scalars(select(FocusSession).where(FocusSession.user_id == user.id)
                        .order_by(FocusSession.started_at.desc()).limit(20)).all()
    return {
        "days": [{"date": k, "minutes": round(v, 1)} for k, v in per_day.items()],
        "today": round(per_day.get(today, 0), 1), "total": round(total, 1), "sessions": sessions,
        "breaks": round(breaks, 1), "average": round(total / days, 1), "streak": streak,
        "goal": user_settings(user)["daily_focus_goal"],
        "recent": [{"kind": r.kind, "minutes": r.minutes, "label": r.label, "started_at": iso(r.started_at)}
                   for r in recent],
    }


@bp.get("/focus/stats")
@login_required
def get_focus_stats():
    days = max(7, min(90, int(request.args.get("days", 14))))
    return jsonify(focus_stats(g.user, days))


# ------------------------------------------------------------------ metas
def goal_json(x: Goal) -> dict:
    pct = min(100.0, x.current / x.target * 100) if x.target else 0
    return {"id": x.id, "title": x.title, "target": x.target, "current": x.current, "unit": x.unit,
            "period": x.period, "progress": round(pct, 1)}


@bp.get("/goals")
@login_required
def list_goals():
    rows = db.scalars(select(Goal).where(Goal.user_id == g.user.id).order_by(Goal.id)).all()
    return jsonify([goal_json(x) for x in rows])


def _apply_goal(x: Goal, data: dict):
    if "title" in data:
        x.title = str(data["title"] or "Meta")[:200]
    if "target" in data:
        x.target = max(0.01, float(data["target"]))
    if "current" in data:
        x.current = max(0.0, float(data["current"]))
    if "increment" in data:
        x.current = max(0.0, x.current + float(data["increment"]))
    if "unit" in data:
        x.unit = str(data["unit"] or "")[:40]
    if "period" in data and data["period"] in ("nenhum", "diaria", "semanal", "mensal"):
        x.period = data["period"]


@bp.post("/goals")
@login_required
def add_goal():
    x = Goal(user_id=g.user.id, title="Meta", target=1, current=0, unit="", period="nenhum")
    try:
        _apply_goal(x, request.get_json(silent=True) or {})
    except (TypeError, ValueError):
        return jsonify({"error": "dados inválidos"}), 400
    db.add(x)
    db.commit()
    return jsonify(goal_json(x)), 201


@bp.patch("/goals/<int:gid>")
@login_required
def patch_goal(gid):
    x = require_owner(db.get(Goal, gid))
    try:
        _apply_goal(x, request.get_json(silent=True) or {})
    except (TypeError, ValueError):
        return jsonify({"error": "dados inválidos"}), 400
    db.commit()
    return jsonify(goal_json(x))


@bp.delete("/goals/<int:gid>")
@login_required
def del_goal(gid):
    x = require_owner(db.get(Goal, gid))
    db.delete(x)
    db.commit()
    return jsonify({"ok": True})


# ------------------------------------------------------------------ relatório PDF
def build_report(user, days: int) -> bytes:
    from reportlab.graphics.charts.barcharts import VerticalBarChart
    from reportlab.graphics.shapes import Drawing
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import cm
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    stats = focus_stats(user, days)
    now = now_local(user)
    start = now - timedelta(days=days - 1)
    blue = colors.HexColor("#0b6fd6")
    styles = getSampleStyleSheet()
    h1 = ParagraphStyle("h1", parent=styles["Title"], textColor=blue)
    h2 = ParagraphStyle("h2", parent=styles["Heading2"], textColor=blue)
    normal = styles["BodyText"]

    done = db.scalars(select(Item).where(Item.user_id == user.id, Item.kind.in_(("task", "subtask")),
                                         Item.done_at.is_not(None),
                                         Item.done_at >= utcnow() - timedelta(days=days))).all()
    pending = db.scalars(select(Item).where(Item.user_id == user.id, Item.kind == "task",
                                            Item.status != "concluida")).all()
    goals = db.scalars(select(Goal).where(Goal.user_id == user.id)).all()

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=2 * cm, rightMargin=2 * cm, topMargin=1.6 * cm,
                            title="Relatório de produtividade - JARVIS")
    el = [Paragraph("J.A.R.V.I.S. — Relatório de produtividade", h1),
          Paragraph(f"Período: {start.strftime('%d/%m/%Y')} a {now.strftime('%d/%m/%Y')} ({days} dias) · "
                    f"gerado em {now.strftime('%d/%m/%Y %H:%M')}", normal), Spacer(1, 12)]

    goal_daily = stats["goal"] or 0
    days_hit = sum(1 for d in stats["days"] if goal_daily and d["minutes"] >= goal_daily)
    summary = [["Indicador", "Valor"],
               ["Tempo total de foco", f"{stats['total'] / 60:.1f} h ({stats['total']:.0f} min)"],
               ["Média diária", f"{stats['average']:.0f} min"],
               ["Sessões de foco", str(stats["sessions"])],
               ["Pausas registradas", f"{stats['breaks']:.0f} min"],
               ["Dias seguidos com foco", str(stats["streak"])],
               ["Dias que bateram a meta diária", f"{days_hit} de {days} (meta: {goal_daily} min)"],
               ["Tarefas concluídas", str(len(done))],
               ["Tarefas pendentes", str(len(pending))]]
    t = Table(summary, colWidths=[9 * cm, 7 * cm])
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), blue), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                           ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#9bbbe0")),
                           ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#eef5fd")]),
                           ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold")]))
    el += [Paragraph("Resumo", h2), t, Spacer(1, 12)]

    el.append(Paragraph("Minutos de foco por dia", h2))
    d = Drawing(460, 180)
    chart = VerticalBarChart()
    chart.x, chart.y, chart.width, chart.height = 30, 30, 420, 130
    chart.data = [[x["minutes"] for x in stats["days"]]]
    chart.categoryAxis.categoryNames = [x["date"][8:10] + "/" + x["date"][5:7] for x in stats["days"]]
    chart.categoryAxis.labels.fontSize = 6 if days > 20 else 7
    chart.categoryAxis.labels.angle = 45 if days > 14 else 0
    chart.categoryAxis.labels.dy = -6 if days > 14 else 0
    chart.valueAxis.valueMin = 0
    chart.bars[0].fillColor = blue
    d.add(chart)
    el += [d, Spacer(1, 12)]

    if goals:
        rows = [["Meta", "Progresso", "%"]] + [
            [x.title, f"{x.current:g} / {x.target:g} {x.unit}", f"{min(100, x.current / x.target * 100 if x.target else 0):.0f}%"]
            for x in goals]
        gt = Table(rows, colWidths=[8 * cm, 5.5 * cm, 2.5 * cm])
        gt.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), blue), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                                ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#9bbbe0"))]))
        el += [Paragraph("Metas", h2), gt, Spacer(1, 12)]

    if done:
        el.append(Paragraph("Tarefas concluídas no período", h2))
        for it in sorted(done, key=lambda i: i.done_at, reverse=True)[:40]:
            el.append(Paragraph(f"✓ {_esc(it.title or '(sem título)')} — {it.done_at.strftime('%d/%m')}", normal))
    if pending:
        el.append(Paragraph("Tarefas pendentes (maior prioridade primeiro)", h2))
        for it in sorted(pending, key=lambda i: -i.priority)[:25]:
            prazo = f" — prazo {it.due.strftime('%d/%m')}" if it.due else ""
            el.append(Paragraph(f"• {_esc(it.title or '(sem título)')}{prazo}", normal))

    weekday_tot = [0.0] * 7
    for x in stats["days"]:
        weekday_tot[datetime.strptime(x["date"], "%Y-%m-%d").weekday()] += x["minutes"]
    if any(weekday_tot):
        best = max(range(7), key=lambda i: weekday_tot[i])
        el += [Spacer(1, 10), Paragraph(f"Seu dia mais produtivo no período foi {DIAS_NOME[best]}.", normal)]
    doc.build(el)
    return buf.getvalue()


def _esc(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


@bp.get("/report.pdf")
@login_required
def report():
    days = max(7, min(90, int(request.args.get("days", 7))))
    pdf = build_report(g.user, days)
    name = f"jarvis-relatorio-{now_local(g.user).strftime('%Y%m%d')}.pdf"
    return send_file(io.BytesIO(pdf), mimetype="application/pdf", as_attachment=True, download_name=name)
