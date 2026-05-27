import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { BrandLogo } from '@/components/BrandLogo';

/**
 * Marketing landing page.
 *
 * Shown only to anonymous visitors — logged-in users redirect straight
 * to /chat. Production-clean: no credentials, no install snippets,
 * no admin hints. Pure value-prop + sign-in CTAs.
 */
export default function Home() {
  const cookieStore = cookies();
  const token = cookieStore.get('token');
  if (token) redirect('/chat');

  return (
    <div className="min-h-screen flex flex-col">
      <nav className="flex items-center justify-between px-6 py-4 border-b border-hairline bg-canvas sticky top-0 z-10">
        <div className="flex items-center gap-2.5">
          <BrandLogo size={32} />
          <span className="text-ink font-semibold text-lg tracking-tight">Prometheus</span>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/login" className="text-sm text-ink-muted hover:text-ink transition-colors px-3 py-1.5">
            Sign in
          </Link>
          <Link
            href="/register"
            className="text-sm bg-accent hover:bg-accent-hover text-white font-medium px-3.5 py-1.5 rounded-lg transition-colors"
          >
            Get Started
          </Link>
        </div>
      </nav>

      <main className="flex-1 flex items-center justify-center px-6">
        <div className="max-w-3xl w-full text-center py-20">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-surface-1 border border-hairline rounded-full text-xs text-ink-subtle mb-6">
            <span className="w-1.5 h-1.5 bg-success rounded-full animate-pulse"></span>
            One workspace for chat, code, and trading
          </div>

          <h1 className="text-5xl md:text-6xl font-semibold text-ink tracking-display-md leading-tight mb-6">
            AI that adapts to<br />
            <span className="text-ink-muted">
              what you&apos;re doing
            </span>
          </h1>

          <p className="typo-body-lg text-ink-muted max-w-xl mx-auto mb-10 leading-relaxed">
            Workspace-aware AI chat with auto-fallback combos, RTK token compression, and side panels
            tailored for engineering and market analysis. Bring your own keys — your data stays yours.
          </p>

          <div className="flex items-center justify-center gap-3 mb-16">
            <Link
              href="/register"
              className="inline-flex items-center gap-2 bg-accent hover:bg-accent-hover text-white font-medium px-6 py-3 rounded-xl hover-lift text-sm shadow-accent transition-all"
            >
              Create Account
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center gap-2 bg-surface-1 border border-hairline text-ink font-medium px-6 py-3 rounded-xl hover:bg-surface-2 hover:border-hairline-strong hover-lift text-sm transition-all"
            >
              Sign in
            </Link>
          </div>

          <div className="grid md:grid-cols-3 gap-3 text-left">
            <FeatureCard
              gradient="rgba(99, 102, 241, 0.2)"
              border="rgba(99, 102, 241, 0.3)"
              text="rgb(165, 180, 252)"
              icon={
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.86 9.86 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                />
              }
              title="Smart workspaces"
              desc="General, Coding, and Trading modes — each with its own layout, system prompt, and fallback chain."
            />
            <FeatureCard
              gradient="rgba(16, 185, 129, 0.2)"
              border="rgba(16, 185, 129, 0.3)"
              text="rgb(52, 211, 153)"
              icon={
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
                />
              }
              title="Engineered for code"
              desc="Code artifacts panel, syntax highlighting, copy-ready blocks. Auto-fallback when an account is rate-limited."
            />
            <FeatureCard
              gradient="rgba(245, 158, 11, 0.2)"
              border="rgba(245, 158, 11, 0.3)"
              text="rgb(252, 211, 77)"
              icon={
                <>
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M3 13l4-4 4 4 8-8"
                  />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14 5h5v5" />
                </>
              }
              title="Built for traders"
              desc="Live TradingView chart embed, position calculator, and ticker auto-detection from chat — side-by-side with the AI."
            />
          </div>
        </div>
      </main>

      <footer className="border-t border-edge/60 px-6 py-6">
        <div className="max-w-3xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
          <p className="text-xs text-txt-muted">
            Prometheus — Self-hosted AI chat &amp; API gateway
          </p>
          <div className="flex items-center gap-4">
            <Link href="/login" className="text-xs text-txt-muted hover:text-white transition-colors">
              Sign in
            </Link>
            <Link href="/register" className="text-xs text-txt-muted hover:text-white transition-colors">
              Register
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  desc,
  gradient,
  border,
  text,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  gradient: string;
  border: string;
  text: string;
}) {
  return (
    <div className="bg-surface-1 border border-hairline rounded-xl p-6 hover-lift hover:border-hairline-strong transition-all">
      <div
        className="w-9 h-9 rounded-lg flex items-center justify-center mb-3"
        style={{ background: gradient, border: `1px solid ${border}` }}
      >
        <svg className="w-4 h-4" fill="none" stroke={text} viewBox="0 0 24 24">
          {icon}
        </svg>
      </div>
      <h3 className="text-sm font-semibold text-ink mb-1">{title}</h3>
      <p className="text-xs text-ink-subtle leading-relaxed">{desc}</p>
    </div>
  );
}
