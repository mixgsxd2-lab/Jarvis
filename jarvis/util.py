"""Utilidades: fuso horário, configurações padrão, datas em português e recorrência."""
from __future__ import annotations

import calendar
import re
import unicodedata
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

DEFAULT_SETTINGS = {
    "name": "",
    "timezone": "America/Sao_Paulo",
    "theme": "auto",          # auto | claro | escuro
    "accent": "#5b5bd6",
    "start_view": "hoje",
    "week_start": 0,          # 0 = domingo, 1 = segunda
    "pomodoro_focus": 25,
    "pomodoro_short": 5,
    "pomodoro_long": 15,
    "pomodoro_cycles": 4,
    "daily_focus_goal": 120,
    "break_reminder": 0,
}


def user_settings(user) -> dict:
    s = dict(DEFAULT_SETTINGS)
    s.update(user.settings or {})
    return s


def user_tz(user) -> ZoneInfo:
    try:
        return ZoneInfo(user_settings(user)["timezone"])
    except Exception:
        return ZoneInfo("America/Sao_Paulo")


def now_local(user) -> datetime:
    return datetime.now(user_tz(user)).replace(tzinfo=None, microsecond=0)


def iso(dt):
    if dt is None:
        return None
    if isinstance(dt, datetime):
        return dt.strftime("%Y-%m-%dT%H:%M:%S")
    return dt.isoformat()


def parse_dt(value, *, required=False):
    if value in (None, ""):
        if required:
            raise ValueError("data obrigatória")
        return None
    if isinstance(value, datetime):
        return value
    v = str(value).strip().replace("Z", "")
    if "+" in v[10:]:
        v = v[: 10 + v[10:].index("+")]
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            return datetime.strptime(v[:19], fmt)
        except ValueError:
            continue
    raise ValueError(f"data inválida: {value}")


def fold(text: str) -> str:
    """Minúsculas sem acento, mantendo o mesmo comprimento do texto original."""
    out = []
    for ch in text.lower():
        base = unicodedata.normalize("NFD", ch)[0]
        out.append(base)
    return "".join(out)


DIAS_SEMANA = ["segunda", "terca", "quarta", "quinta", "sexta", "sabado", "domingo"]
DIAS_NOME = ["segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado", "domingo"]
MESES = ["janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto",
         "setembro", "outubro", "novembro", "dezembro"]
MESES_NOME = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto",
              "setembro", "outubro", "novembro", "dezembro"]
NUMEROS = {"um": 1, "uma": 1, "dois": 2, "duas": 2, "tres": 3, "quatro": 4, "cinco": 5, "seis": 6,
           "sete": 7, "oito": 8, "nove": 9, "dez": 10, "onze": 11, "doze": 12, "quinze": 15,
           "vinte": 20, "trinta": 30, "quarenta": 40, "quarenta e cinco": 45, "cinquenta": 50,
           "meia": 30}


def fmt_dt(dt: datetime, now: datetime | None = None) -> str:
    now = now or datetime.now()
    hora = dt.strftime("%H:%M")
    d = dt.date()
    if d == now.date():
        dia = "hoje"
    elif d == now.date() + timedelta(days=1):
        dia = "amanhã"
    else:
        dia = f"{DIAS_NOME[d.weekday()]}, {d.day} de {MESES_NOME[d.month - 1]}"
    return f"{dia} às {hora}"


def _num(token: str) -> int | None:
    token = token.strip()
    if token.isdigit():
        return int(token)
    return NUMEROS.get(token)


_NUM_RE = r"(\d+|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|quinze|vinte|trinta|quarenta e cinco|quarenta|cinquenta|meia)"


def parse_when(text: str, now: datetime):
    """Extrai data/hora de uma frase em português.

    Retorna (datetime | None, texto_sem_a_expressao, tinha_hora).
    """
    f = fold(text)
    spans = []
    result_date = None
    hour = minute = None
    relative = None

    m = re.search(rf"\b(?:em|daqui a|daqui)\s+{_NUM_RE}\s+(minutos?|min|horas?|h|dias?|semanas?)\b", f)
    if m:
        n = _num(m.group(1)) or 0
        unit = m.group(2)
        if unit.startswith("min"):
            relative = timedelta(minutes=n)
        elif unit.startswith("h"):
            relative = timedelta(hours=n)
        elif unit.startswith("dia"):
            relative = timedelta(days=n)
        else:
            relative = timedelta(weeks=n)
        spans.append(m.span())
        dt = now + relative
        cleaned = _remove_spans(text, spans)
        return dt.replace(second=0), cleaned, unit[0] in "mh"

    m = re.search(r"\bdepois de amanha\b", f)
    if m:
        result_date = now.date() + timedelta(days=2)
        spans.append(m.span())
    else:
        m = re.search(r"\b(hoje|amanha)\b", f)
        if m:
            result_date = now.date() + timedelta(days=0 if m.group(1) == "hoje" else 1)
            spans.append(m.span())

    if result_date is None:
        m = re.search(r"\b(?:na |no |nesta |neste |proxima |proximo |esta |este )?(segunda|terca|quarta|quinta|sexta|sabado|domingo)(?:-feira| feira)?\b", f)
        if m:
            wd = DIAS_SEMANA.index(m.group(1))
            delta = (wd - now.weekday()) % 7
            if delta == 0:
                delta = 7
            result_date = now.date() + timedelta(days=delta)
            spans.append(m.span())

    if result_date is None:
        m = re.search(r"\b(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?\b", f)
        if m:
            d, mo = int(m.group(1)), int(m.group(2))
            y = int(m.group(3)) if m.group(3) else now.year
            if y < 100:
                y += 2000
            try:
                result_date = date(y, mo, d)
                if not m.group(3) and result_date < now.date():
                    result_date = date(y + 1, mo, d)
                spans.append(m.span())
            except ValueError:
                result_date = None

    if result_date is None:
        m = re.search(r"\bdia (\d{1,2})(?: de (" + "|".join(MESES) + r"))?\b", f)
        if m:
            d = int(m.group(1))
            mo = MESES.index(m.group(2)) + 1 if m.group(2) else now.month
            y = now.year
            try:
                result_date = date(y, mo, d)
                if result_date < now.date():
                    if m.group(2):
                        result_date = date(y + 1, mo, d)
                    else:
                        mo2 = mo % 12 + 1
                        result_date = date(y + (1 if mo == 12 else 0), mo2, d)
                spans.append(m.span())
            except ValueError:
                result_date = None

    m = re.search(r"\b(?:ao |as |a )?meio[- ]dia\b", f)
    if m:
        hour, minute = 12, 0
        spans.append(m.span())
    else:
        m = re.search(r"\b(?:a |as )?meia[- ]noite\b", f)
        if m:
            hour, minute = 0, 0
            spans.append(m.span())
    if hour is None:
        m = re.search(r"(?:\b(?:as|a|para as|pras|pelas)\s+)?\b(\d{1,2})(?:[:h](\d{2}))\b(?:\s*(?:h|horas))?", f)
        if not m:
            m = re.search(r"\b(?:as|a|para as|pras|pelas)\s+(\d{1,2})(?:\s*(?:h|horas?)\b)?()", f)
        if not m:
            m = re.search(r"\b(\d{1,2})\s*(?:h|horas)\b()", f)
        if m:
            h = int(m.group(1))
            mi = int(m.group(2)) if m.group(2) else 0
            if 0 <= h <= 23 and 0 <= mi <= 59:
                hour, minute = h, mi
                spans.append(m.span())
    if hour is not None:
        m = re.search(r"\b(?:da|de) (manha|tarde|noite|madrugada)\b", f)
        if m:
            period = m.group(1)
            if period in ("tarde", "noite") and hour < 12:
                hour += 12
            spans.append(m.span())

    if result_date is None and hour is None:
        return None, text, False

    has_time = hour is not None
    if hour is None:
        hour, minute = 9, 0
    if result_date is None:
        result_date = now.date()
        candidate = datetime.combine(result_date, datetime.min.time()).replace(hour=hour, minute=minute)
        if candidate <= now:
            candidate += timedelta(days=1)
        return candidate, _remove_spans(text, spans), has_time
    dt = datetime.combine(result_date, datetime.min.time()).replace(hour=hour, minute=minute)
    return dt, _remove_spans(text, spans), has_time


def _remove_spans(text: str, spans):
    out = text
    for a, b in sorted(spans, reverse=True):
        out = out[:a] + " " + out[b:]
    return re.sub(r"\s{2,}", " ", out).strip(" ,.;")


# ---------------------------------------------------------------- recorrência
RECURRENCES = ("none", "daily", "weekdays", "weekly", "monthly", "yearly")
RECURRENCE_NAMES = {"none": "não repete", "daily": "todo dia", "weekdays": "dias úteis",
                    "weekly": "toda semana", "monthly": "todo mês", "yearly": "todo ano"}


def _add_months(d: datetime, months: int) -> datetime | None:
    m = d.month - 1 + months
    y = d.year + m // 12
    m = m % 12 + 1
    if d.day > calendar.monthrange(y, m)[1]:
        return None
    return d.replace(year=y, month=m)


def occurrences(ev, range_start: datetime, range_end: datetime, limit: int = 500):
    """Gera (início, fim) das ocorrências de um evento que tocam o intervalo."""
    duration = ev.end - ev.start if ev.end and ev.end > ev.start else timedelta(hours=1)
    rec = ev.recurrence or "none"
    until = ev.until
    if until is not None and until.time() == datetime.min.time():
        until = until + timedelta(days=1) - timedelta(seconds=1)
    out = []
    if rec == "none":
        if ev.start < range_end and ev.start + duration > range_start:
            out.append((ev.start, ev.start + duration))
        return out
    i = 0
    cur = ev.start
    # avança rapidamente para perto do intervalo em recorrências diárias/semanais
    if rec in ("daily", "weekly") and cur + duration < range_start:
        step = 1 if rec == "daily" else 7
        skip = (range_start - cur).days // step - 1
        if skip > 0:
            cur = cur + timedelta(days=skip * step)
    count = 0
    while count < 5000:
        count += 1
        if rec == "monthly":
            nxt = _add_months(ev.start, i)
            i += 1
            if nxt is None:
                continue
            cur = nxt
        elif rec == "yearly":
            try:
                cur = ev.start.replace(year=ev.start.year + i)
            except ValueError:
                i += 1
                continue
            i += 1
        if cur >= range_end or (until is not None and cur > until):
            break
        if rec == "weekdays" and cur.weekday() >= 5:
            cur += timedelta(days=1)
            continue
        if cur + duration > range_start:
            out.append((cur, cur + duration))
            if len(out) >= limit:
                break
        if rec == "daily" or rec == "weekdays":
            cur += timedelta(days=1)
        elif rec == "weekly":
            cur += timedelta(days=7)
    return out


def find_conflicts(events, start: datetime, end: datetime, exclude_id=None):
    conflicts = []
    for ev in events:
        if ev.id == exclude_id or ev.all_day:
            continue
        for s, e in occurrences(ev, start, end, limit=5):
            if s < end and e > start:
                conflicts.append({"id": ev.id, "title": ev.title, "start": iso(s), "end": iso(e)})
                break
    return conflicts
