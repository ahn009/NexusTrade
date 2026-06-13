// apps/frontend/app/risk/page.tsx
import { ControlCard, OperationsTable, PageHeader } from '../../components/exchange-widgets';
import { ExchangeShell } from '../../components/exchange-shell';

export default async function RiskPage() {
  return (
    <ExchangeShell section="Risk">
      <PageHeader eyebrow="Controls" title="Risk" actions={<button className="rounded bg-accent px-3 py-2 text-xs font-bold text-ink">Run Evaluation</button>} />
      <div className="space-y-4 p-4">
        <div className="grid gap-3 md:grid-cols-4">
          <ControlCard icon="risk" title="Margin Alerts" value="11" detail="notional/equity breach" tone="danger" />
          <ControlCard icon="wallet" title="Insurance Fund" value="$25.0M" detail="configured reserve" tone="positive" />
          <ControlCard icon="data" title="Positions Watched" value="18,420" detail="trade stream consumer" />
          <ControlCard icon="clock" title="Liquidations" value="2" detail="last 24h" tone="danger" />
        </div>
        <OperationsTable
          title="Exposure Cases"
          rows={[
            { account: 'margin_9102', symbol: 'BTC-USDT', leverage: '5x', equity: '$18,200', status: 'Margin call' },
            { account: 'margin_4401', symbol: 'ETH-USDT', leverage: '3x', equity: '$8,940', status: 'Watch' },
            { account: 'futures_1184', symbol: 'SOL-USDT', leverage: '10x', equity: '$2,120', status: 'Liquidation queued' }
          ]}
        />
      </div>
    </ExchangeShell>
  );
}
