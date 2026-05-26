import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-surface-0 flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        <p className="text-7xl font-bold text-white mb-2 tracking-tight">404</p>
        <h1 className="text-xl font-semibold text-white mb-2">Page not found</h1>
        <p className="text-txt-muted text-sm mb-6">The page you&apos;re looking for doesn&apos;t exist</p>
        <Link
          href="/chat"
          className="inline-block px-3.5 py-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-lg transition-colors"
        >
          Back to Chat
        </Link>
      </div>
    </div>
  );
}
