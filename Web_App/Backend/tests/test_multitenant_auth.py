from __future__ import annotations

import os
import sys
from pathlib import Path

# Add Backend to pythonpath
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, create_engine

# Use SQLite for testing
os.environ['DATABASE_URL'] = 'sqlite:///./test_aqualora.db'
os.environ['ADMIN_PASSWORD'] = 'TestAdmin123'
os.environ['JWT_SECRET'] = 'test-secret-key-123'

from app.auth import create_token, hash_password

from app.config import get_settings
from app.database import Alert, MasterNode, Reading, get_session, init_db
from app.main import app, seed_default_master_node

test_engine = create_engine('sqlite:///./test_aqualora.db', connect_args={'check_same_thread': False})


@pytest.fixture(autouse=True)
def setup_db():
    SQLModel.metadata.drop_all(test_engine)
    SQLModel.metadata.create_all(test_engine)

    def get_test_session():
        return Session(test_engine)

    app.dependency_overrides[get_session] = get_test_session
    seed_default_master_node()
    yield
    app.dependency_overrides.clear()
    if os.path.exists('./test_aqualora.db'):
        try:
            os.remove('./test_aqualora.db')
        except Exception:
            pass


def test_directory_listing_public():
    client = TestClient(app)
    resp = client.get('/master-nodes/directory')
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) >= 1
    assert data[0]['node_code'] == 'AQL-0001'
    assert 'password' not in data[0]
    assert 'password_hash' not in data[0]


def test_login_success_and_failure():
    client = TestClient(app)

    # The web console accepts the seeded administrator.
    resp = client.post('/auth/login', json={'node_code': 'AQL-0001', 'password': 'TestAdmin123', 'client': 'web'})
    assert resp.status_code == 200
    body = resp.json()
    assert 'access_token' in body
    assert body['node_code'] == 'AQL-0001'
    assert body['role'] == 'super_admin'

    # Failed login with wrong password
    resp_fail = client.post('/auth/login', json={'node_code': 'AQL-0001', 'password': 'WrongPassword'})
    assert resp_fail.status_code == 401

    # Administrators cannot use the mobile or desktop cloud clients.
    mobile_admin = client.post('/auth/login', json={'node_code': 'AQL-0001', 'password': 'TestAdmin123', 'client': 'mobile'})
    desktop_admin = client.post('/auth/login', json={'node_code': 'AQL-0001', 'password': 'TestAdmin123', 'client': 'desktop'})
    assert mobile_admin.status_code == 403
    assert desktop_admin.status_code == 403

    # Customer credentials are rejected by the web console but accepted by clients.
    customer = MasterNode(
        node_code='AQL-0002',
        display_name='Customer Facility',
        password_hash=hash_password('CustomerPass123'),
        role='customer',
        status='active',
    )
    with Session(test_engine) as session:
        session.add(customer)
        session.commit()
    web_customer = client.post('/auth/login', json={'node_code': 'AQL-0002', 'password': 'CustomerPass123', 'client': 'web'})
    mobile_customer = client.post('/auth/login', json={'node_code': 'AQL-0002', 'password': 'CustomerPass123', 'client': 'mobile'})
    desktop_customer = client.post('/auth/login', json={'node_code': 'AQL-0002', 'password': 'CustomerPass123', 'client': 'desktop'})
    assert web_customer.status_code == 403
    assert mobile_customer.status_code == 200
    assert desktop_customer.status_code == 200


def test_multi_tenant_data_isolation():
    client = TestClient(app)

    # Create second customer node
    token_admin = client.post('/auth/login', json={'node_code': 'AQL-0001', 'password': 'TestAdmin123'}).json()['access_token']
    resp_create = client.post(
        '/master-nodes',
        headers={'Authorization': f'Bearer {token_admin}'},
        json={
            'node_code': 'AQL-0002',
            'display_name': 'Customer 2 Farm',
            'password': 'CustomerPass123',
            'pond_type': 'prawn',
            'role': 'customer'
        }
    )
    assert resp_create.status_code == 201

    # Login as Customer 2
    token_cust2 = client.post('/auth/login', json={'node_code': 'AQL-0002', 'password': 'CustomerPass123'}).json()['access_token']

    # Unauthenticated read should fail with 401
    assert client.get('/readings/latest').status_code == 401
    assert client.get('/alerts/latest').status_code == 401

    # Customer 1 syncs reading
    client.post(
        '/readings/sync',
        headers={'Authorization': f'Bearer {token_admin}'},
        json={'readings': [{'node_id': 'sensor-node-1', 'timestamp': '2026-09-01T10:00:00Z', 'temperature': 28.5}]}
    )

    # Customer 2 syncs reading
    client.post(
        '/readings/sync',
        headers={'Authorization': f'Bearer {token_cust2}'},
        json={'readings': [{'node_id': 'sensor-node-2', 'timestamp': '2026-09-01T10:05:00Z', 'temperature': 22.0}]}
    )

    # Customer 1 gets only sensor-node-1
    c1_readings = client.get('/readings/latest', headers={'Authorization': f'Bearer {token_admin}'}).json()
    assert len(c1_readings) == 1
    assert c1_readings[0]['node_id'] == 'sensor-node-1'
    assert c1_readings[0]['temperature'] == 28.5

    # Customer 2 gets only sensor-node-2
    c2_readings = client.get('/readings/latest', headers={'Authorization': f'Bearer {token_cust2}'}).json()
    assert len(c2_readings) == 1
    assert c2_readings[0]['node_id'] == 'sensor-node-2'
    assert c2_readings[0]['temperature'] == 22.0


def test_profile_and_password_change():
    client = TestClient(app)
    token = client.post('/auth/login', json={'node_code': 'AQL-0001', 'password': 'TestAdmin123'}).json()['access_token']

    # Get profile
    profile = client.get('/master-nodes/me', headers={'Authorization': f'Bearer {token}'}).json()
    assert profile['node_code'] == 'AQL-0001'

    # Update profile
    patch_resp = client.patch(
        '/master-nodes/me',
        headers={'Authorization': f'Bearer {token}'},
        json={'display_name': 'Updated Node Name', 'site_location': 'Sector 7 Ponds'}
    )
    assert patch_resp.status_code == 200
    assert patch_resp.json()['display_name'] == 'Updated Node Name'
    assert patch_resp.json()['site_location'] == 'Sector 7 Ponds'

    # Change password
    pwd_resp = client.post(
        '/auth/change-password',
        headers={'Authorization': f'Bearer {token}'},
        json={'current_password': 'TestAdmin123', 'new_password': 'NewSuperSecretPass!'}
    )
    assert pwd_resp.status_code == 200

    # Old password no longer works
    assert client.post('/auth/login', json={'node_code': 'AQL-0001', 'password': 'TestAdmin123'}).status_code == 401

    # New password works
    assert client.post('/auth/login', json={'node_code': 'AQL-0001', 'password': 'NewSuperSecretPass!'}).status_code == 200


def test_node_config_sync_and_threshold_isolation():
    client = TestClient(app)
    token_admin = client.post('/auth/login', json={'node_code': 'AQL-0001', 'password': 'TestAdmin123'}).json()['access_token']

    # Sync node configs for AQL-0001
    sync_resp = client.post(
        '/nodes/sync',
        headers={'Authorization': f'Bearer {token_admin}'},
        json={
            'nodes': [
                {
                    'node_id': 'sensor-node-1',
                    'name': 'Pond Alpha',
                    'location': 'North Sector',
                    'pond_type': 'prawn',
                    'custom_profile': {
                        'temperature': {'min': 24, 'max': 30},
                        'ph': {'min': 7.2, 'max': 8.2}
                    }
                }
            ]
        }
    )
    assert sync_resp.status_code == 200
    assert sync_resp.json()['stored'] == 1

    # Fetch nodes
    nodes = client.get('/nodes', headers={'Authorization': f'Bearer {token_admin}'}).json()
    assert len(nodes) == 1
    assert nodes[0]['node_id'] == 'sensor-node-1'
    assert nodes[0]['pond_type'] == 'prawn'
    assert nodes[0]['custom_profile']['temperature']['min'] == 24

    # Update node directly via PATCH
    patch_resp = client.patch(
        '/nodes/sensor-node-1',
        headers={'Authorization': f'Bearer {token_admin}'},
        json={
            'pond_type': 'tilapia',
            'custom_profile': {
                'temperature': {'min': 20, 'max': 32},
                'ph': {'min': 6.5, 'max': 8.5}
            }
        }
    )
    assert patch_resp.status_code == 200
    assert patch_resp.json()['pond_type'] == 'tilapia'
    assert patch_resp.json()['custom_profile']['temperature']['min'] == 20

