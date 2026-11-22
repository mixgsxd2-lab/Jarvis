"""Agente do JARVIS para Windows (opcional).

Roda no seu PC, consulta o JARVIS a cada poucos segundos e executa SOMENTE:
  * abrir aplicativos listados em "allowed_apps" deste arquivo de configuração;
  * abrir sites cujos domínios estejam em "allowed_sites";
  * ajustar o volume, informar o uso do computador e iniciar temporizadores.

Uso:
  1. python jarvis_agent.py            -> cria jarvis_agent.json na primeira vez
  2. edite jarvis_agent.json (server, token, apps e sites)
  3. python jarvis_agent.py            -> deixe rodando

Opcional (volume exato e uso detalhado): pip install psutil pycaw comtypes
"""
from __future__ import annotations

import ctypes
import json
import os
import platform
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path
from urllib.parse import urlparse

CONFIG_PATH = Path(__file__).with_name("jarvis_agent.json")
DEFAULT_CONFIG = {
    "server": "https://SEU-APP.onrender.com",
    "token": "cole-aqui-a-chave-gerada-no-painel-Windows",
    "allowed_apps": {
        "Bloco de Notas": "notepad.exe",
        "Calculadora": "calc.exe",
        "Explorador de Arquivos": "explorer.exe",
        "Chrome": "chrome"
    },
    "allowed_sites": ["youtube.com", "google.com", "gmail.com"],
}
IS_WINDOWS = platform.system() == "Windows"


def log(*args):
    print(time.strftime("[%H:%M:%S]"), *args, flush=True)


def load_config() -> dict:
    if not CONFIG_PATH.exists():
        CONFIG_PATH.write_text(json.dumps(DEFAULT_CONFIG, ensure_ascii=False, indent=2), encoding="utf-8")
        log(f"Arquivo de configuração criado em {CONFIG_PATH}. Edite-o e rode novamente.")
        sys.exit(0)
    cfg = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    if "SEU-APP" in cfg.get("server", "") or "cole-aqui" in cfg.get("token", ""):
        log("Configure 'server' e 'token' em jarvis_agent.json antes de continuar.")
        sys.exit(1)
    return cfg


def http(cfg: dict, path: str, body: dict) -> dict:
    req = urllib.request.Request(
        cfg["server"].rstrip("/") + path, data=json.dumps(body).encode(), method="POST",
        headers={"Authorization": f"Bearer {cfg['token']}", "Content-Type": "application/json",
                 "User-Agent": "jarvis-agent/1.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode() or "{}")


# ------------------------------------------------------------------ uso do computador
def system_info() -> dict:
    info: dict = {"hostname": platform.node(), "os": f"{platform.system()} {platform.release()}"}
    try:
        import psutil  # type: ignore
        info["cpu_percent"] = psutil.cpu_percent(interval=0.5)
        vm = psutil.virtual_memory()
        info["memory_percent"] = vm.percent
        info["memory_used_gb"] = round(vm.used / 1024 ** 3, 1)
        info["memory_total_gb"] = round(vm.total / 1024 ** 3, 1)
        info["disk_percent"] = psutil.disk_usage(os.path.abspath(os.sep)).percent
        bat = psutil.sensors_battery()
        if bat:
            info["battery_percent"] = bat.percent
            info["plugged"] = bat.power_plugged
        info["uptime_hours"] = round((time.time() - psutil.boot_time()) / 3600, 1)
        return info
    except ImportError:
        pass
    du = shutil.disk_usage(os.path.abspath(os.sep))
    info["disk_percent"] = round(du.used / du.total * 100, 1)
    if IS_WINDOWS:
        class MEMORYSTATUSEX(ctypes.Structure):
            _fields_ = [("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong),
                        ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong),
                        ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong),
                        ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtual", ctypes.c_ulonglong),
                        ("sullAvailExtendedVirtual", ctypes.c_ulonglong)]
        st = MEMORYSTATUSEX()
        st.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
        ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(st))
        info["memory_percent"] = st.dwMemoryLoad
        info["memory_total_gb"] = round(st.ullTotalPhys / 1024 ** 3, 1)
        info["memory_used_gb"] = round((st.ullTotalPhys - st.ullAvailPhys) / 1024 ** 3, 1)
        info["uptime_hours"] = round(ctypes.windll.kernel32.GetTickCount64() / 3600000, 1)
    return info


# ------------------------------------------------------------------ volume
VK_VOLUME_MUTE, VK_VOLUME_DOWN, VK_VOLUME_UP = 0xAD, 0xAE, 0xAF


def _key(vk: int, times: int = 1):
    for _ in range(times):
        ctypes.windll.user32.keybd_event(vk, 0, 0, 0)
        ctypes.windll.user32.keybd_event(vk, 0, 2, 0)


def set_volume(payload: dict) -> str:
    if not IS_WINDOWS:
        return "Volume só funciona no Windows."
    action = payload.get("action")
    try:
        from ctypes import POINTER, cast  # noqa: F401

        from comtypes import CLSCTX_ALL  # type: ignore
        from pycaw.pycaw import AudioUtilities, IAudioEndpointVolume  # type: ignore
        dev = AudioUtilities.GetSpeakers()
        iface = dev.Activate(IAudioEndpointVolume._iid_, CLSCTX_ALL, None)
        vol = cast(iface, POINTER(IAudioEndpointVolume))
        cur = vol.GetMasterVolumeLevelScalar()
        if action == "mute":
            vol.SetMute(1, None)
            return "Som desligado."
        if action == "unmute":
            vol.SetMute(0, None)
            return "Som ligado."
        if action in ("up", "down"):
            new = min(1.0, cur + 0.1) if action == "up" else max(0.0, cur - 0.1)
        else:
            new = int(payload.get("level", 50)) / 100
        vol.SetMute(0, None)
        vol.SetMasterVolumeLevelScalar(new, None)
        return f"Volume em {round(new * 100)}%."
    except ImportError:
        pass
    # sem pycaw: usa as teclas de volume (passos de 2%)
    if action == "mute" or action == "unmute":
        _key(VK_VOLUME_MUTE)
        return "Mudo alternado."
    if action == "up":
        _key(VK_VOLUME_UP, 5)
        return "Volume aumentado."
    if action == "down":
        _key(VK_VOLUME_DOWN, 5)
        return "Volume diminuído."
    level = max(0, min(100, int(payload.get("level", 50))))
    _key(VK_VOLUME_DOWN, 50)
    _key(VK_VOLUME_UP, level // 2)
    return f"Volume em aproximadamente {level}%."


# ------------------------------------------------------------------ temporizador
def timer(payload: dict) -> str:
    seconds = int(payload.get("seconds", 60))
    label = str(payload.get("label") or "Temporizador")

    def ring():
        if IS_WINDOWS:
            try:
                import winsound
                for _ in range(3):
                    winsound.Beep(988, 300)
                    winsound.Beep(1318, 400)
            except Exception:
                pass
            ctypes.windll.user32.MessageBoxW(0, f"{label}: tempo esgotado!", "JARVIS", 0x40 | 0x1000)
        else:
            log(f"⏰ {label}: tempo esgotado!")

    threading.Timer(seconds, ring).start()
    return f"{label} de {seconds // 60} min {seconds % 60} s iniciado."


# ------------------------------------------------------------------ apps e sites
def open_app(cfg: dict, payload: dict) -> str:
    name = str(payload.get("name", ""))
    apps = cfg.get("allowed_apps", {})
    match = next((k for k in apps if k.lower() == name.lower()), None)
    if not match:
        raise PermissionError(f"'{name}' não está autorizado no jarvis_agent.json deste PC.")
    target = apps[match]
    if IS_WINDOWS:
        if os.path.exists(target):
            os.startfile(target)  # type: ignore[attr-defined]
        else:
            subprocess.Popen(["cmd", "/c", "start", "", target], shell=False)
    else:
        subprocess.Popen([target])
    return f"{match} aberto."


def open_site(cfg: dict, payload: dict) -> str:
    url = str(payload.get("url", ""))
    host = (urlparse(url).hostname or "").lower()
    if urlparse(url).scheme not in ("http", "https"):
        raise PermissionError("Endereço inválido.")
    for d in cfg.get("allowed_sites", []):
        d = d.lower().strip()
        if host == d or host.endswith("." + d):
            webbrowser.open(url)
            return f"{host} aberto."
    raise PermissionError(f"{host} não está autorizado no jarvis_agent.json deste PC.")


def execute(cfg: dict, cmd: dict) -> tuple[bool, dict]:
    t, p = cmd.get("type"), cmd.get("payload") or {}
    try:
        if t == "open_app":
            return True, {"message": open_app(cfg, p)}
        if t == "open_site":
            return True, {"message": open_site(cfg, p)}
        if t == "volume":
            return True, {"message": set_volume(p)}
        if t == "system_info":
            return True, system_info()
        if t == "timer":
            return True, {"message": timer(p)}
        return False, {"message": f"Comando desconhecido: {t}"}
    except Exception as e:  # noqa: BLE001
        return False, {"message": str(e)}


def main():
    cfg = load_config()
    log(f"Agente JARVIS conectado a {cfg['server']}. Deixe esta janela aberta (Ctrl+C para sair).")
    interval = 4
    last_info = 0.0
    info: dict = {}
    while True:
        try:
            if time.time() - last_info > 60:
                info = system_info()
                last_info = time.time()
            resp = http(cfg, "/api/agent/poll", {"info": info})
            interval = int(resp.get("poll_seconds", 4))
            for cmd in resp.get("commands", []):
                ok, result = execute(cfg, cmd)
                log(("OK " if ok else "ERRO ") + f"{cmd['type']}: {result.get('message', '')}")
                http(cfg, "/api/agent/result", {"id": cmd["id"], "ok": ok, "result": result})
        except urllib.error.HTTPError as e:
            if e.code == 401:
                log("Chave inválida. Gere uma nova no painel Windows e atualize jarvis_agent.json.")
                time.sleep(60)
            else:
                log(f"Servidor respondeu {e.code}; tentando de novo…")
                time.sleep(10)
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            log(f"Sem conexão ({e}); o servidor pode estar acordando. Tentando de novo…")
            time.sleep(10)
        except KeyboardInterrupt:
            log("Encerrado.")
            return
        time.sleep(interval)


if __name__ == "__main__":
    main()
