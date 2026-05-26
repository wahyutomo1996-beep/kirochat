'use client';

/**
 * Login page.
 *
 * Accepts either email or username — the backend resolves both via an
 * OR clause on the same lookup. We keep one input field labeled
 * "Email or username" so the user does not have to choose.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Alert } from '@/components/Alert';
import { useLoginMutation } from '@/lib/store/api/authApi';

export default function LoginPage() {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const router = useRouter();

  const [login, { isLoading }] = useLoginMutation();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await login({ identifier, password }).unwrap();
      router.push('/chat');
    } catch (err) {
      const data = (err as { data?: { error?: string } })?.data;
      setError(data?.error ?? 'Gagal terhubung ke server');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm animate-fade-in">
        <div className="text-center mb-10">
          <div
            className="inline-flex items-center justify-center w-12 h-12 rounded-xl mb-4"
            style={{
              background: 'linear-gradient(135deg, rgba(var(--ws-active-glow) / 0.7), rgba(var(--ws-active-glow) / 0.3))',
              boxShadow: '0 4px 16px -4px rgba(var(--ws-active-glow) / 0.5)',
            }}
          >
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold text-white tracking-tight">Prometheus</h1>
          <p className="text-txt-muted text-sm mt-2">Sign in to your account</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <Alert type="error">{error}</Alert>}

          <Input
            label="Email or username"
            type="text"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            placeholder="you@example.com or username"
            autoComplete="username"
            required
          />

          <Input
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="current-password"
            required
          />

          <Button type="submit" loading={isLoading} className="w-full mt-2">
            Sign in
          </Button>
        </form>

        <div className="mt-8 text-center">
          <span className="text-txt-faint text-sm">No account? </span>
          <Link href="/register" className="text-white text-sm font-medium hover:underline underline-offset-2">
            Create one
          </Link>
        </div>
      </div>
    </div>
  );
}
