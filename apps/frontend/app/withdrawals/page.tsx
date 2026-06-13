// apps/frontend/app/withdrawals/page.tsx
import { ControlCard, OperationsTable, PageHeader } from '../../components/exchange-widgets';
import { ExchangeShell } from '../../components/exchange-shell';

export default async function WithdrawalsPage() {
  return (
    <ExchangeShell section="Withdrawals">
      <PageHeader eyebrow="Funding" title="Withdrawals" actions={<button className="rounded bg-accent px-3 py-2 text-xs font-bold text-ink">Approve Queue</button>} />
      <div className="space-y-4 p-4">
        <div className="grid gap-3 md:grid-cols-4">
          <ControlCard icon="clock" title="Pending" value="18" detail="tier approval" />
          <ControlCard icon="risk" title="KYT Holds" value="5" detail="compliance review" tone="danger" />
          <ControlCard icon="lock" title="Locked Funds" value="$842K" detail="awaiting approval" />
          <ControlCard icon="check" title="Auto Approved" value="96.2%" detail="under threshold" tone="positive" />
        </div>
        <OperationsTable
          title="Withdrawal Queue"
          rows={[
            { user: 'user_8910', asset: 'ETH', amount: '3.0000', tier: 'AUTO', status: 'Broadcast pending' },
            { user: 'user_1841', asset: 'USDT', amount: '25,000.00', tier: 'OPERATOR', status: 'Needs approval' },
            { user: 'user_3902', asset: 'BTC', amount: '18.0000', tier: 'COLD_CEREMONY', status: 'Ceremony required' }
          ]}
        />
      </div>
    </ExchangeShell>
  );
}
