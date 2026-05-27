'use client';

/**
 * Register page — RTK Query mutation pattern with success state.
 *
 * Showcases:
 *   - useRegisterMutation tuple
 *   - .unwrap() for try/catch flow
 *   - Resetting form on success
 *   - Inline success message (account pending approval, no auto-redirect)
 */

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Alert } from '@/components/Alert';
import { BrandLogo } from '@/components/BrandLogo';
import { useRegisterMutation } from '@/lib/store/api/authApi';

export default function RegisterPage() {
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [register, { isLoading }] = useRegisterMutation();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    try {
      const result = await register({ email, username, password }).unwrap();
      setSuccess(result.message);
      setEmail('');
      setUsername('');
      setPassword('');
    } catch (err) {
      const data = (err as { data?: { error?: string } })?.data;
      setError(data?.error ?? 'Gagal terhubung ke server');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-sm animate-fade-in">
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center mb-4">
            <BrandLogo size={56} />
          </div>
          <h1 className="text-2xl font-semibold text-ink tracking-tight">Create Account</h1>
          <p className="text-ink-subtle text-sm mt-2">Request access to Prometheus</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <Alert type="error">{error}</Alert>}
          {success && <Alert type="success">{success}</Alert>}

          <Input
            label="Username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="username"
            required
          />

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
            placeholder="Minimum 6 characters"
            required
            minLength={6}
            hint="Account requires admin approval after registration"
          />

          <Button type="submit" loading={isLoading} className="w-full mt-2">
            Request Access
          </Button>
        </form>

        <div className="mt-8 text-center">
          <span className="text-txt-faint text-sm">Already registered? </span>
          <Link href="/login" className="text-white text-sm font-medium hover:underline underline-offset-2">
            Sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
