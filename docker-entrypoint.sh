#!/bin/sh
set -e

echo "[Prometheus] Running database migrations..."
npx prisma db push --skip-generate 2>/dev/null || true

# First-run seed check: query DB for any admin user instead of relying on a
# flag file. Flag files break across volume migrations and re-seed would
# reset the admin password, which is a security hole.
echo "[Prometheus] Checking admin user..."
ADMIN_EXISTS=$(node -e "
  const { PrismaClient } = require('@prisma/client');
  const p = new PrismaClient();
  p.user.findFirst({ where: { role: 'admin' } }).then(u => {
    console.log(u ? 'yes' : 'no');
    p.\$disconnect();
  }).catch(() => { console.log('no'); p.\$disconnect(); });
" 2>/dev/null || echo "no")

if [ "$ADMIN_EXISTS" != "yes" ]; then
  echo "[Prometheus] No admin found, seeding..."
  node prisma/seed.mjs
else
  echo "[Prometheus] Admin already exists, skipping seed."
fi

echo "[Prometheus] Starting server on port ${PORT:-3000}..."
exec "$@"
