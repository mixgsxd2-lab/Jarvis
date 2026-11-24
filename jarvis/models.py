"""Banco de dados do JARVIS (SQLite local ou PostgreSQL). As ideias ficam na tabela items (kind="idea")."""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import (JSON, Boolean, DateTime, ForeignKey, Integer, String, Text,
                        create_engine, inspect, text)
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
    """Itens anotados. Esta versão usa só kind="idea" (os outros tipos vêm de versões antigas)."""
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
    color: Mapped[str | None] = mapped_column(String(20), nullable=True)
    pinned: Mapped[bool | None] = mapped_column(Boolean, nullable=True, default=False)
    done_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)









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
    _add_missing_columns(engine)
    db.remove()
    db.configure(bind=engine)
    return engine


def _add_missing_columns(engine) -> None:
    """Migração simples: acrescenta colunas novas (sempre opcionais) em bancos já existentes."""
    insp = inspect(engine)
    with engine.begin() as conn:
        for table in Base.metadata.sorted_tables:
            existing = {c["name"] for c in insp.get_columns(table.name)}
            for col in table.columns:
                if col.name not in existing and col.nullable:
                    ctype = col.type.compile(dialect=engine.dialect)
                    conn.execute(text(f'ALTER TABLE {table.name} ADD COLUMN {col.name} {ctype}'))


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
