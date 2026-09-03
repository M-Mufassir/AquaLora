# AquaLora Web App

The web app contains a FastAPI backend and React/Tailwind admin frontend bundled into one Docker service. PostgreSQL runs as a separate database service.

## Run locally with Docker

```bash
cd Web_App
cp .env.example .env
docker compose up --build
```

Open `http://localhost:5174` and sign in with the `ADMIN_USERNAME` and `ADMIN_PASSWORD` values from `.env`.

The frontend is the public service. Nginx serves the React build and proxies `/api/*` to the private backend service, so browsers never need to resolve the Docker hostname. The backend connects to the `postgres` service using `DATABASE_URL`.

## Railway deployment

Railway can deploy this as one service because the repository root contains a `Dockerfile`. Create one Railway application service from the repository root and add a Railway PostgreSQL database service.

Set the application service **Root Directory** to `/` or leave it empty. Railway will build the React frontend, install the FastAPI backend, and run both behind Nginx. The public service listens on Railway's `PORT` variable.

Set these application variables:

```text
DATABASE_URL=${{Postgres.DATABASE_URL}}
ADMIN_USERNAME=Admin
ADMIN_PASSWORD=replace-with-a-strong-password
JWT_SECRET=replace-with-a-long-random-secret
```

The frontend uses `/api`, and Nginx proxies that path to the local Uvicorn process. No `BACKEND_URL` variable is needed for the combined image.

If Railway reports `Railpack could not determine how to build the app`, make sure the root `Dockerfile` is committed and the service root directory is `/`.

Docker Compose remains available for local or Compose-compatible hosting:

```bash
docker compose up --build
```
