"""Modelos do banco de dados do JARVIS (SQLite local ou PostgreSQL)."""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import (JSON, Boolean, DateTime, Float, ForeignKey, Integer,
                        LargeBinary, String, Text, UniqueConstraint, create_engine)
from sqlalchemy.orm import (DeclarativeBase, Mapped, mapped_column,
                            scoped_session, sessionmaker)

db = scoped_session(sessionmaker(expire_on_commit=False))


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None, microsecond=0)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(60), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(300))
    settings: Mapped[dict] = mapped_column(JSON, default=dict)
    session_version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


def _uid():
    return mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)


class Item(Base):
    """Tarefas, subtarefas, ideias, anotações, projetos e pesquisas."""
    __tablename__ = "items"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = _uid()
    kind: Mapped[str] = mapped_column(String(20), index=True)
    title: Mapped[str] = mapped_column(String(300), default="")
    body: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(20), default="pendente")
    priority: Mapped[int] = mapped_column(Integer, default=0)
    due: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    tags: Mapped[list] = mapped_column(JSON, default=list)
    parent_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    origin_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    position: Mapped[int] = mapped_column(Integer, default=0)
    done_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class Attachment(Base):
    __tablename__ = "attachments"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = _uid()
    item_id: Mapped[int] = mapped_column(ForeignKey("items.id", ondelete="CASCADE"), index=True)
    filename: Mapped[str] = mapped_column(String(255))
    mime: Mapped[str] = mapped_column(String(120))
    size: Mapped[int] = mapped_column(Integer)
    data: Mapped[bytes] = mapped_column(LargeBinary)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Event(Base):
    """Compromissos (horários em hora local do usuário)."""
    __tablename__ = "events"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = _uid()
    title: Mapped[str] = mapped_column(String(300))
    start: Mapped[datetime] = mapped_column(DateTime)
    end: Mapped[datetime] = mapped_column(DateTime)
    all_day: Mapped[bool] = mapped_column(Boolean, default=False)
    recurrence: Mapped[str] = mapped_column(String(20), default="none")
    until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    reminder_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    alarm: Mapped[bool] = mapped_column(Boolean, default=False)
    location: Mapped[str] = mapped_column(String(300), default="")
    notes: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Reminder(Base):
    __tablename__ = "reminders"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = _uid()
    title: Mapped[str] = mapped_column(String(300))
    at: Mapped[datetime] = mapped_column(DateTime)
    kind: Mapped[str] = mapped_column(String(20), default="lembrete")  # lembrete | alarme
    repeat: Mapped[str] = mapped_column(String(20), default="none")
    done: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Memory(Base):
    __tablename__ = "memories"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = _uid()
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Message(Base):
    __tablename__ = "messages"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = _uid()
    role: Mapped[str] = mapped_column(String(20))
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class PendingAction(Base):
    """Alterações propostas pelo assistente que aguardam confirmação."""
    __tablename__ = "pending_actions"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = _uid()
    action: Mapped[dict] = mapped_column(JSON)
    summary: Mapped[str] = mapped_column(String(500))
    status: Mapped[str] = mapped_column(String(20), default="pending")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Notification(Base):
    __tablename__ = "notifications"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = _uid()
    key: Mapped[str] = mapped_column(String(200))
    title: Mapped[str] = mapped_column(String(300))
    body: Mapped[str] = mapped_column(Text, default="")
    kind: Mapped[str] = mapped_column(String(20), default="lembrete")
    delivered: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    __table_args__ = (UniqueConstraint("user_id", "key", name="uq_notif_key"),)


class Routine(Base):
    __tablename__ = "routines"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = _uid()
    name: Mapped[str] = mapped_column(String(200))
    time: Mapped[str] = mapped_column(String(5), default="07:00")
    days: Mapped[list] = mapped_column(JSON, default=lambda: [0, 1, 2, 3, 4])
    actions: Mapped[list] = mapped_column(JSON, default=list)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    last_run: Mapped[str] = mapped_column(String(10), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class FocusSession(Base):
    __tablename__ = "focus_sessions"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = _uid()
    kind: Mapped[str] = mapped_column(String(20), default="foco")
    minutes: Mapped[float] = mapped_column(Float)
    label: Mapped[str] = mapped_column(String(200), default="")
    started_at: Mapped[datetime] = mapped_column(DateTime)
    ended_at: Mapped[datetime] = mapped_column(DateTime)


class Goal(Base):
    __tablename__ = "goals"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = _uid()
    title: Mapped[str] = mapped_column(String(200))
    target: Mapped[float] = mapped_column(Float, default=1)
    current: Mapped[float] = mapped_column(Float, default=0)
    unit: Mapped[str] = mapped_column(String(40), default="")
    period: Mapped[str] = mapped_column(String(20), default="nenhum")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class PriceAlert(Base):
    __tablename__ = "price_alerts"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = _uid()
    symbol: Mapped[str] = mapped_column(String(20))
    direction: Mapped[str] = mapped_column(String(10))  # acima | abaixo
    price: Mapped[float] = mapped_column(Float)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    triggered_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Device(Base):
    """Computadores Windows conectados pelo agente opcional."""
    __tablename__ = "devices"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = _uid()
    name: Mapped[str] = mapped_column(String(100))
    token_hash: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    last_seen: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    info: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Command(Base):
    __tablename__ = "commands"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = _uid()
    device_id: Mapped[int] = mapped_column(ForeignKey("devices.id", ondelete="CASCADE"), index=True)
    type: Mapped[str] = mapped_column(String(30))
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(20), default="pendente")
    result: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class PushSubscription(Base):
    __tablename__ = "push_subscriptions"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = _uid()
    endpoint: Mapped[str] = mapped_column(Text)
    p256dh: Mapped[str] = mapped_column(String(200))
    auth: Mapped[str] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class UserSecret(Base):
    __tablename__ = "user_secrets"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = _uid()
    name: Mapped[str] = mapped_column(String(50))
    value: Mapped[dict] = mapped_column(JSON, default=dict)
    __table_args__ = (UniqueConstraint("user_id", "name", name="uq_secret"),)


class AppConfig(Base):
    __tablename__ = "app_config"
    key: Mapped[str] = mapped_column(String(60), primary_key=True)
    value: Mapped[str] = mapped_column(Text)


def normalize_db_url(url: str) -> str:
    if url.startswith("postgres://"):
        url = "postgresql+psycopg://" + url[len("postgres://"):]
    elif url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://"):]
    return url


def init_db(url: str):
    url = normalize_db_url(url)
    kwargs = {"pool_pre_ping": True}
    if url.startswith("sqlite"):
        kwargs["connect_args"] = {"check_same_thread": False}
    engine = create_engine(url, **kwargs)
    Base.metadata.create_all(engine)
    db.remove()
    db.configure(bind=engine)
    return engine


def get_config(key: str, default: str | None = None) -> str | None:
    row = db.get(AppConfig, key)
    return row.value if row else default


def set_config(key: str, value: str) -> None:
    row = db.get(AppConfig, key)
    if row:
        row.value = value
    else:
        db.add(AppConfig(key=key, value=value))
    db.commit()
