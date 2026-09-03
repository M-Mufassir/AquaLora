#!/bin/sh
set -eu

: "${PORT:=8080}"
: "${BACKEND_URL:=http://127.0.0.1:8000}"
export PORT BACKEND_URL

envsubst '${PORT} ${BACKEND_URL}' \
  < /etc/nginx/templates/default.conf.template \
  > /etc/nginx/conf.d/default.conf

exec supervisord -c /etc/supervisor/conf.d/aqualora.conf