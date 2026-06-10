// apps/frontend/app/dashboard/page.tsx
import { ApiClient } from '../../lib/api-client';

export default async function DashboardPage() {
  const api = new ApiClient(process.env.NEXT_PUBLIC_API_BASE_URL);
  const health = await api.request<{ status: string; service: string }>('/health').catch(() => ({ status: 'unavailable', service: 'api-gateway' }));
  const ticker = await api.request<{ symbol: string; lastPrice: string; volume: string }>('/ticker/24hr?symbol=BTC-USDT').catch(() => ({ symbol: 'BTC-USDT', lastPrice: '0', volume: '0' }));
  return (
    <main className="mx-auto max-w-7xl p-6">
      <h1 className="mb-4 text-xl font-semibold">Dashboard</h1>
      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-md border border-line bg-white p-4">Gateway: {health.status}</section>
        <section className="rounded-md border border-line bg-white p-4">{ticker.symbol}: {ticker.lastPrice} / {ticker.volume}</section>
      </div>
    </main>
  );
}
