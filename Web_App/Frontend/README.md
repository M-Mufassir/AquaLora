# AquaLora Admin Web App

React + TypeScript + Tailwind CSS control room for AquaLora super administrators.

## Run locally

Start the backend first from the repository root:

```bash
uvicorn Web_App.Backend.app.main:app --reload --host 0.0.0.0 --port 8000
```

Then start the frontend:

```bash
cd Web_App/Frontend
npm install
npm run dev
```

The frontend defaults to `http://localhost:8000` for the API. Override it with:

```bash
VITE_API_URL=http://localhost:8000 npm run dev
```

Sign in with the seeded super-admin master node configured by the backend environment settings. The admin console includes facility provisioning and status controls, global telemetry history, and global alert history.
