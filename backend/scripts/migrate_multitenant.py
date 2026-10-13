#!/usr/bin/env python3
"""
AquaLoRa Multi-Tenant Data Migration Script
Runs idempotent migration to support MasterNode tenancy:
1. Creates masternode table if missing
2. Seeds default node AQL-0001 with current ADMIN_PASSWORD
3. Adds master_node_id column to reading and alert tables if missing
4. Backfills existing reading and alert records with default node ID
"""

from __future__ import annotations

import os
import sys
from datetime import datetime, timezone
from pathlib import Path

# Add project root to pythonpath
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import inspect, text
from sqlmodel import Session, SQLModel, create_engine, select

from app.auth import hash_password
from app.config import get_settings
from app.database import Alert, MasterNode, Reading


def run_migration() -> None:
    settings = get_settings()
    engine = create_engine(settings.database_url, echo=False)

    print(f"[Migration] Connecting to database: {settings.database_url}")

    # Ensure tables exist
    SQLModel.metadata.create_all(engine)

    with Session(engine) as session:
        # Check / Seed default master node
        default_node = session.exec(
            select(MasterNode).where(MasterNode.node_code == 'AQL-0001')
        ).first()

        now_iso = datetime.now(timezone.utc).isoformat()
        if default_node is None:
            print("[Migration] Creating initial MasterNode 'AQL-0001'...")
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
            session.refresh(default_node)
            print(f"[Migration] Created MasterNode id={default_node.id}, code={default_node.node_code}")
        else:
            print(f"[Migration] Found existing default MasterNode id={default_node.id}, code={default_node.node_code}")

        # Check and add columns on PostgreSQL / SQLite if missing
        inspector = inspect(engine)

        reading_columns = [col['name'] for col in inspector.get_columns('reading')]
        if 'master_node_id' not in reading_columns:
            print("[Migration] Adding master_node_id column to reading table...")
            session.exec(text('ALTER TABLE reading ADD COLUMN master_node_id INTEGER;'))
            session.commit()

        alert_columns = [col['name'] for col in inspector.get_columns('alert')]
        if 'master_node_id' not in alert_columns:
            print("[Migration] Adding master_node_id column to alert table...")
            session.exec(text('ALTER TABLE alert ADD COLUMN master_node_id INTEGER;'))
            session.commit()

        # Backfill NULL master_node_id rows
        readings_updated = session.exec(
            text(f"UPDATE reading SET master_node_id = {default_node.id} WHERE master_node_id IS NULL")
        )
        alerts_updated = session.exec(
            text(f"UPDATE alert SET master_node_id = {default_node.id} WHERE master_node_id IS NULL")
        )
        session.commit()

        print(f"[Migration] Backfilled reading rows to master_node_id={default_node.id}")
        print(f"[Migration] Backfilled alert rows to master_node_id={default_node.id}")
        print("[Migration] Multi-tenant migration completed successfully!")


if __name__ == '__main__':
    run_migration()
