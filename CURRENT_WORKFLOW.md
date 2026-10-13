# AquaLoRa Current Workflow

This is the source of truth for the workflow implemented in the repository. Older reports and phase plans are historical records.

## System flow

```text
Slave sensors -> LoRa -> Master Node -> Wi-Fi/WebSocket -> Desktop application
                                      -> local SQLite record of truth
                                      -> optional cloud sync/history import
```

The desktop application is offline-first. Live readings are stored locally before cloud synchronization is attempted.

## Desktop startup

1. Electron initializes SQLite in the application user-data directory.
2. The saved cloud session and settings are restored.
3. All nodes are loaded from SQLite.
4. The latest stored reading for every node is loaded through `readings:getLatestByNode`, so cards show historical values immediately.
5. The saved Master Node WebSocket connection is restored when available.
6. Live readings update SQLite, the renderer, the decision engine, and the sync outbox.

## Pairing another Master Node

Pairing changes the active connection and credentials only. It does **not** delete nodes, readings, alerts, or outbox entries belonging to previously paired gateways. All local telemetry coexists in one SQLite database keyed by `node_id`.

After cloud authentication, the desktop starts a background import:

- `GET /nodes` imports names, locations, pond types, and custom profiles.
- `GET /readings/history?limit=200` imports historical readings.
- Duplicate `(node_id, timestamp)` rows are ignored.
- Imported nodes and readings are pushed to the renderer through `node:updated` and `reading:new`.

If cloud access is unavailable, pairing still succeeds in local/offline mode.

## Runtime telemetry flow

For each WebSocket reading, the desktop upserts the node, inserts the reading, queues cloud sync, updates the card, and evaluates temperature, turbidity, TDS, and pH through the decision engine. Nodes discovered by a `node_list` message are created before their first reading; stale nodes are marked offline automatically.

## Local data and reset behavior

The database is stored under Electron's `app.getPath('userData')`. Switching gateways is not a reset operation. The explicit `db:resetLocalNodeData` action remains available only for deliberate maintenance or test cleanup.

## Documentation map

- [Project overview](README.md)
- [Desktop application](desktop_application/README.md)
- [Firmware](firmware_design/README.md)
- [Cloud backend](backend/README.md)
- [Mobile client](mobile_application/README.md)
- Historical reports and roadmaps are retained as dated implementation records.

## Verification

```powershell
cd desktop_application
npm run typecheck
npm run build
```

For an end-to-end check, pair one gateway, verify a reading, pair a second gateway, verify the first gateway's data remains, and restart the app to confirm cards hydrate from SQLite before a live packet arrives.
