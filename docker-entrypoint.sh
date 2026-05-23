#!/bin/sh
set -e

# Run prisma migrations on startup
echo "[Prometheus] Running database migrations..."
npx prisma db push --skip-generate 2>/dev/null || true

# Seed if database is empty (first run)
if [ ! -f /app/data/.seeded ]; then
  echo "[Prometheus] First run detected, seeding database..."
  node prisma/seed.mjs 2>/dev/null || true
  touch /app/data/.seeded
fi

echo "[Prometheus] Starting server on port ${PORT:-3000}..."
exec "$@"
