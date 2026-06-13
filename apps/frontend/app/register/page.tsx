'use client';

// apps/frontend/app/register/page.tsx
import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { BadgeCheck, ShieldCheck } from 'lucide-react';
import { apiClient } from '../../lib/api-client';

export default function RegisterPage() {
  const [message, setMessage] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const user = await apiClient.request<{ userId: string }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email: form.get('email'), password: form.get('password') })
    });
    setMessage(`Registered ${user.userId}`);
  }

  return (
    <main className="grid min-h-screen bg-app lg:grid-cols-[1fr_440px]">
      <section className="hidden border-r border-line bg-ink p-10 text-white lg:flex lg:flex-col lg:justify-between">
        <Link href="/dashboard" className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded bg-accent text-sm font-black text-ink">N</span>
          <span className="font-semibold">NexusTrade</span>
        </Link>
        <div>
          <div className="max-w-xl text-5xl font-semibold leading-tight">Open an account built for serious crypto markets.</div>
          <p className="mt-5 max-w-lg text-white/65">Create a trading profile, complete KYC, fund your wallet, and access spot markets from the exchange console.</p>
        </div>
        <p className="text-sm text-white/50">Low-fee spot markets, wallet controls, and operational safety.</p>
      </section>
      <section className="flex items-center px-5 py-10">
        <form onSubmit={submit} className="mx-auto w-full max-w-md space-y-4 rounded-md border border-line bg-panel p-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold">Register</h1>
              <p className="mt-1 text-sm text-muted">Create a NexusTrade account.</p>
            </div>
            <div className="grid h-10 w-10 place-items-center rounded bg-soft text-muted"><BadgeCheck size={18} /></div>
          </div>
          <input name="email" type="email" required placeholder="Email" className="w-full rounded border border-line bg-app px-3 py-2 outline-none focus:border-accent" />
          <input name="password" type="password" required minLength={12} placeholder="Password" className="w-full rounded border border-line bg-app px-3 py-2 outline-none focus:border-accent" />
          <div className="flex items-center gap-2 rounded bg-soft px-3 py-2 text-xs text-muted">
            <ShieldCheck size={15} className="text-positive" />
            Use 12+ characters with upper/lowercase, number, and symbol.
          </div>
        {message ? <p className="text-sm text-accent">{message}</p> : null}
          <button className="w-full rounded bg-accent px-3 py-2 font-bold text-ink transition-transform active:scale-[0.98]">Create account</button>
          <p className="text-center text-sm text-muted">Already registered? <Link href="/login" className="font-semibold text-foreground">Sign in</Link></p>
        </form>
      </section>
    </main>
  );
}
