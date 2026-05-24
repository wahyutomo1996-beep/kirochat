# Production Deployment Guide

This document walks through deploying Prometheus to production for 100+ users.

## Architecture target

```
                    ┌──────────────────┐
   Internet  ─────► │ Cloudflare       │  TLS, DDoS, WAF, edge cache (free)
                    └──────┬───────────┘
                           │
                  ┌────────▼─────────┐
                  │ Reverse proxy    │  nginx / Caddy / Traefik
                  │ + TLS terminator │
                  └────────┬─────────┘
                           │
                  ┌────────▼─────────┐
                  │ Prometheus app   │  Stateless, horizontally scalable
                  │ (Node.js × N)    │
                  └────┬───────┬─────┘
                       │       │
        ┌──────────────▼──┐  ┌─▼───────────────┐
        │ Postgres         │  │ Redis (optional) │
        │ (managed)        │  │ rate limit cache │
        │ + auto-backup    │  │ session blocklist│
        └──────────────────┘  └──────────────────┘
```

## Prerequisites

- Domain with DNS pointed at your server (or Cloudflare)
- Postgres database (Neon free, Render $7, Supabase free)
- Server: 2 GB RAM minimum, 4 GB recommended
- Docker & docker-compose installed

## Step 1 — Generate secrets

Generate long random secrets. **Never reuse these across environments.**

```bash
# 32-byte hex - used for both JWT_SECRET and ENCRYPTION_KEY
openssl rand -hex 32

# Run twice; use one value per env var
```

The app **refuses to start** in production without these env vars set.
There is no fallback (security guarantee).

## Step 2 — Migrate to Postgres

SQLite is fine for 1-30 users. Beyond that, you'll see lock contention.
Migration is straightforward:

```bash
# 1. Provision Postgres (any of these works)
#    - Neon: https://neon.tech (free tier 0.5 GB)
#    - Render: https://render.com ($7/mo)
#    - Supabase: https://supabase.com (free tier)
#    - Self-host: docker run postgres:16

# 2. Update .env
DATABASE_URL="postgresql://user:pass@host:5432/prometheus?sslmode=require"

# 3. Swap the schema (we ship both)
mv prisma/schema.prisma prisma/schema.sqlite.prisma
cp prisma/schema.postgres.prisma prisma/schema.prisma

# 4. Apply schema and seed
npx prisma db push
npx prisma db seed
```

The seed script prints a one-time admin password to stdout. Save it from
the container logs.

## Step 3 — Configure environment

Copy `.env.example` to `.env` and fill in:

```bash
NODE_ENV=production

# Strong random secrets (32 hex bytes each)
JWT_SECRET=<openssl rand -hex 32>
ENCRYPTION_KEY=<openssl rand -hex 32>

# Postgres
DATABASE_URL=postgresql://...

# RTK Query base URL
# Empty = same-origin (recommended for monolith deploy)
NEXT_PUBLIC_API_BASE_URL=

# Gateway tuning
GATEWAY_RPM=60
GATEWAY_CORS_ORIGINS=               # comma-separated whitelist; empty = no CORS
KIRO_REVIVE_COOLDOWN_HOURS=6

# Disable risky features in multi-user prod
DISABLE_FILESYSTEM_TOKEN_SCAN=1     # prevents token leak across user accounts

# Initial admin (only used on first seed)
ADMIN_EMAIL=admin@example.com
# ADMIN_INITIAL_PASSWORD=          # leave empty to auto-generate (recommended)
```

## Step 4 — Build and run

```bash
docker compose up -d --build
docker compose logs -f prometheus
```

Watch the logs for the **one-time admin password** during first seed.

The app exposes:
- `:3000/login` - web UI
- `:3000/v1/chat/completions` - OpenAI-compatible API
- `:3000/api/health` - public health check (always 200 if healthy)
- `:3000/api/health?detail=1` - admin-only detailed pool stats

## Step 5 — TLS via reverse proxy

Place nginx (or Caddy/Traefik) in front. Example nginx config:

```nginx
server {
    listen 80;
    server_name chat.example.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name chat.example.com;

    ssl_certificate     /etc/letsencrypt/live/chat.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/chat.example.com/privkey.pem;

    # Body size limit (matches our 5MB default — adjust for image uploads)
    client_max_body_size 10M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE / streaming support — required for /v1/chat/completions stream=true
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 86400;
    }
}
```

## Step 6 — Cloudflare in front (recommended)

Route the domain through Cloudflare for free DDoS protection, TLS, and edge
caching. Settings to enable:

- **SSL/TLS mode**: Full (strict)
- **Security Level**: Medium
- **Bot Fight Mode**: On
- **WAF Managed Rules**: enable OWASP Core Rule Set
- **Rate Limiting**: 100 req/min per IP on `/api/auth/login`

## Step 7 — Backups

For Postgres on managed providers (Neon/Render/Supabase), automatic daily
backups are included. Verify retention.

For self-hosted Postgres, set up `pg_dump` cron + S3 upload:

```bash
0 3 * * * pg_dump $DATABASE_URL | gzip | aws s3 cp - s3://backups/prometheus/$(date +\%Y\%m\%d).sql.gz
```

## Step 8 — Monitoring

Minimum viable observability:

1. **Sentry** for error tracking. Free tier: 5K events/month.
   Add `@sentry/nextjs` and set `SENTRY_DSN` env var.

2. **Uptime monitor** on `/api/health`:
   - UptimeRobot (free, 5-min interval)
   - BetterStack (free tier 10 monitors)

3. **Log aggregation** (optional, useful at scale):
   - Loki + Grafana Cloud (free tier)
   - BetterStack Logs

## Security checklist

Before going public, verify:

- [ ] `JWT_SECRET` and `ENCRYPTION_KEY` are unique random hex (32 bytes each)
- [ ] `NODE_ENV=production` (enables strict secret validation, secure cookies)
- [ ] Postgres SSL is enforced (`?sslmode=require`)
- [ ] Cloudflare or reverse proxy in front (no direct exposure)
- [ ] `DISABLE_FILESYSTEM_TOKEN_SCAN=1` (prevents server-token leak)
- [ ] Default admin password changed (forced by `mustChangePassword=true`)
- [ ] Backups configured and tested
- [ ] Sentry/uptime monitor live
- [ ] `GATEWAY_CORS_ORIGINS` set to specific origins (or empty for no CORS)

## Scaling further

For 1000+ concurrent users:

- Move rate limiter to Redis (Upstash free tier 10K cmd/day, then $10/mo)
- Run 2-3 app replicas behind a load balancer
- Use connection pooler (PgBouncer) in front of Postgres
- Enable Cloudflare Argo Smart Routing
- Consider read replicas for the dashboard endpoint
