'use client';

/**
 * Login page — showcases RTK Query mutation pattern.
 *
 * Pattern: useMutation hook returns a tuple [trigger, state]. Call the
 * trigger with payload, await `.unwrap()` to throw on error (so try/catch
 * works naturally). The state object exposes isLoading / error /
 * isSuccess that we can use directly in JSX without manual useState.
 *
 * After success: invalidate 'Auth' tag (handled by the endpoint definition
 * in authApi) so any component subscribed to useGetMeQuery refetches the
 * fresh user state. Then router.push to /chat.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Alert } from '@/components/Alert';
import { useLoginMutation } from '@/lib/store/api/authApi';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const router = useRouter();

  // Mutation hook returns a stable trigger function + a state object.
  // `isLoading` reflects the in-flight request without manual useState.
  const [login, { isLoading }] = useLoginMutation();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      // .unwrap() converts RTK Query's success/error envelope into a
      // throw-on-error promise so we can use plain try/catch.
      await login({ email, password }).unwrap();
      // The 'Auth' tag invalidation in authApi means any useGetMeQuery
      // subscriber will refetch the fresh session automatically.
      router.push('/chat');
    } catch (err) {
      const data = (err as { data?: { error?: string } })?.data;
      setError(data?.error ?? 'Gagal terhubung ke server');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-0 px-4">
      <div className="w-full max-w-sm animate-fade-in">
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-surface-1 border border-edge mb-4">
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold text-white tracking-tight">Prometheus</h1>
          <p className="text-txt-muted text-sm mt-2">Sign in to your account</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <Alert type="error">{error}</Alert>}

          <Input
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
          />

          <Input
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
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
