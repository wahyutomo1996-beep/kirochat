import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import Link from 'next/link';

export default function Home() {
  // If already logged in, redirect to chat
  const cookieStore = cookies();
  const token = cookieStore.get('token');
  if (token) redirect('/chat');

  return (
    <div className="min-h-screen bg-surface-0 flex flex-col">
      {/* Nav */}
      <nav className="flex items-center justify-between px-6 py-4 border-b border-edge">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center">
            <svg className="w-4 h-4 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
            </svg>
          </div>
          <span className="text-white font-semibold text-lg tracking-tight">KiroChat</span>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/login" className="text-sm text-txt-secondary hover:text-white transition-colors px-3 py-1.5">
            Sign in
          </Link>
          <Link href="/register" className="text-sm bg-white text-black font-medium px-4 py-1.5 rounded-lg hover:bg-gray-200 transition-colors">
            Get Started
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <main className="flex-1 flex items-center justify-center px-6">
        <div className="max-w-3xl w-full text-center py-20">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-surface-1 border border-edge rounded-full text-xs text-txt-muted mb-6">
            <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse"></span>
            Self-hosted · Your keys · Your data
          </div>

          <h1 className="text-5xl md:text-6xl font-bold text-white tracking-tight leading-tight mb-6">
            AI Chat with<br />
            <span className="bg-gradient-to-r from-white via-gray-300 to-gray-500 bg-clip-text text-transparent">
              Your Own API Keys
            </span>
          </h1>

          <p className="text-lg text-txt-muted max-w-xl mx-auto mb-10 leading-relaxed">
            Multi-provider AI chat platform. Bring your Kiro token, OpenAI, OpenRouter, Gemini, DeepSeek — semua dalam satu interface. Auto-detect token, usage tracking, zero vendor lock-in.
          </p>

          <div className="flex items-center justify-center gap-3 mb-16">
            <Link href="/register" className="inline-flex items-center gap-2 bg-white text-black font-medium px-6 py-3 rounded-xl hover:bg-gray-200 transition-all text-sm">
              Create Account
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>
            </Link>
            <Link href="/login" className="inline-flex items-center gap-2 border border-edge text-white font-medium px-6 py-3 rounded-xl hover:bg-surface-1 hover:border-edge-hover transition-all text-sm">
              Sign in
            </Link>
          </div>

          {/* Features */}
          <div className="grid md:grid-cols-3 gap-4 text-left">
            <FeatureCard
              icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />}
              title="Bring Your Own Key"
              desc="Kiro refresh token, OpenAI, OpenRouter, Gemini, DeepSeek, Groq, Mistral — semua provider yang OpenAI-compatible"
            />
            <FeatureCard
              icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />}
              title="Usage Dashboard"
              desc="Track tokens, cost estimation, latency per model. Breakdown per provider dan timeline chart"
            />
            <FeatureCard
              icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />}
              title="Auto-detect Token"
              desc="Scan server filesystem atau upload file — otomatis detect Kiro/AWS SSO token, validate, dan save"
            />
          </div>
        </div>
      </main>

      {/* Install section */}
      <section className="border-t border-edge px-6 py-16">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl font-bold text-white mb-2 text-center">Quick Install</h2>
          <p className="text-txt-muted text-sm text-center mb-8">Ubuntu/Debian server — 5 menit setup</p>

          <div className="bg-surface-1 border border-edge rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-edge flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-red-500/60"></div>
              <div className="w-3 h-3 rounded-full bg-yellow-500/60"></div>
              <div className="w-3 h-3 rounded-full bg-green-500/60"></div>
              <span className="text-xs text-txt-muted ml-2 font-mono">terminal</span>
            </div>
            <pre className="p-5 text-sm font-mono text-txt-secondary overflow-x-auto leading-relaxed"><code>{`# Install Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs git

# Clone & setup
git clone https://github.com/wahyutomo1996-beep/kirochat.git /opt/kirochat
cd /opt/kirochat
npm install

# Configure
cp .env.example .env
sed -i "s/change-this-to-a-random-secret-in-production/$(openssl rand -hex 32)/" .env
sed -i "s/change-this-32-char-key-for-prod!/$(openssl rand -hex 16)/" .env

# Database & build
npx prisma db push
npx prisma db seed
npm run build

# Run (background with PM2)
sudo npm i -g pm2
pm2 start npm --name kirochat -- start
pm2 save && pm2 startup`}</code></pre>
          </div>

          <div className="mt-6 grid md:grid-cols-2 gap-3">
            <div className="bg-surface-1 border border-edge rounded-lg p-4">
              <p className="text-xs text-txt-muted uppercase tracking-wider font-semibold mb-1">Default Login</p>
              <p className="text-sm text-white font-mono">admin@kirochat.local</p>
              <p className="text-sm text-txt-secondary font-mono">admin123</p>
            </div>
            <div className="bg-surface-1 border border-edge rounded-lg p-4">
              <p className="text-xs text-txt-muted uppercase tracking-wider font-semibold mb-1">Access</p>
              <p className="text-sm text-white font-mono">http://your-server-ip:3000</p>
              <p className="text-xs text-txt-faint mt-1">Add Nginx + Certbot for HTTPS</p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-edge px-6 py-6">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <p className="text-xs text-txt-muted">KiroChat — Self-hosted AI Chat</p>
          <div className="flex items-center gap-4">
            <a href="https://github.com/wahyutomo1996-beep/kirochat" target="_blank" rel="noopener" className="text-xs text-txt-muted hover:text-white transition-colors">GitHub</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="bg-surface-1 border border-edge rounded-xl p-5 hover:border-edge-hover transition-colors">
      <div className="w-9 h-9 rounded-lg bg-surface-2 border border-edge flex items-center justify-center mb-3">
        <svg className="w-4.5 h-4.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">{icon}</svg>
      </div>
      <h3 className="text-sm font-semibold text-white mb-1">{title}</h3>
      <p className="text-xs text-txt-muted leading-relaxed">{desc}</p>
    </div>
  );
}
