from __future__ import annotations

from sqlmodel import Field, Session, SQLModel, create_engine, select

from .config import get_settings

settings = get_settings()
engine = create_engine(settings.database_url, echo=False)


class Reading(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    node_id: str = Field(index=True)
    timestamp: str = Field(index=True)
    temperature: float | None = None
    turbidity: float | None = None
    tds: float | None = None
    ph: float | None = None
    pond_type: str | None = None
    battery_pct: float | None = None
    rssi: int | None = None
    created_at: str | None = None

    __table_args__ = {'extend_existing': True}


def init_db() -> None:
    SQLModel.metadata.create_all(engine)


def get_session() -> Session:
    return Session(engine)
