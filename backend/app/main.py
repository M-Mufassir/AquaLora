from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import json
from sqlmodel import Session, select

from .auth import create_token, hash_password, require_super_admin, verify_password, verify_token
from .config import get_settings
from .database import Alert, MasterNode, NodeConfig, Reading, get_session, init_db


from starlette.requests import Request

app = FastAPI(title='AquaLoRa Multi-Tenant Cloud API')
settings = get_settings()

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r'^https?://.*',
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)


@app.middleware('http')
async def rewrite_api_prefix(request: Request, call_next):
    """Allow all endpoints to be accessed either with or without `/api` prefix."""
    path = request.scope.get('path', '')
    if path.startswith('/api/'):
        request.scope['path'] = path[4:]
    elif path == '/api':
        request.scope['path'] = '/'
    return await call_next(request)


class LoginRequest(BaseModel):
    node_code: str | None = None
    username: str | None = None  # fallback for legacy client callers
    password: str
    client: str | None = None


class LoginResponse(BaseModel):
    access_token: str
    token: str | None = None
    token_type: str = 'bearer'
    node_code: str
    username: str
    display_name: str
    role: str
    master_node_id: int


class MasterNodeDirectoryItem(BaseModel):
    node_code: str
    display_name: str


class MasterNodeProfileResponse(BaseModel):
    id: int
    node_code: str
    display_name: str
    contact_name: str | None = None
    contact_phone: str | None = None
    site_location: str | None = None
    pond_type: str | None = None
    installed_at: str | None = None
    role: str
    status: str
    created_at: str | None = None
    updated_at: str | None = None


class MasterNodeProfileUpdateRequest(BaseModel):
    display_name: str | None = None
    contact_name: str | None = None
    contact_phone: str | None = None
    site_location: str | None = None
    pond_type: str | None = None


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class CreateMasterNodeRequest(BaseModel):
    node_code: str
    display_name: str
    password: str
    contact_name: str | None = None
    contact_phone: str | None = None
    site_location: str | None = None
    pond_type: str | None = None
    role: str = 'customer'


class AdminMasterNodeUpdateRequest(BaseModel):
    display_name: str | None = None
    contact_name: str | None = None
    contact_phone: str | None = None
    site_location: str | None = None
    pond_type: str | None = None
    role: str | None = None
    status: str | None = None


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


class NodeConfigPayload(BaseModel):
    node_id: str
    name: str | None = None
    location: str | None = None
    pond_type: str = 'tilapia'
    custom_profile: dict[str, Any] | str | None = None


class NodeConfigSyncRequest(BaseModel):
    nodes: list[NodeConfigPayload]


class NodeConfigResponse(BaseModel):
    id: int
    master_node_id: int
    node_id: str
    name: str | None = None
    location: str | None = None
    pond_type: str = 'tilapia'
    custom_profile: dict[str, Any] | str | None = None
    updated_at: str | None = None


class NodeConfigUpdateRequest(BaseModel):
    name: str | None = None
    location: str | None = None
    pond_type: str | None = None
    custom_profile: dict[str, Any] | str | None = None



def seed_default_master_node() -> None:
    with get_session() as session:
        existing = session.exec(select(MasterNode)).first()
        if existing is None:
            now_iso = datetime.now(timezone.utc).isoformat()
            default_node = MasterNode(
                node_code='AQL-0001',
                display_name='Default AquaLoRa Master Node',
                password_hash=hash_password(settings.admin_password),
                contact_name='AquaLoRa Admin',
                site_location='Primary Facility',
                pond_type='tilapia',
                installed_at=now_iso,
                role='super_admin',
                status='active',
                created_at=now_iso,
                updated_at=now_iso,
            )
            session.add(default_node)
            session.commit()


from contextlib import asynccontextmanager


@asynccontextmanager
async def lifespan(application: FastAPI):
    init_db()
    seed_default_master_node()
    yield


app.router.lifespan_context = lifespan


@app.get('/health')
@app.get('/api/health')
def health() -> dict[str, str]:
    return {'status': 'ok'}


@app.get('/master-nodes/directory', response_model=list[MasterNodeDirectoryItem])
def list_directory() -> list[MasterNodeDirectoryItem]:
    """Public directory listing of active master nodes for client login dropdowns."""
    with get_session() as session:
        nodes = session.exec(
            select(MasterNode)
            .where(MasterNode.status == 'active')
            .order_by(MasterNode.node_code)
        ).all()
        return [
            MasterNodeDirectoryItem(node_code=node.node_code, display_name=node.display_name)
            for node in nodes
        ]


@app.post('/auth/login', response_model=LoginResponse)
def login(payload: LoginRequest) -> LoginResponse:
    identifier = (payload.node_code or payload.username or '').strip()
    if not identifier:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail='Master node code or username is required',
        )

    with get_session() as session:
        statement = select(MasterNode).where(
            (MasterNode.node_code.ilike(identifier)) | (MasterNode.node_code == identifier)
        )
        node = session.exec(statement).first()

        if node is None:
            # Check if identifier matches default super admin config and seed if missing
            if identifier.lower() == settings.admin_username.lower():
                node = session.exec(select(MasterNode).where(MasterNode.role == 'super_admin')).first()

        if node is None or node.status != 'active':
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail='Invalid credentials or inactive account',
            )

        if not verify_password(payload.password, node.password_hash):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail='Invalid credentials',
            )

        # Allow both super_admin and customer accounts on the web console
        if payload.client in ('mobile', 'desktop') and node.role == 'super_admin':
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail='Administrators must use the web console',
            )

        token_str = create_token(
            master_node_id=node.id,
            node_code=node.node_code,
            role=node.role,
        )

        return LoginResponse(
            access_token=token_str,
            token=token_str,
            token_type='bearer',
            node_code=node.node_code,
            username=node.node_code,
            display_name=node.display_name,
            role=node.role,
            master_node_id=node.id,
        )


@app.get('/master-nodes/me', response_model=MasterNodeProfileResponse)
def get_my_profile(claims: dict[str, Any] = Depends(verify_token)) -> MasterNodeProfileResponse:
    with get_session() as session:
        node = session.get(MasterNode, claims['master_node_id'])
        if node is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Master node not found')
        return MasterNodeProfileResponse(
            id=node.id,
            node_code=node.node_code,
            display_name=node.display_name,
            contact_name=node.contact_name,
            contact_phone=node.contact_phone,
            site_location=node.site_location,
            pond_type=node.pond_type,
            installed_at=node.installed_at,
            role=node.role,
            status=node.status,
            created_at=node.created_at,
            updated_at=node.updated_at,
        )


@app.patch('/master-nodes/me', response_model=MasterNodeProfileResponse)
def update_my_profile(
    payload: MasterNodeProfileUpdateRequest,
    claims: dict[str, Any] = Depends(verify_token),
) -> MasterNodeProfileResponse:
    with get_session() as session:
        node = session.get(MasterNode, claims['master_node_id'])
        if node is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Master node not found')

        if payload.display_name is not None and payload.display_name.strip():
            node.display_name = payload.display_name.strip()
        if payload.contact_name is not None:
            node.contact_name = payload.contact_name.strip() or None
        if payload.contact_phone is not None:
            node.contact_phone = payload.contact_phone.strip() or None
        if payload.site_location is not None:
            node.site_location = payload.site_location.strip() or None
        if payload.pond_type is not None:
            node.pond_type = payload.pond_type.strip() or None

        node.updated_at = datetime.now(timezone.utc).isoformat()
        session.add(node)
        session.commit()
        session.refresh(node)

        return MasterNodeProfileResponse(
            id=node.id,
            node_code=node.node_code,
            display_name=node.display_name,
            contact_name=node.contact_name,
            contact_phone=node.contact_phone,
            site_location=node.site_location,
            pond_type=node.pond_type,
            installed_at=node.installed_at,
            role=node.role,
            status=node.status,
            created_at=node.created_at,
            updated_at=node.updated_at,
        )


@app.post('/auth/change-password')
def change_password_endpoint(
    payload: ChangePasswordRequest,
    claims: dict[str, Any] = Depends(verify_token),
) -> dict[str, str]:
    if not payload.new_password or len(payload.new_password) < 6:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail='New password must be at least 6 characters',
        )

    with get_session() as session:
        node = session.get(MasterNode, claims['master_node_id'])
        if node is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Master node not found')

        if not verify_password(payload.current_password, node.password_hash):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail='Current password does not match',
            )

        node.password_hash = hash_password(payload.new_password)
        node.updated_at = datetime.now(timezone.utc).isoformat()
        session.add(node)
        session.commit()

    return {'message': 'Password updated successfully'}


@app.post('/master-nodes', response_model=MasterNodeProfileResponse, status_code=status.HTTP_201_CREATED)
def create_master_node(
    payload: CreateMasterNodeRequest,
    _: dict[str, Any] = Depends(require_super_admin),
) -> MasterNodeProfileResponse:
    code = payload.node_code.strip().upper()
    if not code:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Node code is required')

    with get_session() as session:
        existing = session.exec(select(MasterNode).where(MasterNode.node_code == code)).first()
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f'Master node with code {code} already exists',
            )

        now_iso = datetime.now(timezone.utc).isoformat()
        new_node = MasterNode(
            node_code=code,
            display_name=payload.display_name.strip(),
            password_hash=hash_password(payload.password),
            contact_name=payload.contact_name.strip() if payload.contact_name else None,
            contact_phone=payload.contact_phone.strip() if payload.contact_phone else None,
            site_location=payload.site_location.strip() if payload.site_location else None,
            pond_type=payload.pond_type.strip() if payload.pond_type else None,
            installed_at=now_iso,
            role=payload.role if payload.role in ('customer', 'super_admin') else 'customer',
            status='active',
            created_at=now_iso,
            updated_at=now_iso,
        )
        session.add(new_node)
        session.commit()
        session.refresh(new_node)

        return MasterNodeProfileResponse(
            id=new_node.id,
            node_code=new_node.node_code,
            display_name=new_node.display_name,
            contact_name=new_node.contact_name,
            contact_phone=new_node.contact_phone,
            site_location=new_node.site_location,
            pond_type=new_node.pond_type,
            installed_at=new_node.installed_at,
            role=new_node.role,
            status=new_node.status,
            created_at=new_node.created_at,
            updated_at=new_node.updated_at,
        )


@app.get('/admin/master-nodes', response_model=list[MasterNodeProfileResponse])
def list_master_nodes(
    _: dict[str, Any] = Depends(require_super_admin),
) -> list[MasterNodeProfileResponse]:
    with get_session() as session:
        nodes = session.exec(select(MasterNode).order_by(MasterNode.node_code)).all()
        return [
            MasterNodeProfileResponse(
                id=node.id,
                node_code=node.node_code,
                display_name=node.display_name,
                contact_name=node.contact_name,
                contact_phone=node.contact_phone,
                site_location=node.site_location,
                pond_type=node.pond_type,
                installed_at=node.installed_at,
                role=node.role,
                status=node.status,
                created_at=node.created_at,
                updated_at=node.updated_at,
            )
            for node in nodes
        ]


@app.patch('/admin/master-nodes/{master_node_id}', response_model=MasterNodeProfileResponse)
def update_master_node(
    master_node_id: int,
    payload: AdminMasterNodeUpdateRequest,
    _: dict[str, Any] = Depends(require_super_admin),
) -> MasterNodeProfileResponse:
    with get_session() as session:
        node = session.get(MasterNode, master_node_id)
        if node is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Master node not found')

        for field_name in ('display_name', 'contact_name', 'contact_phone', 'site_location', 'pond_type'):
            value = getattr(payload, field_name)
            if value is not None:
                setattr(node, field_name, value.strip() or None)
        if payload.role in ('customer', 'super_admin'):
            node.role = payload.role
        if payload.status in ('active', 'suspended'):
            node.status = payload.status
        node.updated_at = datetime.now(timezone.utc).isoformat()
        session.add(node)
        session.commit()
        session.refresh(node)
        return MasterNodeProfileResponse(
            id=node.id,
            node_code=node.node_code,
            display_name=node.display_name,
            contact_name=node.contact_name,
            contact_phone=node.contact_phone,
            site_location=node.site_location,
            pond_type=node.pond_type,
            installed_at=node.installed_at,
            role=node.role,
            status=node.status,
            created_at=node.created_at,
            updated_at=node.updated_at,
        )


@app.delete('/admin/master-nodes/{master_node_id}')
def delete_master_node(
    master_node_id: int,
    _: dict[str, Any] = Depends(require_super_admin),
) -> dict[str, str]:
    with get_session() as session:
        node = session.get(MasterNode, master_node_id)
        if node is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Master node not found')
        session.delete(node)
        session.commit()
    return {'message': 'Master node deleted successfully'}


@app.get('/admin/readings/latest')
def admin_readings_latest(
    _: dict[str, Any] = Depends(require_super_admin),
) -> list[dict[str, Any]]:
    """Get the latest reading for every sensor node across all facilities"""
    with get_session() as session:
        # Get map of master node id to master node code & name
        master_nodes = {mn.id: mn for mn in session.exec(select(MasterNode)).all()}
        rows = session.exec(select(Reading).order_by(Reading.timestamp.desc())).all()
        latest: dict[str, Reading] = {}
        for row in rows:
            key = f"{row.master_node_id}-{row.node_id}"
            if key not in latest:
                latest[key] = row

        return [
            {
                'id': row.id,
                'master_node_id': row.master_node_id,
                'master_node_code': master_nodes.get(row.master_node_id).node_code if row.master_node_id in master_nodes else None,
                'master_node_name': master_nodes.get(row.master_node_id).display_name if row.master_node_id in master_nodes else None,
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


@app.get('/admin/readings/history')
def admin_readings_history(
    node_id: str | None = Query(default=None),
    master_node_id: int | None = Query(default=None),
    start: str | None = Query(default=None),
    end: str | None = Query(default=None),
    limit: int = Query(default=300, le=1000),
    _: dict[str, Any] = Depends(require_super_admin),
) -> list[dict[str, Any]]:
    with get_session() as session:
        master_nodes = {mn.id: mn for mn in session.exec(select(MasterNode)).all()}
        statement = select(Reading)
        if node_id:
            statement = statement.where(Reading.node_id == node_id)
        if master_node_id:
            statement = statement.where(Reading.master_node_id == master_node_id)
        if start:
            statement = statement.where(Reading.timestamp >= start)
        if end:
            statement = statement.where(Reading.timestamp <= end)
        statement = statement.order_by(Reading.timestamp.desc()).limit(limit)
        rows = session.exec(statement).all()

    return [
        {
            'id': row.id,
            'master_node_id': row.master_node_id,
            'master_node_code': master_nodes.get(row.master_node_id).node_code if row.master_node_id in master_nodes else None,
            'master_node_name': master_nodes.get(row.master_node_id).display_name if row.master_node_id in master_nodes else None,
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


@app.get('/dashboard/stats')
def dashboard_stats(claims: dict[str, Any] = Depends(verify_token)) -> dict[str, Any]:
    """Get system summary metrics for dashboard cards"""
    is_admin = claims.get('role') == 'super_admin'
    master_node_id = claims.get('master_node_id')

    with get_session() as session:
        if is_admin:
            total_facilities = len(session.exec(select(MasterNode)).all())
            readings_stmt = select(Reading).order_by(Reading.timestamp.desc()).limit(500)
            alerts_stmt = select(Alert).order_by(Alert.timestamp.desc()).limit(200)
            nodes_stmt = select(NodeConfig)
        else:
            total_facilities = 1
            readings_stmt = select(Reading).where(Reading.master_node_id == master_node_id).order_by(Reading.timestamp.desc()).limit(500)
            alerts_stmt = select(Alert).where(Alert.master_node_id == master_node_id).order_by(Alert.timestamp.desc()).limit(200)
            nodes_stmt = select(NodeConfig).where(NodeConfig.master_node_id == master_node_id)

        all_readings = session.exec(readings_stmt).all()
        all_alerts = session.exec(alerts_stmt).all()
        all_nodes = session.exec(nodes_stmt).all()

        distinct_node_ids = set(r.node_id for r in all_readings).union(set(n.node_id for n in all_nodes))
        critical_alerts = sum(1 for a in all_alerts if a.severity.lower() == 'critical')
        warning_alerts = sum(1 for a in all_alerts if a.severity.lower() == 'warning')

        # Compute parameter averages from latest readings
        temps = [r.temperature for r in all_readings if r.temperature is not None]
        phs = [r.ph for r in all_readings if r.ph is not None]
        tdss = [r.tds for r in all_readings if r.tds is not None]
        turbidities = [r.turbidity for r in all_readings if r.turbidity is not None]
        batteries = [r.battery_pct for r in all_readings if r.battery_pct is not None]

        return {
            'total_facilities': total_facilities,
            'total_sensor_nodes': len(distinct_node_ids),
            'total_readings': len(all_readings),
            'critical_alerts': critical_alerts,
            'warning_alerts': warning_alerts,
            'avg_temperature': round(sum(temps) / len(temps), 1) if temps else None,
            'avg_ph': round(sum(phs) / len(phs), 2) if phs else None,
            'avg_tds': round(sum(tdss) / len(tdss), 0) if tdss else None,
            'avg_turbidity': round(sum(turbidities) / len(turbidities), 1) if turbidities else None,
            'avg_battery': round(sum(batteries) / len(batteries), 0) if batteries else None,
        }


@app.get('/admin/alerts/history')
def admin_alerts_history(
    node_id: str | None = Query(default=None),
    severity: str | None = Query(default=None),
    limit: int = Query(default=200, le=500),
    _: dict[str, Any] = Depends(require_super_admin),
) -> list[dict[str, Any]]:
    with get_session() as session:
        statement = select(Alert)
        if node_id:
            statement = statement.where(Alert.node_id == node_id)
        if severity and severity != 'all':
            statement = statement.where(Alert.severity == severity)
        statement = statement.order_by(Alert.timestamp.desc()).limit(limit)
        rows = session.exec(statement).all()

    return [
        {
            'id': row.id,
            'master_node_id': row.master_node_id,
            'node_id': row.node_id,
            'timestamp': row.timestamp,
            'parameter': row.parameter,
            'severity': row.severity,
            'message': row.message,
            'created_at': row.created_at,
        }
        for row in rows
    ]


@app.post('/readings/sync')
def sync_readings(
    payload: SyncRequest,
    claims: dict[str, Any] = Depends(verify_token),
) -> dict[str, Any]:
    if not payload.readings:
        return {'received': 0, 'stored': 0}

    master_node_id = claims['master_node_id']

    with get_session() as session:
        saved = 0
        for reading in payload.readings:
            statement = select(Reading).where(
                Reading.master_node_id == master_node_id,
                Reading.node_id == reading.node_id,
                Reading.timestamp == reading.timestamp,
            )
            existing = session.exec(statement).first()

            row = Reading(
                master_node_id=master_node_id,
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
def latest_readings(claims: dict[str, Any] = Depends(verify_token)) -> list[dict[str, Any]]:
    master_node_id = claims['master_node_id']
    with get_session() as session:
        statement = (
            select(Reading)
            .where(Reading.master_node_id == master_node_id)
            .order_by(Reading.timestamp.desc())
        )
        rows = session.exec(statement).all()
        latest: dict[str, Reading] = {}
        for row in rows:
            if row.node_id not in latest:
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
    claims: dict[str, Any] = Depends(verify_token),
) -> list[dict[str, Any]]:
    master_node_id = claims['master_node_id']
    with get_session() as session:
        statement = select(Reading).where(Reading.master_node_id == master_node_id)
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
def sync_alerts(
    payload: AlertsSyncRequest,
    claims: dict[str, Any] = Depends(verify_token),
) -> dict[str, Any]:
    """Sync alerts from desktop app scoped to authenticated master node (idempotent)"""
    if not payload.alerts:
        return {'received': 0, 'stored': 0}

    master_node_id = claims['master_node_id']

    with get_session() as session:
        saved = 0
        for alert in payload.alerts:
            statement = select(Alert).where(
                Alert.master_node_id == master_node_id,
                Alert.node_id == alert.node_id,
                Alert.timestamp == alert.timestamp,
            )
            existing = session.exec(statement).first()

            alert_row = Alert(
                master_node_id=master_node_id,
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
def latest_alerts(
    limit: int = Query(default=20, le=100),
    claims: dict[str, Any] = Depends(verify_token),
) -> list[dict[str, Any]]:
    """Get latest alerts for current master node"""
    master_node_id = claims['master_node_id']
    with get_session() as session:
        rows = session.exec(
            select(Alert)
            .where(Alert.master_node_id == master_node_id)
            .order_by(Alert.timestamp.desc())
            .limit(limit)
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
    claims: dict[str, Any] = Depends(verify_token),
) -> list[dict[str, Any]]:
    """Get alert history for current master node with optional filters"""
    master_node_id = claims['master_node_id']
    with get_session() as session:
        statement = select(Alert).where(Alert.master_node_id == master_node_id)
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


@app.get('/nodes', response_model=list[NodeConfigResponse])
def get_node_configs(claims: dict[str, Any] = Depends(verify_token)) -> list[NodeConfigResponse]:
    """Fetch all configured sensor nodes and desired threshold target ranges for current master node"""
    master_node_id = claims['master_node_id']
    with get_session() as session:
        rows = session.exec(
            select(NodeConfig)
            .where(NodeConfig.master_node_id == master_node_id)
            .order_by(NodeConfig.node_id)
        ).all()

        results = []
        for row in rows:
            profile_val = row.custom_profile
            if isinstance(profile_val, str) and profile_val.strip().startswith('{'):
                try:
                    profile_val = json.loads(profile_val)
                except Exception:
                    pass
            results.append(
                NodeConfigResponse(
                    id=row.id,
                    master_node_id=row.master_node_id,
                    node_id=row.node_id,
                    name=row.name,
                    location=row.location,
                    pond_type=row.pond_type,
                    custom_profile=profile_val,
                    updated_at=row.updated_at,
                )
            )
        return results


@app.get('/admin/nodes')
def admin_get_all_nodes(
    _: dict[str, Any] = Depends(require_super_admin),
) -> list[dict[str, Any]]:
    """Super admin: list all sensor nodes across all facilities with facility metadata"""
    with get_session() as session:
        master_nodes = {mn.id: mn for mn in session.exec(select(MasterNode)).all()}
        rows = session.exec(select(NodeConfig).order_by(NodeConfig.node_id)).all()
        results = []
        for row in rows:
            mn = master_nodes.get(row.master_node_id)
            profile_val = row.custom_profile
            if isinstance(profile_val, str) and profile_val.strip().startswith('{'):
                try:
                    profile_val = json.loads(profile_val)
                except Exception:
                    pass
            results.append({
                'id': row.id,
                'master_node_id': row.master_node_id,
                'master_node_code': mn.node_code if mn else None,
                'master_node_name': mn.display_name if mn else None,
                'node_id': row.node_id,
                'name': row.name,
                'location': row.location,
                'pond_type': row.pond_type,
                'custom_profile': profile_val,
                'updated_at': row.updated_at,
            })
        return results


@app.post('/nodes/sync')
def sync_node_configs(
    payload: NodeConfigSyncRequest,
    claims: dict[str, Any] = Depends(verify_token),
) -> dict[str, Any]:
    """Sync node configurations and desired threshold values from desktop app"""
    master_node_id = claims['master_node_id']
    if not payload.nodes:
        return {'received': 0, 'stored': 0}

    with get_session() as session:
        saved = 0
        now_iso = datetime.now(timezone.utc).isoformat()
        for item in payload.nodes:
            profile_str = (
                json.dumps(item.custom_profile)
                if isinstance(item.custom_profile, dict)
                else item.custom_profile
            )
            statement = select(NodeConfig).where(
                NodeConfig.master_node_id == master_node_id,
                NodeConfig.node_id == item.node_id,
            )
            existing = session.exec(statement).first()
            if existing is None:
                row = NodeConfig(
                    master_node_id=master_node_id,
                    node_id=item.node_id,
                    name=item.name,
                    location=item.location,
                    pond_type=item.pond_type or 'tilapia',
                    custom_profile=profile_str,
                    updated_at=now_iso,
                )
                session.add(row)
                saved += 1
            else:
                if item.name is not None:
                    existing.name = item.name
                if item.location is not None:
                    existing.location = item.location
                if item.pond_type is not None:
                    existing.pond_type = item.pond_type
                if item.custom_profile is not None:
                    existing.custom_profile = profile_str
                existing.updated_at = now_iso
                session.add(existing)
                saved += 1
        session.commit()
    return {'received': len(payload.nodes), 'stored': saved}


@app.patch('/nodes/{node_id}', response_model=NodeConfigResponse)
def update_node_config(
    node_id: str,
    payload: NodeConfigUpdateRequest,
    claims: dict[str, Any] = Depends(verify_token),
) -> NodeConfigResponse:
    """Update pond type and target thresholds for a specific node"""
    master_node_id = claims['master_node_id']
    with get_session() as session:
        statement = select(NodeConfig).where(
            NodeConfig.master_node_id == master_node_id,
            NodeConfig.node_id == node_id,
        )
        node = session.exec(statement).first()
        now_iso = datetime.now(timezone.utc).isoformat()

        profile_str = (
            json.dumps(payload.custom_profile)
            if isinstance(payload.custom_profile, dict)
            else payload.custom_profile
        )

        if node is None:
            node = NodeConfig(
                master_node_id=master_node_id,
                node_id=node_id,
                name=payload.name,
                location=payload.location,
                pond_type=payload.pond_type or 'tilapia',
                custom_profile=profile_str,
                updated_at=now_iso,
            )
            session.add(node)
            session.commit()
            session.refresh(node)
        else:
            if payload.name is not None:
                node.name = payload.name.strip() or None
            if payload.location is not None:
                node.location = payload.location.strip() or None
            if payload.pond_type is not None:
                node.pond_type = payload.pond_type.strip() or 'tilapia'
            if payload.custom_profile is not None:
                node.custom_profile = profile_str
            node.updated_at = now_iso
            session.add(node)
            session.commit()
            session.refresh(node)

        profile_val = node.custom_profile
        if isinstance(profile_val, str) and profile_val.strip().startswith('{'):
            try:
                profile_val = json.loads(profile_val)
            except Exception:
                pass

        return NodeConfigResponse(
            id=node.id,
            master_node_id=node.master_node_id,
            node_id=node.node_id,
            name=node.name,
            location=node.location,
            pond_type=node.pond_type,
            custom_profile=profile_val,
            updated_at=node.updated_at,
        )


