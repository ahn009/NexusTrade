'use client';

// apps/frontend/app/register/page.tsx
import { FormEvent, useState } from 'react';
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
    <main className="mx-auto flex min-h-screen max-w-md items-center px-6">
      <form onSubmit={submit} className="w-full space-y-4 rounded-md border border-line bg-white p-6">
        <h1 className="text-xl font-semibold">Register</h1>
        <input name="email" type="email" required placeholder="Email" className="w-full rounded border border-line px-3 py-2" />
        <input name="password" type="password" required minLength={12} placeholder="Password" className="w-full rounded border border-line px-3 py-2" />
        {message ? <p className="text-sm text-accent">{message}</p> : null}
        <button className="w-full rounded bg-accent px-3 py-2 text-white">Create account</button>
      </form>
    </main>
  );
}
