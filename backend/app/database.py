from __future__ import annotations

from typing import Any
from sqlmodel import Field, Session, SQLModel, create_engine, select

from .config import get_settings

settings = get_settings()

db_url = settings.database_url
if db_url.startswith('postgres://'):
    db_url = db_url.replace('postgres://', 'postgresql://', 1)

engine_kwargs: dict[str, Any] = {'echo': False}
if 'sqlite' in db_url:
    engine_kwargs['connect_args'] = {'check_same_thread': False}
else:
    engine_kwargs['pool_pre_ping'] = True
    engine_kwargs['pool_recycle'] = 300

engine = create_engine(db_url, **engine_kwargs)


class MasterNode(SQLModel, table=True):
    __tablename__ = 'masternode'
    __table_args__ = {'extend_existing': True}

    id: int | None = Field(default=None, primary_key=True)
    node_code: str = Field(index=True, unique=True)
    display_name: str
    password_hash: str
    contact_name: str | None = None
    contact_phone: str | None = None
    site_location: str | None = None
    pond_type: str | None = None
    installed_at: str | None = None
    role: str = Field(default='customer')  # 'customer' | 'super_admin'
    status: str = Field(default='active')  # 'active' | 'suspended'
    created_at: str | None = None
    updated_at: str | None = None


class Reading(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    master_node_id: int | None = Field(default=None, index=True, foreign_key='masternode.id')
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


class Alert(SQLModel, table=True):
    """Alert events synced from desktop app"""
    id: int | None = Field(default=None, primary_key=True)
    master_node_id: int | None = Field(default=None, index=True, foreign_key='masternode.id')
    node_id: str = Field(index=True)
    timestamp: str = Field(index=True)
    parameter: str  # "temperature", "turbidity", "tds", "ph"
    severity: str   # "normal", "warning", "critical"
    message: str
    created_at: str | None = None
    synced_at: str | None = None

    __table_args__ = {'extend_existing': True}


class NodeConfig(SQLModel, table=True):
    """Pond and threshold configuration per sensor node"""
    __tablename__ = 'nodeconfig'
    __table_args__ = {'extend_existing': True}

    id: int | None = Field(default=None, primary_key=True)
    master_node_id: int = Field(index=True, foreign_key='masternode.id')
    node_id: str = Field(index=True)
    name: str | None = None
    location: str | None = None
    pond_type: str = Field(default='tilapia')
    custom_profile: str | None = None  # JSON string of desired threshold min/max targets
    updated_at: str | None = None


def init_db() -> None:
    SQLModel.metadata.create_all(engine)


def get_session() -> Session:
    return Session(engine)


