from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from .auth import create_token, verify_token
from .config import get_settings
from .database import Reading, Alert, get_session, init_db

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


class AlertPayload(BaseModel):
    node_id: str
    timestamp: str
    parameter: str  # "temperature", "turbidity", "tds", "ph"
    severity: str   # "normal", "warning", "critical"
    message: str


class SyncRequest(BaseModel):
    readings: list[ReadingPayload]


class AlertsSyncRequest(BaseModel):
    alerts: list[AlertPayload]


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


@app.post('/alerts/sync')
def sync_alerts(payload: AlertsSyncRequest, _: str = Depends(verify_token)) -> dict[str, Any]:
    """Sync alerts from desktop app (idempotent)"""
    if not payload.alerts:
        return {'received': 0, 'stored': 0}

    with get_session() as session:
        saved = 0
        for alert in payload.alerts:
            # Check if alert already exists (by node_id + timestamp)
            statement = select(Alert).where(
                Alert.node_id == alert.node_id,
                Alert.timestamp == alert.timestamp,
            )
            existing = session.exec(statement).first()

            alert_row = Alert(
                node_id=alert.node_id,
                timestamp=alert.timestamp,
                parameter=alert.parameter,
                severity=alert.severity,
                message=alert.message,
                created_at=datetime.now(timezone.utc).isoformat(),
                synced_at=datetime.now(timezone.utc).isoformat(),
            )

            if existing is None:
                session.add(alert_row)
                saved += 1

        session.commit()

    return {'received': len(payload.alerts), 'stored': saved}


@app.get('/alerts/latest')
def latest_alerts(limit: int = Query(default=20, le=100)) -> list[dict[str, Any]]:
    """Get latest alerts for all nodes"""
    with get_session() as session:
        rows = session.exec(
            select(Alert).order_by(Alert.timestamp.desc()).limit(limit)
        ).all()

    return [
        {
            'id': row.id,
            'node_id': row.node_id,
            'timestamp': row.timestamp,
            'parameter': row.parameter,
            'severity': row.severity,
            'message': row.message,
            'created_at': row.created_at,
            'synced_at': row.synced_at,
        }
        for row in rows
    ]


@app.get('/alerts/history')
def alerts_history(
    node_id: str | None = Query(default=None),
    start: str | None = Query(default=None),
    end: str | None = Query(default=None),
    limit: int = Query(default=100, le=500),
) -> list[dict[str, Any]]:
    """Get alert history with optional filters"""
    with get_session() as session:
        statement = select(Alert)
        if node_id:
            statement = statement.where(Alert.node_id == node_id)
        if start:
            statement = statement.where(Alert.timestamp >= start)
        if end:
            statement = statement.where(Alert.timestamp <= end)
        statement = statement.order_by(Alert.timestamp.desc()).limit(limit)
        rows = session.exec(statement).all()

    return [
        {
            'id': row.id,
            'node_id': row.node_id,
            'timestamp': row.timestamp,
            'parameter': row.parameter,
            'severity': row.severity,
            'message': row.message,
            'created_at': row.created_at,
            'synced_at': row.synced_at,
        }
        for row in rows
    ]
