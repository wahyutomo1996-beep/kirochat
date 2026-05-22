# KiroChat - Multi-Provider AI Chat Platform

Self-hosted multi-provider AI chat platform dengan support untuk Kiro (refresh token), OpenAI, OpenRouter, Gemini, dan provider lainnya.

## Features

- Multi-provider support (tambah provider apapun yang OpenAI-compatible)
- Kiro refresh token auto-exchange
- Auto-detect models dari setiap provider
- Image upload & vision/multimodal analysis
- Conversation history & multiple chats
- Export chat ke Markdown
- User registration dengan admin approval
- Admin panel untuk manage users
- Encrypted API key storage (AES-256-GCM)
- Dark mode UI
- Streaming responses

## Quick Start (Development)

```bash
# 1. Install dependencies
npm install

# 2. Setup environment
cp .env.example .env
# Edit .env - ganti JWT_SECRET dan ENCRYPTION_KEY

# 3. Setup database
npx prisma db push
npx prisma db seed

# 4. Run dev server
npm run dev
```

Buka http://localhost:3000

**Default admin login:**
- Email: admin@kirochat.local
- Password: admin123 (GANTI SEGERA!)

## Deploy di Ubuntu Server

### Option 1: Docker (Recommended)

```bash
# Clone/upload project ke server
git clone <repo> /opt/kirochat
cd /opt/kirochat

# Set environment variables
export JWT_SECRET=$(openssl rand -hex 32)
export ENCRYPTION_KEY=$(openssl rand -hex 16)

# Build & run
docker compose up -d

# Setup database
docker compose exec kirochat npx prisma db push
docker compose exec kirochat npx prisma db seed
```

### Option 2: PM2

```bash
# Install Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Install PM2
sudo npm install -g pm2

# Setup project
cd /opt/kirochat
npm install
cp .env.example .env
# Edit .env dengan secret yang kuat

# Build
npx prisma db push
npx prisma db seed
npm run build

# Start with PM2
pm2 start npm --name kirochat -- start
pm2 save
pm2 startup
```

### Nginx Reverse Proxy + SSL

```nginx
server {
    listen 80;
    server_name chat.yourdomain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl;
    server_name chat.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/chat.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/chat.yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
        
        # SSE support
        proxy_buffering off;
        proxy_read_timeout 86400;
    }

    client_max_body_size 10M;
}
```

```bash
# Install certbot
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d chat.yourdomain.com
```

## Menambah Provider

1. Login → Settings → Tambah Provider
2. Pilih preset (OpenRouter, OpenAI, Gemini, dll) atau isi manual
3. Untuk Kiro: pilih type "Kiro Refresh Token", paste refresh token
4. Untuk provider lain: pilih "API Key", isi base URL dan API key
5. Klik "Simpan" → models akan auto-detect

## Tech Stack

- Next.js 14 (App Router)
- Prisma + SQLite
- Tailwind CSS
- jose (JWT)
- AES-256-GCM encryption
