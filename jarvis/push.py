"""Web Push (RFC 8291 + VAPID RFC 8292) implementado com a biblioteca cryptography.

As chaves VAPID são geradas na primeira execução e guardadas no banco,
assim continuam as mesmas entre reinícios (desde que o banco seja persistente).
"""
from __future__ import annotations

import base64
import json
import logging
import os
import struct
import time
from urllib.parse import urlparse

import requests
from cryptography.hazmat.primitives import hashes, hmac, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from sqlalchemy import select

from .models import PushSubscription, db, get_config, set_config

log = logging.getLogger("jarvis.push")


def b64u(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def b64u_dec(text: str) -> bytes:
    text = text.strip()
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _private_key() -> ec.EllipticCurvePrivateKey:
    pem = os.environ.get("VAPID_PRIVATE_KEY") or get_config("vapid_private")
    if not pem:
        key = ec.generate_private_key(ec.SECP256R1())
        pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                serialization.NoEncryption()).decode()
        set_config("vapid_private", pem)
    return serialization.load_pem_private_key(pem.encode(), password=None)


def _raw_public(key) -> bytes:
    return key.public_key().public_bytes(serialization.Encoding.X962,
                                         serialization.PublicFormat.UncompressedPoint)


def public_key_b64() -> str:
    return b64u(_raw_public(_private_key()))


def _hkdf_expand(prk: bytes, info: bytes, length: int) -> bytes:
    h = hmac.HMAC(prk, hashes.SHA256())
    h.update(info + b"\x01")
    return h.finalize()[:length]


def _hmac(key: bytes, data: bytes) -> bytes:
    h = hmac.HMAC(key, hashes.SHA256())
    h.update(data)
    return h.finalize()


def encrypt(payload: bytes, p256dh: str, auth: str, *, salt: bytes | None = None,
            server_key: ec.EllipticCurvePrivateKey | None = None) -> bytes:
    """Criptografa no formato aes128gcm (RFC 8188/8291)."""
    ua_public = b64u_dec(p256dh)
    auth_secret = b64u_dec(auth)
    salt = salt or os.urandom(16)
    as_key = server_key or ec.generate_private_key(ec.SECP256R1())
    as_public = _raw_public(as_key)
    ua_key = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), ua_public)
    shared = as_key.exchange(ec.ECDH(), ua_key)
    prk_key = _hmac(auth_secret, shared)
    ikm = _hkdf_expand(prk_key, b"WebPush: info\x00" + ua_public + as_public, 32)
    prk = _hmac(salt, ikm)
    cek = _hkdf_expand(prk, b"Content-Encoding: aes128gcm\x00", 16)
    nonce = _hkdf_expand(prk, b"Content-Encoding: nonce\x00", 12)
    ciphertext = AESGCM(cek).encrypt(nonce, payload + b"\x02", None)
    header = salt + struct.pack(">I", 4096) + bytes([len(as_public)]) + as_public
    return header + ciphertext


def decrypt(body: bytes, ua_private: ec.EllipticCurvePrivateKey, auth: str) -> bytes:
    """Usado nos testes: faz o papel do navegador e decifra a mensagem."""
    salt, idlen = body[:16], body[20]
    as_public = body[21:21 + idlen]
    ciphertext = body[21 + idlen:]
    ua_public = _raw_public(ua_private)
    shared = ua_private.exchange(ec.ECDH(), ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), as_public))
    prk_key = _hmac(b64u_dec(auth), shared)
    ikm = _hkdf_expand(prk_key, b"WebPush: info\x00" + ua_public + as_public, 32)
    prk = _hmac(salt, ikm)
    cek = _hkdf_expand(prk, b"Content-Encoding: aes128gcm\x00", 16)
    nonce = _hkdf_expand(prk, b"Content-Encoding: nonce\x00", 12)
    plain = AESGCM(cek).decrypt(nonce, ciphertext, None)
    return plain.rstrip(b"\x00")[:-1]


def vapid_header(endpoint: str) -> str:
    key = _private_key()
    u = urlparse(endpoint)
    aud = f"{u.scheme}://{u.netloc}"
    sub = os.environ.get("VAPID_SUBJECT") or os.environ.get("RENDER_EXTERNAL_URL") or "https://jarvis.onrender.com"
    header = b64u(json.dumps({"typ": "JWT", "alg": "ES256"}, separators=(",", ":")).encode())
    claims = b64u(json.dumps({"aud": aud, "exp": int(time.time()) + 12 * 3600, "sub": sub},
                             separators=(",", ":")).encode())
    signing_input = f"{header}.{claims}".encode()
    der = key.sign(signing_input, ec.ECDSA(hashes.SHA256()))
    r, s = decode_dss_signature(der)
    sig = r.to_bytes(32, "big") + s.to_bytes(32, "big")
    jwt = f"{header}.{claims}.{b64u(sig)}"
    return f"vapid t={jwt}, k={b64u(_raw_public(key))}"


def send(sub: PushSubscription, data: dict) -> int:
    body = encrypt(json.dumps(data, ensure_ascii=False).encode(), sub.p256dh, sub.auth)
    headers = {
        "Authorization": vapid_header(sub.endpoint),
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        "TTL": "86400",
        "Urgency": "high",
    }
    r = requests.post(sub.endpoint, data=body, headers=headers, timeout=10)
    return r.status_code


def send_to_user(user_id: int, data: dict) -> int:
    subs = db.scalars(select(PushSubscription).where(PushSubscription.user_id == user_id)).all()
    ok = 0
    for sub in subs:
        try:
            status = send(sub, data)
        except Exception as e:  # noqa: BLE001
            log.warning("push falhou: %s", e)
            continue
        if status in (404, 410):
            db.delete(sub)
            db.commit()
        elif 200 <= status < 300:
            ok += 1
        else:
            log.warning("push retornou %s", status)
    return ok
