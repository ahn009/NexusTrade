// apps/frontend/app/wallets/page.tsx
import { ApiClient } from '../../lib/api-client';

export default async function WalletsPage() {
  const api = new ApiClient(process.env.NEXT_PUBLIC_API_BASE_URL);
  const account = await api.request<unknown>('/account?userId=demo-user').catch(() => null);
  return <main className="mx-auto max-w-7xl p-6"><h1 className="text-xl font-semibold">Wallets</h1><pre className="mt-3 overflow-auto rounded-md border border-line bg-white p-4 text-xs">{JSON.stringify(account, null, 2)}</pre></main>;
}
