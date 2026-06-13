// apps/frontend/app/wallets/page.tsx
import { ControlCard, OperationsTable, PageHeader, WalletOverview } from '../../components/exchange-widgets';
import { ExchangeShell } from '../../components/exchange-shell';

export default async function WalletsPage() {
  return (
    <ExchangeShell section="Wallets">
      <PageHeader eyebrow="Custody" title="Wallets" actions={<button className="rounded bg-accent px-3 py-2 text-xs font-bold text-ink">Internal Transfer</button>} />
      <div className="space-y-4 p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <ControlCard icon="wallet" title="Total Assets" value="$611.4M" detail="all user wallets" tone="positive" />
          <ControlCard icon="lock" title="Locked" value="$2.8M" detail="orders + withdrawals" />
          <ControlCard icon="check" title="Settlement" value="99.99%" detail="trade ledger success" tone="positive" />
          <ControlCard icon="clock" title="Pending Sweeps" value="12" detail="hot to warm review" />
        </div>
        <WalletOverview />
        <OperationsTable
          title="Ledger Activity"
          rows={[
            { time: '12:41:09', user: 'user_1482', asset: 'USDT', type: 'TradeSettlement', amount: '-1,589.75', status: 'Confirmed' },
            { time: '12:39:44', user: 'user_7721', asset: 'BTC', type: 'Deposit', amount: '+0.2500', status: 'Confirmed' },
            { time: '12:36:22', user: 'user_8910', asset: 'ETH', type: 'Withdrawal', amount: '-3.0000', status: 'Tier approval' }
          ]}
        />
      </div>
    </ExchangeShell>
  );
}
