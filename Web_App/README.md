# AquaLora Web App

The web app contains a FastAPI backend and React/Tailwind admin frontend that run together with Docker Compose.

## Run locally with Docker

```bash
cd Web_App
cp .env.example .env
docker compose up --build
```

Open `http://localhost:5174` and sign in with the `ADMIN_USERNAME` and `ADMIN_PASSWORD` values from `.env`.

The frontend is the public service. Nginx serves the React build and proxies `/api/*` to the private backend service, so browsers never need to resolve the Docker hostname. The backend connects to the `postgres` service using `DATABASE_URL`.

## Railway

Deploy the `Web_App` directory as the service root. The frontend container listens on Railway's `PORT` variable. Add a Railway PostgreSQL database and set `DATABASE_URL` to its connection string. Also set strong values for `ADMIN_PASSWORD`, `JWT_SECRET`, and database credentials.

For a multi-service Railway setup, deploy the `frontend`, `backend`, and PostgreSQL services separately using the same Dockerfiles and set the frontend proxy target to the Railway backend private domain. Docker Compose remains the simplest single-stack deployment for hosts that support Compose.
