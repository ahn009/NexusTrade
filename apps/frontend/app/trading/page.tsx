// apps/frontend/app/trading/page.tsx
import { ApiClient } from '../../lib/api-client';

export default async function TradingPage() {
  const api = new ApiClient(process.env.NEXT_PUBLIC_API_BASE_URL);
  const depth = await api.request<{ bids?: unknown[]; asks?: unknown[] }>('/depth?symbol=BTCUSDT').catch(() => ({ bids: [], asks: [] }));
  return <main className="mx-auto max-w-7xl p-6"><h1 className="text-xl font-semibold">Trading</h1><p className="mt-3 text-sm text-muted">BTC-USDT depth: {depth.bids?.length ?? 0} bids / {depth.asks?.length ?? 0} asks</p></main>;
}
