// apps/frontend/app/withdrawals/page.tsx
import { ApiClient } from '../../lib/api-client';

export default async function WithdrawalsPage() {
  const api = new ApiClient(process.env.NEXT_PUBLIC_API_BASE_URL);
  const health = await api.request<{ status: string }>('/health').catch(() => ({ status: 'unavailable' }));
  return <main className="mx-auto max-w-7xl p-6"><h1 className="text-xl font-semibold">Withdrawals</h1><p className="mt-3 text-sm text-muted">Gateway status: {health.status}</p></main>;
}
