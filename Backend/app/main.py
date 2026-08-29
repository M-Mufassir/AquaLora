from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from .auth import create_token, verify_token
from .config import get_settings
from .database import Reading, get_session, init_db

app = FastAPI(title='AquaLoRa Cloud Backup API')
settings = get_settings()


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = 'bearer'


class ReadingPayload(BaseModel):
    node_id: str
    timestamp: str
    temperature: float | None = None
    turbidity: float | None = None
    tds: float | None = None
    ph: float | None = None
    pond_type: str | None = None
    battery_pct: float | None = None
    rssi: int | None = None


class SyncRequest(BaseModel):
    readings: list[ReadingPayload]


@app.on_event('startup')
def startup_event() -> None:
    init_db()


@app.get('/health')
def health() -> dict[str, str]:
    return {'status': 'ok'}


@app.post('/auth/login', response_model=LoginResponse)
def login(payload: LoginRequest) -> LoginResponse:
    if payload.username != settings.admin_username or payload.password != settings.admin_password:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='Invalid credentials')

    return LoginResponse(access_token=create_token(payload.username))


@app.post('/readings/sync')
def sync_readings(payload: SyncRequest, _: str = Depends(verify_token)) -> dict[str, Any]:
    if not payload.readings:
        return {'received': 0, 'stored': 0}

    with get_session() as session:
        saved = 0
        for reading in payload.readings:
            statement = select(Reading).where(
                Reading.node_id == reading.node_id,
                Reading.timestamp == reading.timestamp,
            )
            existing = session.exec(statement).first()

            row = Reading(
                node_id=reading.node_id,
                timestamp=reading.timestamp,
                temperature=reading.temperature,
                turbidity=reading.turbidity,
                tds=reading.tds,
                ph=reading.ph,
                pond_type=reading.pond_type,
                battery_pct=reading.battery_pct,
                rssi=reading.rssi,
                created_at=datetime.now(timezone.utc).isoformat(),
            )

            if existing is None:
                session.add(row)
                saved += 1
            else:
                for field_name in [
                    'temperature',
                    'turbidity',
                    'tds',
                    'ph',
                    'pond_type',
                    'battery_pct',
                    'rssi',
                    'created_at',
                ]:
                    setattr(existing, field_name, getattr(row, field_name))

        session.commit()

    return {'received': len(payload.readings), 'stored': saved}


@app.get('/readings/latest')
def latest_readings() -> list[dict[str, Any]]:
    with get_session() as session:
        rows = session.exec(select(Reading).order_by(Reading.timestamp.desc())).all()
        latest: dict[str, Reading] = {}
        for row in rows:
            latest[row.node_id] = row
        return [
            {
                'node_id': row.node_id,
                'timestamp': row.timestamp,
                'temperature': row.temperature,
                'turbidity': row.turbidity,
                'tds': row.tds,
                'ph': row.ph,
                'pond_type': row.pond_type,
                'battery_pct': row.battery_pct,
                'rssi': row.rssi,
            }
            for row in latest.values()
        ]


@app.get('/readings/history')
def history_readings(
    start: str | None = Query(default=None),
    end: str | None = Query(default=None),
    limit: int = Query(default=100, le=500),
) -> list[dict[str, Any]]:
    with get_session() as session:
        statement = select(Reading)
        if start:
            statement = statement.where(Reading.timestamp >= start)
        if end:
            statement = statement.where(Reading.timestamp <= end)
        statement = statement.order_by(Reading.timestamp.desc()).limit(limit)
        rows = session.exec(statement).all()

    return [
        {
            'node_id': row.node_id,
            'timestamp': row.timestamp,
            'temperature': row.temperature,
            'turbidity': row.turbidity,
            'tds': row.tds,
            'ph': row.ph,
            'pond_type': row.pond_type,
            'battery_pct': row.battery_pct,
            'rssi': row.rssi,
        }
        for row in rows
    ]
