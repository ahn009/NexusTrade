// apps/frontend/app/trading/page.tsx
import { Depth, MarketTable, MetricStrip, OrderBook, OrderTicket, PageHeader, RecentTrades, Ticker, TradingChart } from '../../components/exchange-widgets';
import { ExchangeShell } from '../../components/exchange-shell';
import { ApiClient } from '../../lib/api-client';

export default async function TradingPage() {
  const api = new ApiClient(process.env.NEXT_PUBLIC_API_BASE_URL);
  const depth = await api.request<Depth>('/depth?symbol=BTCUSDT').catch(() => ({ bids: [], asks: [] }));
  const ticker = await api.request<Ticker>('/ticker/24hr?symbol=BTC-USDT').catch(() => ({ symbol: 'BTC-USDT', lastPrice: '63,590.00', volume: '18.2B', priceChangePercent: '+1.24%' }));
  return (
    <ExchangeShell section="Trading">
      <PageHeader
        eyebrow="Advanced Spot"
        title="Trading"
        actions={
          <>
            <button className="rounded border border-line bg-panel px-3 py-2 text-xs font-semibold text-muted">BTC-USDT</button>
            <button className="rounded border border-line bg-panel px-3 py-2 text-xs font-semibold text-muted">Cross 3x</button>
            <button className="rounded bg-accent px-3 py-2 text-xs font-bold text-ink">Deposit USDT</button>
          </>
        }
      />
      <MetricStrip ticker={ticker} />
      <div className="grid gap-3 p-3 xl:grid-cols-[280px_minmax(520px,1fr)_330px]">
        <div className="space-y-3">
          <MarketTable />
          <OrderBook depth={depth} />
        </div>
        <div className="space-y-3">
          <TradingChart />
          <RecentTrades />
        </div>
        <div className="space-y-3">
          <OrderTicket />
          <div className="rounded-md border border-line bg-panel p-3">
            <div className="text-sm font-semibold">Open Orders</div>
            <div className="mt-6 grid place-items-center rounded bg-soft py-10 text-center text-xs text-muted">
              <span>No active BTC-USDT orders</span>
            </div>
          </div>
        </div>
      </div>
    </ExchangeShell>
  );
}
