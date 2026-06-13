// apps/frontend/app/deposits/page.tsx
import { ControlCard, OperationsTable, PageHeader } from '../../components/exchange-widgets';
import { ExchangeShell } from '../../components/exchange-shell';

export default async function DepositsPage() {
  return (
    <ExchangeShell section="Deposits">
      <PageHeader eyebrow="Funding" title="Deposits" actions={<button className="rounded bg-accent px-3 py-2 text-xs font-bold text-ink">Generate Address</button>} />
      <div className="space-y-4 p-4">
        <div className="grid gap-3 md:grid-cols-3">
          <ControlCard icon="data" title="Detected Today" value="4,812" detail="BTC, ETH, SOL, USDT" tone="positive" />
          <ControlCard icon="clock" title="Awaiting Confirms" value="138" detail="chain watcher queue" />
          <ControlCard icon="check" title="Credited Today" value="$38.6M" detail="wallet events emitted" tone="positive" />
        </div>
        <OperationsTable
          title="Deposit Monitor"
          rows={[
            { user: 'user_7721', asset: 'BTC', network: 'bitcoin', amount: '0.2500', confirmations: '3/3', status: 'Credited' },
            { user: 'user_1120', asset: 'USDT', network: 'ethereum', amount: '12,000.00', confirmations: '9/12', status: 'Watching' },
            { user: 'user_9044', asset: 'SOL', network: 'solana', amount: '420.00', confirmations: '28/32', status: 'Watching' }
          ]}
        />
      </div>
    </ExchangeShell>
  );
}
