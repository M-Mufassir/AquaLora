FROM node:22-alpine AS frontend-build

WORKDIR /frontend
COPY Web_App/Frontend/package*.json ./
RUN npm ci
COPY Web_App/Frontend/ ./
ARG VITE_API_URL=/api
ENV VITE_API_URL=${VITE_API_URL}
RUN npm run build

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=8080 \
    BACKEND_URL=http://127.0.0.1:8000

RUN apt-get update \
    && apt-get install -y --no-install-recommends nginx supervisor gettext-base \
    && rm -rf /var/lib/apt/lists/* \
    && rm -f /etc/nginx/conf.d/default.conf

WORKDIR /app/backend
COPY Web_App/Backend/requirements.txt .
RUN pip install --upgrade pip && pip install -r requirements.txt
COPY Web_App/Backend/app ./app
COPY Web_App/Backend/scripts ./scripts

COPY --from=frontend-build /frontend/dist /usr/share/nginx/html
COPY Web_App/Frontend/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY deploy/supervisord.conf /etc/supervisor/conf.d/aqualora.conf
COPY deploy/entrypoint.sh /usr/local/bin/aqualora-entrypoint
RUN chmod +x /usr/local/bin/aqualora-entrypoint

EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/aqualora-entrypoint"]
