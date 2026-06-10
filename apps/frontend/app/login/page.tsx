'use client';

// apps/frontend/app/login/page.tsx
import { FormEvent, useState } from 'react';
import { apiClient } from '../../lib/api-client';

export default function LoginPage() {
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const session = await apiClient.request<{ accessToken: string; refreshToken: string; sessionId: string }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: form.get('email'), password: form.get('password'), totpCode: form.get('totpCode') || undefined })
      });
      localStorage.setItem('accessToken', session.accessToken);
      localStorage.setItem('refreshToken', session.refreshToken);
      window.location.href = '/dashboard';
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md items-center px-6">
      <form onSubmit={submit} className="w-full space-y-4 rounded-md border border-line bg-white p-6">
        <h1 className="text-xl font-semibold">Login</h1>
        <input name="email" type="email" required placeholder="Email" className="w-full rounded border border-line px-3 py-2" />
        <input name="password" type="password" required minLength={12} placeholder="Password" className="w-full rounded border border-line px-3 py-2" />
        <input name="totpCode" placeholder="TOTP code" className="w-full rounded border border-line px-3 py-2" />
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        <button className="w-full rounded bg-accent px-3 py-2 text-white">Sign in</button>
      </form>
    </main>
  );
}
