// apps/frontend/app/deposits/page.tsx
import { ApiClient } from '../../lib/api-client';

export default async function DepositsPage() {
  const api = new ApiClient(process.env.NEXT_PUBLIC_API_BASE_URL);
  const health = await api.request<{ status: string }>('/health').catch(() => ({ status: 'unavailable' }));
  return <main className="mx-auto max-w-7xl p-6"><h1 className="text-xl font-semibold">Deposits</h1><p className="mt-3 text-sm text-muted">Gateway status: {health.status}</p></main>;
}
