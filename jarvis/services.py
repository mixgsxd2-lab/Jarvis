"""Integrações externas gratuitas: clima (Open-Meteo), notícias (Google Notícias RSS),
cotações (Yahoo Finance, com AwesomeAPI e brapi como reserva) e Spotify."""
from __future__ import annotations

import logging
import os
import threading
import time
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime
from urllib.parse import quote_plus

import requests

log = logging.getLogger("jarvis.services")
UA = {"User-Agent": "Mozilla/5.0 (JARVIS assistant)", "Accept": "application/json, text/xml, */*"}
_cache: dict[str, tuple[float, object]] = {}
_lock = threading.Lock()


class ServiceError(Exception):
    pass


def cached(key: str, ttl: int, fn):
    now = time.time()
    with _lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < ttl:
            return hit[1]
    value = fn()
    with _lock:
        _cache[key] = (now, value)
    return value


def clear_cache():
    with _lock:
        _cache.clear()


def http_get_json(url: str, params=None, headers=None, timeout=8):
    r = requests.get(url, params=params, headers={**UA, **(headers or {})}, timeout=timeout)
    r.raise_for_status()
    return r.json()


def http_get_text(url: str, params=None, timeout=8) -> str:
    r = requests.get(url, params=params, headers=UA, timeout=timeout)
    r.raise_for_status()
    return r.text


# ------------------------------------------------------------------ clima
WMO = {
    0: "Céu limpo", 1: "Predomínio de sol", 2: "Parcialmente nublado", 3: "Nublado",
    45: "Neblina", 48: "Neblina com geada", 51: "Garoa fraca", 53: "Garoa", 55: "Garoa forte",
    56: "Garoa congelante", 57: "Garoa congelante forte", 61: "Chuva fraca", 63: "Chuva",
    65: "Chuva forte", 66: "Chuva congelante", 67: "Chuva congelante forte", 71: "Neve fraca",
    73: "Neve", 75: "Neve forte", 77: "Grãos de neve", 80: "Pancadas de chuva fracas",
    81: "Pancadas de chuva", 82: "Pancadas de chuva fortes", 85: "Neve passageira",
    86: "Neve forte passageira", 95: "Trovoadas", 96: "Trovoadas com granizo", 99: "Trovoadas fortes com granizo",
}
WMO_ICON = {0: "☀️", 1: "🌤️", 2: "⛅", 3: "☁️", 45: "🌫️", 48: "🌫️", 51: "🌦️", 53: "🌦️", 55: "🌧️",
            61: "🌦️", 63: "🌧️", 65: "🌧️", 80: "🌦️", 81: "🌧️", 82: "⛈️", 95: "⛈️", 96: "⛈️", 99: "⛈️"}


def geocode(city: str) -> dict:
    def fetch():
        data = http_get_json("https://geocoding-api.open-meteo.com/v1/search",
                             {"name": city, "count": 1, "language": "pt", "format": "json"})
        res = (data or {}).get("results") or []
        if not res:
            raise ServiceError(f"Cidade não encontrada: {city}")
        r = res[0]
        return {"name": r.get("name", city), "admin": r.get("admin1", ""), "country": r.get("country", ""),
                "lat": r["latitude"], "lon": r["longitude"]}
    return cached(f"geo:{city.lower()}", 86400, fetch)


def weather(city: str) -> dict:
    def fetch():
        g = geocode(city)
        data = http_get_json("https://api.open-meteo.com/v1/forecast", {
            "latitude": g["lat"], "longitude": g["lon"], "timezone": "auto", "forecast_days": 7,
            "current": "temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation",
            "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset",
            "hourly": "temperature_2m,precipitation_probability,weather_code",
        })
        cur = data.get("current", {})
        code = int(cur.get("weather_code", 0) or 0)
        daily = data.get("daily", {})
        days = []
        for i, d in enumerate(daily.get("time", [])):
            c = int((daily.get("weather_code") or [0])[i] or 0)
            days.append({"date": d, "code": c, "description": WMO.get(c, "—"), "icon": WMO_ICON.get(c, "🌡️"),
                         "max": daily["temperature_2m_max"][i], "min": daily["temperature_2m_min"][i],
                         "rain": (daily.get("precipitation_probability_max") or [None] * 7)[i]})
        hourly = data.get("hourly", {})
        hours = []
        now_iso = cur.get("time", "")
        for i, t in enumerate(hourly.get("time", [])):
            if t >= now_iso[:13] and len(hours) < 24:
                c = int((hourly.get("weather_code") or [0])[i] or 0)
                hours.append({"time": t, "temp": hourly["temperature_2m"][i], "icon": WMO_ICON.get(c, "🌡️"),
                              "rain": (hourly.get("precipitation_probability") or [None])[i] if hourly.get("precipitation_probability") else None})
        return {
            "city": g["name"], "region": ", ".join(x for x in (g["admin"], g["country"]) if x),
            "current": {"temperature": cur.get("temperature_2m"), "feels_like": cur.get("apparent_temperature"),
                        "humidity": cur.get("relative_humidity_2m"), "wind": cur.get("wind_speed_10m"),
                        "code": code, "description": WMO.get(code, "—"), "icon": WMO_ICON.get(code, "🌡️"),
                        "time": cur.get("time")},
            "days": days, "hours": hours,
        }
    return cached(f"wx:{city.lower()}", 600, fetch)


# ------------------------------------------------------------------ notícias
def news(topic: str = "", limit: int = 15) -> list[dict]:
    def fetch():
        base = "https://news.google.com/rss"
        params = {"hl": "pt-BR", "gl": "BR", "ceid": "BR:pt-419"}
        url = f"{base}/search?q={quote_plus(topic)}" if topic else base
        text = http_get_text(url, params)
        root = ET.fromstring(text)
        out = []
        for item in root.iter("item"):
            title = (item.findtext("title") or "").strip()
            source = (item.findtext("source") or "").strip()
            if source and title.endswith(" - " + source):
                title = title[: -len(source) - 3]
            pub = item.findtext("pubDate") or ""
            try:
                pub_iso = parsedate_to_datetime(pub).isoformat()
            except Exception:
                pub_iso = ""
            out.append({"title": title, "link": (item.findtext("link") or "").strip(), "source": source,
                        "published": pub_iso})
            if len(out) >= limit:
                break
        return out
    return cached(f"news:{topic.lower()}", 900, fetch)


# ------------------------------------------------------------------ cotações
SYMBOLS = {
    "BBAS3": {"name": "Banco do Brasil (BBAS3)", "yahoo": "BBAS3.SA", "brapi": "BBAS3", "kind": "acao"},
    "IBOV": {"name": "Ibovespa", "yahoo": "^BVSP", "brapi": "^BVSP", "kind": "indice"},
    "USD": {"name": "Dólar (USD/BRL)", "yahoo": "BRL=X", "awesome": "USD-BRL", "kind": "moeda"},
    "EUR": {"name": "Euro (EUR/BRL)", "yahoo": "EURBRL=X", "awesome": "EUR-BRL", "kind": "moeda"},
}
RANGES = {"1d": ("1d", "5m"), "5d": ("5d", "30m"), "1mo": ("1mo", "1d"), "6mo": ("6mo", "1d"), "1y": ("1y", "1d")}


def fmt_price(symbol: str, value: float | None) -> str:
    if value is None:
        return "—"
    if symbol == "IBOV":
        s = f"{value:,.0f}".replace(",", ".")
        return f"{s} pontos"
    s = f"{value:,.4f}" if SYMBOLS.get(symbol, {}).get("kind") == "moeda" else f"{value:,.2f}"
    s = s.replace(",", "X").replace(".", ",").replace("X", ".")
    return f"R$ {s}"


def _yahoo_chart(ysym: str, rng: str, interval: str) -> dict:
    data = None
    last_err = None
    for host in ("query1", "query2"):
        try:
            data = http_get_json(f"https://{host}.finance.yahoo.com/v8/finance/chart/{quote_plus(ysym)}",
                                 {"range": rng, "interval": interval, "includePrePost": "false"})
            break
        except Exception as e:  # noqa: BLE001
            last_err = e
    if data is None:
        raise ServiceError(f"Yahoo indisponível: {last_err}")
    res = ((data or {}).get("chart") or {}).get("result") or []
    if not res:
        raise ServiceError("sem dados")
    return res[0]


def _quote_yahoo(sym: str) -> dict:
    r = _yahoo_chart(SYMBOLS[sym]["yahoo"], "1d", "5m")
    meta = r.get("meta", {})
    price = meta.get("regularMarketPrice")
    prev = meta.get("chartPreviousClose") or meta.get("previousClose")
    closes = [c for c in ((r.get("indicators", {}).get("quote") or [{}])[0].get("close") or []) if c is not None]
    if price is None and closes:
        price = closes[-1]
    if price is None:
        raise ServiceError("sem preço")
    change = (price - prev) / prev * 100 if prev else None
    return {"price": float(price), "previous": prev, "change_pct": change,
            "time": meta.get("regularMarketTime"), "source": "Yahoo Finance",
            "spark": [round(c, 4) for c in closes[-60:]]}


def _quote_awesome(sym: str) -> dict:
    code = SYMBOLS[sym]["awesome"]
    data = http_get_json(f"https://economia.awesomeapi.com.br/json/last/{code}")
    d = data[code.replace("-", "")]
    return {"price": float(d["bid"]), "previous": None, "change_pct": float(d.get("pctChange") or 0),
            "time": int(d.get("timestamp") or 0), "source": "AwesomeAPI", "spark": []}


def _quote_brapi(sym: str) -> dict:
    params = {"range": "1d", "interval": "1d"}
    token = os.environ.get("BRAPI_TOKEN")
    if token:
        params["token"] = token
    data = http_get_json(f"https://brapi.dev/api/quote/{quote_plus(SYMBOLS[sym]['brapi'])}", params)
    d = data["results"][0]
    return {"price": float(d["regularMarketPrice"]), "previous": d.get("regularMarketPreviousClose"),
            "change_pct": d.get("regularMarketChangePercent"), "time": None, "source": "brapi", "spark": []}


def quote(sym: str) -> dict:
    sym = sym.upper()
    if sym not in SYMBOLS:
        raise ServiceError("símbolo desconhecido")

    def fetch():
        errors = []
        providers = [_quote_yahoo]
        if "awesome" in SYMBOLS[sym]:
            providers.append(_quote_awesome)
        if "brapi" in SYMBOLS[sym]:
            providers.append(_quote_brapi)
        for p in providers:
            try:
                q = p(sym)
                return {"symbol": sym, "name": SYMBOLS[sym]["name"], "kind": SYMBOLS[sym]["kind"],
                        "formatted": fmt_price(sym, q["price"]), **q}
            except Exception as e:  # noqa: BLE001
                errors.append(f"{p.__name__}: {e}")
        raise ServiceError("; ".join(errors))
    return cached(f"q:{sym}", 60, fetch)


def quotes() -> list[dict]:
    out = []
    for sym in SYMBOLS:
        try:
            out.append(quote(sym))
        except Exception as e:  # noqa: BLE001
            log.warning("cotação %s indisponível: %s", sym, e)
            out.append({"symbol": sym, "name": SYMBOLS[sym]["name"], "kind": SYMBOLS[sym]["kind"],
                        "price": None, "formatted": "indisponível", "change_pct": None, "error": True, "spark": []})
    return out


def history(sym: str, rng: str = "1mo") -> dict:
    sym = sym.upper()
    if sym not in SYMBOLS:
        raise ServiceError("símbolo desconhecido")
    rng = rng if rng in RANGES else "1mo"

    def fetch():
        try:
            r = _yahoo_chart(SYMBOLS[sym]["yahoo"], *RANGES[rng])
            ts = r.get("timestamp") or []
            closes = (r.get("indicators", {}).get("quote") or [{}])[0].get("close") or []
            pts = [[t, round(c, 4)] for t, c in zip(ts, closes) if c is not None]
            if pts:
                return {"symbol": sym, "range": rng, "points": pts, "source": "Yahoo Finance"}
        except Exception as e:  # noqa: BLE001
            log.info("histórico Yahoo falhou: %s", e)
        if "awesome" in SYMBOLS[sym]:
            n = {"1d": 2, "5d": 5, "1mo": 30, "6mo": 180, "1y": 360}[rng]
            data = http_get_json(f"https://economia.awesomeapi.com.br/json/daily/{SYMBOLS[sym]['awesome']}/{n}")
            pts = sorted([[int(d["timestamp"]), float(d["bid"])] for d in data])
            return {"symbol": sym, "range": rng, "points": pts, "source": "AwesomeAPI"}
        params = {"range": rng if rng != "1d" else "5d", "interval": "1d"}
        if os.environ.get("BRAPI_TOKEN"):
            params["token"] = os.environ["BRAPI_TOKEN"]
        data = http_get_json(f"https://brapi.dev/api/quote/{quote_plus(SYMBOLS[sym]['brapi'])}", params)
        hist = data["results"][0].get("historicalDataPrice") or []
        pts = [[int(h["date"]), float(h["close"])] for h in hist if h.get("close") is not None]
        return {"symbol": sym, "range": rng, "points": pts, "source": "brapi"}
    return cached(f"h:{sym}:{rng}", 300, fetch)


# ------------------------------------------------------------------ Spotify
SPOTIFY_SCOPES = "user-read-playback-state user-modify-playback-state user-read-currently-playing"


def spotify_configured() -> bool:
    return bool(os.environ.get("SPOTIFY_CLIENT_ID") and os.environ.get("SPOTIFY_CLIENT_SECRET"))
