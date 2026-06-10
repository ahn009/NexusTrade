// apps/frontend/app/settings/page.tsx
import { ApiClient } from '../../lib/api-client';

export default async function SettingsPage() {
  const api = new ApiClient(process.env.NEXT_PUBLIC_API_BASE_URL);
  const exchangeInfo = await api.request<{ symbols?: string[] }>('/exchangeInfo').catch(() => ({ symbols: [] }));
  return <main className="mx-auto max-w-7xl p-6"><h1 className="text-xl font-semibold">Settings</h1><p className="mt-3 text-sm text-muted">Configured symbols: {(exchangeInfo.symbols ?? []).join(', ') || 'none'}</p></main>;
}
