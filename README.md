# Prometheus

Self-hosted multi-tenant AI chat platform with OpenAI-compatible API gateway.
Routes through your own Kiro accounts, multiple external providers, and named
combo chains with auto-fallback. Comes with RTK token compression that saves
20-40% input tokens on tool-heavy requests.

```
┌─────────────────────────────────────────────────────────┐
│                                                          │
│  Web UI: ChatGPT-style with workspaces                  │
│    💬 General · 💻 Coding · 📈 Trading                   │
│                                                          │
│  API Gateway: drop-in OpenAI replacement                │
│    OPENAI_BASE_URL=http://localhost:3000/v1             │
│                                                          │
│  Built-in pool: rotates between your Kiro accounts      │
│  Auto-recovery: revives exhausted accounts daily        │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

## Features

**Multi-tenant chat platform**
- User registration with admin approval flow
- Per-user API keys (SHA-256 hashed at rest)
- Conversation history with workspace separation (General / Coding / Trading)
- Image upload + vision auto-routing (Kiro→OpenRouter/OpenAI on the fly)
- Markdown export per conversation

**Built-in Kiro account pool**
- Add multiple Kiro refresh tokens, auto-rotate between them
- Per-account credit tracking (today/7d/total tokens)
- Auto-recovery: probes exhausted accounts after cooldown (default 6h)
- Live status surfaced in Settings

**Model combos with auto-fallback**
- Ordered chains of `(provider, model)` tried in sequence
- 10 pre-built templates: `coding-premium`, `coding-fast`, `coding-debug`,
  `coding-review`, `trading-realtime`, `trading-research`, `trading-backtest`,
  `research-deep`, `general-balanced`, `general-cheap`
- Custom combos via Settings UI (up to 10 steps)
- Falls through on rate-limit, quota, transient errors; bubbles hard errors

**OpenAI-compatible gateway** (`/v1/chat/completions`)
- Use Prometheus as the base URL in any OpenAI SDK
- Per-API-key rate limiting (configurable via `GATEWAY_RPM`)
- Streaming (SSE) and non-streaming responses
- Token usage tracking + cost estimation

**RTK Token Saver** (built-in)
- Compresses tool output (`git diff`, `grep`, `ls`, repeated logs)
  before sending to LLM
- Saves 20-40% input tokens on requests with tool_result blocks
- Safe-by-default: if compression fails, original is sent unchanged

**Security hardening**
- AES-256-GCM encryption for refresh tokens
- bcrypt password hashing (cost 12)
- CSRF protection via double-submit cookie + HMAC
- Body size limit, CORS lockdown, constant-time login
- Forced password change on first admin login
- 71 unit tests covering crypto, CSRF, rate limit, vision routing

## Quick Start

```bash
# 1. Install
git clone https://github.com/wahyutomo1996-beep/prometheus.git
cd prometheus
npm install

# 2. Configure
cp .env.example .env
# Edit .env — at minimum set JWT_SECRET and ENCRYPTION_KEY:
#   JWT_SECRET=$(openssl rand -hex 32)
#   ENCRYPTION_KEY=$(openssl rand -hex 32)

# 3. Database (SQLite for dev)
npx prisma db push
npx prisma db seed
# ⚠ Save the random admin password printed by the seed!
#   It's shown once. Use it to log in, then change it on first login.

# 4. Run
npm run dev
```

Open http://localhost:3000 and log in with the admin email + the password
the seed printed. You'll be forced to change it before reaching settings.

## Web UI

The chat page has a ChatGPT-style sidebar with three workspace boxes and a
filtered Recent list:

```
┌─────────────────────────────┐
│  [+ New chat]               │
├─────────────────────────────┤
│  💬 General                 │   ← click body = activate workspace
│      general-balanced  ▼    │   ← click chevron = expand combo picker
├─────────────────────────────┤
│  💻 Coding                  │
│      coding-premium    ▼    │
├─────────────────────────────┤
│  📈 Trading                 │
│      trading-realtime  ▼    │
├─────────────────────────────┤
│  Recent · Coding         3  │   ← filtered to active workspace
│   • Bug useEffect race      │
│   • SQL optimization        │
│   • TypeScript helper       │
├─────────────────────────────┤
│  👤 admin                ▲  │   ← click for menu
└─────────────────────────────┘
        ↑ pops up:
        Dashboard · Settings · Admin · Logout
```

Each workspace remembers its combo selection in localStorage. Switching
workspaces filters the Recent list and changes the default model used for
new chats.

## API Gateway

Use Prometheus as a drop-in OpenAI replacement in any client:

**Python (openai SDK):**
```python
from openai import OpenAI
client = OpenAI(
    api_key="pmt-...",                          # from Settings → API Key
    base_url="http://localhost:3000/v1",
)
r = client.chat.completions.create(
    model="kiro/claude-opus-4.7",
    messages=[{"role": "user", "content": "Hello"}],
)
```

**curl:**
```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer pmt-..." \
  -H "Content-Type: application/json" \
  -d '{
    "model": "kiro/claude-opus-4.7",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": true
  }'
```

**Available models** (`GET /v1/models`): 25 Kiro models including Claude
Opus 4.7, Claude Sonnet 4.6, Claude Haiku 4.5, DeepSeek 3.2, GLM-5,
MiniMax M2.5, Qwen3 Coder, and more.

**Disable RTK compression** (per request): set header `X-RTK-Disable: 1`.

## Adding Kiro accounts

Settings → **Kiro Account Pool** → **+ Add Account**

Paste your Kiro refresh token. The pool will auto-rotate between accounts on
each request, refresh tokens before expiry, and mark accounts as exhausted
after rate-limit responses (with auto-recovery after the cooldown period).

To find your existing Kiro refresh token:
- Windows: `%APPDATA%\Kiro\` or `%USERPROFILE%\.aws\sso\cache\`
- macOS: `~/Library/Application Support/Kiro/`
- Linux: `~/.config/Kiro/` or `~/.local/share/Kiro/`

## Adding External Providers

Settings → **External Providers** → **+ Add Manually** → pick a preset:
- WIR Cloud, OpenRouter, OpenAI, Google Gemini, DeepSeek, Groq, Mistral,
  Together AI

Models auto-detect on save. Vision-capable providers are auto-used when
you attach images to a chat that's running on a Kiro-backed model
(silently rerouted with a UI banner).

## Production Deploy

For deploying Prometheus to a server with 100+ users, see
[**PRODUCTION.md**](./PRODUCTION.md) for the full guide:
- Postgres migration (drop-in schema in `prisma/schema.postgres.prisma`)
- nginx reverse proxy + SSE settings
- Cloudflare configuration
- Backup strategy
- Sentry / uptime monitoring
- Pre-launch security checklist

Quick overview:

```bash
# Generate secrets
export JWT_SECRET=$(openssl rand -hex 32)
export ENCRYPTION_KEY=$(openssl rand -hex 32)

# Docker compose ships a ready-to-use stack
docker compose up -d --build
docker compose logs -f prometheus
# Watch the logs for the one-time admin password on first start
```

## Tech Stack

- **Frontend:** Next.js 14 (App Router), React 18, Redux Toolkit + RTK Query
- **Backend:** Next.js API routes, Prisma ORM
- **Database:** SQLite (dev) / Postgres (production via `schema.postgres.prisma`)
- **Auth:** jose (JWT) + bcryptjs + AES-256-GCM
- **Styling:** Tailwind CSS, custom dark theme
- **Tests:** Vitest (71 unit tests, run with `npm test`)
- **Deploy:** Docker + docker-compose (multi-platform image), or PM2 / bare Node

## Project structure

```
src/
├── app/
│   ├── (auth)/              login + register pages
│   ├── (dashboard)/         chat, settings, admin, dashboard pages
│   ├── api/                 internal API routes (auth, providers, combos, ...)
│   └── v1/                  OpenAI-compatible gateway
├── components/              UI primitives + WorkspaceBox + UserPill + ComboPanel
├── lib/
│   ├── store/               RTK store + RTK Query endpoint slices
│   ├── workspaces.ts        workspace definitions (General / Coding / Trading)
│   ├── combo-templates.ts   pre-built combos
│   ├── combo-dispatch.ts    fall-through logic for combos
│   ├── rtk-compression.ts   token saver (RTK)
│   ├── kiro-pool.ts         account pool + auto-recovery
│   ├── kiro-chat.ts         Kiro CodeWhisperer protocol
│   ├── auth.ts              JWT + API key + bcrypt helpers
│   ├── csrf.ts              double-submit token (Web Crypto)
│   └── encryption.ts        AES-256-GCM for refresh tokens
└── middleware.ts            auth + CSRF gates

prisma/
├── schema.prisma            SQLite (default)
├── schema.postgres.prisma   Postgres alternative for production
└── seed.mjs                 admin user creation (random password, mustChangePassword)
```

## Testing

```bash
npm test              # one-shot
npm run test:watch    # TDD mode
npm run test:coverage # with v8 coverage report
```

Critical paths covered: encryption round-trip + tamper detection, API key
gen + hash, CSRF token bind + verify, body size limit + streaming guard,
CORS whitelist matching, rate limit window expiry, vision routing
decisions, combo dispatch fall-through classification, RTK compression
filters with safety guarantees.

## License

MIT — see [LICENSE](./LICENSE).

## Origin

Originally `kirochat`, rebranded to `Prometheus` to reflect its scope as
a full multi-provider AI gateway with workspace-aware chat UI. The Kiro
pool remains the recommended default backend (free unlimited Claude
access via AWS Builder ID OAuth).
