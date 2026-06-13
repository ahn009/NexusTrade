'use client';

// apps/frontend/app/login/page.tsx
import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { LockKeyhole, ShieldCheck } from 'lucide-react';
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
    <main className="grid min-h-screen bg-app lg:grid-cols-[1fr_440px]">
      <section className="hidden border-r border-line bg-ink p-10 text-white lg:flex lg:flex-col lg:justify-between">
        <Link href="/dashboard" className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded bg-accent text-sm font-black text-ink">N</span>
          <span className="font-semibold">NexusTrade</span>
        </Link>
        <div>
          <div className="max-w-xl text-5xl font-semibold leading-tight">Trade crypto with institutional controls.</div>
          <div className="mt-6 grid max-w-xl grid-cols-3 gap-3 text-sm">
            <div className="rounded border border-white/10 p-4"><div className="text-accent">RBAC</div><div className="mt-2 text-white/70">Admin-safe operations</div></div>
            <div className="rounded border border-white/10 p-4"><div className="text-accent">TOTP</div><div className="mt-2 text-white/70">Verified setup flow</div></div>
            <div className="rounded border border-white/10 p-4"><div className="text-accent">TLS</div><div className="mt-2 text-white/70">Secure transport options</div></div>
          </div>
        </div>
        <p className="text-sm text-white/50">Spot, custody, compliance, and risk in one console.</p>
      </section>
      <section className="flex items-center px-5 py-10">
        <form onSubmit={submit} className="mx-auto w-full max-w-md space-y-4 rounded-md border border-line bg-panel p-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold">Login</h1>
              <p className="mt-1 text-sm text-muted">Access the NexusTrade exchange console.</p>
            </div>
            <div className="grid h-10 w-10 place-items-center rounded bg-soft text-muted"><LockKeyhole size={18} /></div>
          </div>
          <input name="email" type="email" required placeholder="Email" className="w-full rounded border border-line bg-app px-3 py-2 outline-none focus:border-accent" />
          <input name="password" type="password" required minLength={12} placeholder="Password" className="w-full rounded border border-line bg-app px-3 py-2 outline-none focus:border-accent" />
          <input name="totpCode" placeholder="TOTP code" className="w-full rounded border border-line bg-app px-3 py-2 outline-none focus:border-accent" />
          <div className="flex items-center gap-2 rounded bg-soft px-3 py-2 text-xs text-muted">
            <ShieldCheck size={15} className="text-positive" />
            Session tokens rotate and privileged endpoints require role claims.
          </div>
        {error ? <p className="text-sm text-danger">{error}</p> : null}
          <button className="w-full rounded bg-accent px-3 py-2 font-bold text-ink transition-transform active:scale-[0.98]">Sign in</button>
          <p className="text-center text-sm text-muted">New to NexusTrade? <Link href="/register" className="font-semibold text-foreground">Create account</Link></p>
        </form>
      </section>
    </main>
  );
}
