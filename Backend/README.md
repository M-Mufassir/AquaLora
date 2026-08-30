# AquaLoRa Backend

This folder contains the cloud backup backend for the AquaLoRa project. It is designed to receive synced data from the desktop app and serve data to the mobile app. Both desktop and mobile apps are independent, connected only through this PostgreSQL backend.

## Architecture

```
Desktop App (Electron, SQLite)
  └─ POST /readings/sync ──→ Backend (FastAPI, PostgreSQL)
                              ├─ /auth/login (both apps)
                              ├─ /readings/latest (mobile reads)
                              ├─ /readings/history (mobile reads)
                              └─ /alerts/sync (future)
  ←─────────────────────────── Mobile App (React Native)
                              └─ reads via API (independent)
```

## Clients

| Client | Purpose | Auth | Usage |
|--------|---------|------|-------|
| **Desktop App** | Write readings, offline monitoring | JWT | POST /readings/sync, GET /readings/latest |
| **Mobile App** | Read readings remotely | JWT | GET /readings/latest, GET /readings/history |

## Features

- `GET /health` health check
- `POST /auth/login` authentication endpoint (used by desktop and mobile)
- `POST /readings/sync` idempotent batch sync from desktop app
- `GET /readings/latest` latest reading per node (read by both apps)
- `GET /readings/history` time-window history (read by mobile)
- `POST /alerts/sync` alert sync from desktop (planned)

---

## 1. Run locally

1. Create a virtual environment:

```bash
python -m venv .venv
source .venv/bin/activate   # Linux / macOS
.\.venv\Scripts\activate    # Windows PowerShell
```

2. Install dependencies:

```bash
pip install -r requirements.txt
```

3. Start PostgreSQL locally:

```bash
docker compose up -d postgres
```

4. Start the API:

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

5. Check the app:

```bash
curl http://localhost:8000/health
```

Expected response:

```json
{ "status": "ok" }
```

---

## 2. Environment variables

Create a `.env` file in this folder with:

```env
DATABASE_URL=postgresql://aqualora:aqualora123@localhost:5432/aqualora
ADMIN_USERNAME=Admin
ADMIN_PASSWORD=Admin123
JWT_SECRET=change-this-secret-in-production
```

For production on Railway, set the same variables in the Railway dashboard instead of storing them in a local `.env` file.

---

## 3. Host on Railway

### Step 1: Push this folder to GitHub

Initialize a Git repository if needed and push the `Backend` folder to a GitHub repo.

```bash
git init
git add .
git commit -m "Initial AquaLoRa backend"
git branch -M main
git remote add origin <your-github-repo-url>
git push -u origin main
```

### Step 2: Create a Railway project

1. Open https://railway.com
2. Sign in with GitHub
3. Click New Project
4. Choose Deploy from GitHub repo
5. Select the repository that contains this backend
6. Choose the folder if the repo contains multiple apps

### Step 3: Add the app service

In Railway, set the service type to a Python app.

Railway will usually detect a Python project automatically, but this repo is a FastAPI app, so make sure the service is configured to run:

```bash
uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

You can set this in the Railway service settings under Start Command.

### Step 4: Add the PostgreSQL service

1. In the same Railway project, click Add Service
2. Choose PostgreSQL
3. Railway creates a database and gives you connection details automatically

You must set the app environment variables to the PostgreSQL URL Railway provides.

Example:

```env
DATABASE_URL=postgresql://postgres:xxxxxxxxxxxx@containers-us-west-....railway.app:5432/railway
ADMIN_USERNAME=Admin
ADMIN_PASSWORD=Admin123
JWT_SECRET=some-random-long-secret
```

### Step 5: Add environment variables in Railway

Go to the app service and open Variables.

Set these values:

```env
DATABASE_URL=<Railway Postgres URL>
ADMIN_USERNAME=Admin
ADMIN_PASSWORD=Admin123
JWT_SECRET=<any long random string>
```

> For a student project, `Admin123` is acceptable as the demo credential. In a production-ready system, this would be replaced with a stronger secret management approach.

### Step 6: Deploy

Railway will automatically deploy when you push changes to GitHub.

After deployment, Railway gives you a public URL such as:

```text
https://your-service-name.up.railway.app
```

Use this in the desktop app as the backend URL.

---

## 4. Desktop app configuration

In the desktop app settings, set the cloud backup URL to the Railway app URL.

Example:

```text
https://your-service-name.up.railway.app
```

The desktop app will then call:

```text
POST https://your-service-name.up.railway.app/readings/sync
```

This is exactly the flow used by the outbox sync pattern.

---

## 5. Important notes for deployment

- Railway assigns the app a dynamic public URL, so keep the URL in the desktop settings.
- The backend should not be treated as the primary database; it is the cloud secondary copy only.
- The app is designed for an academic demo and a limited production-like setup, not hardened enterprise security.
- The login credential is intentionally shared and simple for demonstration purposes.

---

## 6. Notes

- The desktop app writes to SQLite locally and syncs to this backend.
- The backend uses an idempotent upsert on `(node_id, timestamp)` to prevent duplicates during retries.
- This is a clean academic implementation, not a production security hardening layer.
