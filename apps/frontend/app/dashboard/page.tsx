// apps/frontend/app/dashboard/page.tsx
import { ControlCard, MarketTable, MetricStrip, OperationsTable, PageHeader, Ticker, TradingChart, WalletOverview } from '../../components/exchange-widgets';
import { ExchangeShell } from '../../components/exchange-shell';
import { ApiClient } from '../../lib/api-client';

export default async function DashboardPage() {
  const api = new ApiClient(process.env.NEXT_PUBLIC_API_BASE_URL);
  const health = await api.request<{ status: string; service: string }>('/health').catch(() => ({ status: 'unavailable', service: 'api-gateway' }));
  const ticker = await api.request<Ticker>('/ticker/24hr?symbol=BTC-USDT').catch(() => ({ symbol: 'BTC-USDT', lastPrice: '63,590.00', volume: '18.2B', priceChangePercent: '+1.24%' }));
  return (
    <ExchangeShell section="Dashboard">
      <PageHeader
        eyebrow="Spot Exchange"
        title="Dashboard"
        actions={
          <>
            <span className="rounded border border-line bg-panel px-3 py-2 text-xs font-semibold text-muted">Gateway: {health.status}</span>
            <span className="rounded bg-accent px-3 py-2 text-xs font-bold text-ink">Launch Trading</span>
          </>
        }
      />
      <MetricStrip ticker={ticker} />
      <div className="grid gap-4 p-4 xl:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <ControlCard icon="wallet" title="Custody Value" value="$611.4M" detail="hot/warm/cold policy tracked" tone="positive" />
            <ControlCard icon="lock" title="Locked Balances" value="$2.8M" detail="orders and withdrawals" />
            <ControlCard icon="risk" title="Risk Alerts" value="3" detail="margin and AML review" tone="danger" />
            <ControlCard icon="data" title="Events Today" value="1.28M" detail="Kafka streams healthy" tone="positive" />
          </div>
          <TradingChart />
          <OperationsTable
            title="Operations Queue"
            rows={[
              { queue: 'KYC Reviews', count: '24', oldest: '18m', status: 'Operator review' },
              { queue: 'Withdrawals', count: '8', oldest: '7m', status: 'Tiered approval' },
              { queue: 'Risk Cases', count: '3', oldest: '4m', status: 'Escalated' },
              { queue: 'Compliance Hits', count: '5', oldest: '22m', status: 'Screening' }
            ]}
          />
        </div>
        <div className="space-y-4">
          <MarketTable />
          <WalletOverview />
        </div>
      </div>
    </ExchangeShell>
  );
}
