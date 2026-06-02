#!/bin/sh
set -eu

# Idempotently create the tasks-api database and user.
# This script runs in a one-off container after Postgres is healthy,
# so it works on first start and every subsequent restart.

: "${POSTGRES_USER:?}"
: "${POSTGRES_DB:?}"
: "${POSTGRES_PASSWORD:?}"
: "${TASKS_DB_NAME:?}"
: "${TASKS_DB_USER:?}"
: "${TASKS_DB_PASSWORD:?}"

export PGPASSWORD="${POSTGRES_PASSWORD}"

# Wait for Postgres to accept connections
for i in $(seq 1 30); do
  if pg_isready -h postgres -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

psql \
  -v ON_ERROR_STOP=1 \
  -v tasks_db="${TASKS_DB_NAME}" \
  -v tasks_user="${TASKS_DB_USER}" \
  -v tasks_password="${TASKS_DB_PASSWORD}" \
  --username "${POSTGRES_USER}" \
  --dbname "${POSTGRES_DB}" \
  --host postgres <<-'EOSQL'
  SELECT format('CREATE ROLE %I WITH LOGIN PASSWORD %L', :'tasks_user', :'tasks_password')
  WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'tasks_user')\gexec

  SELECT format('CREATE DATABASE %I WITH OWNER %I', :'tasks_db', :'tasks_user')
  WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'tasks_db')\gexec

  \connect :"tasks_db"
  GRANT ALL PRIVILEGES ON SCHEMA public TO :"tasks_user";
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO :"tasks_user";
EOSQL

echo "tasks-api database and user ready"
