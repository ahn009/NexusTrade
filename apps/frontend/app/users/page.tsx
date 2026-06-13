// apps/frontend/app/users/page.tsx
import { ControlCard, OperationsTable, PageHeader } from '../../components/exchange-widgets';
import { ExchangeShell } from '../../components/exchange-shell';

export default async function UsersPage() {
  return (
    <ExchangeShell section="Users">
      <PageHeader eyebrow="Identity" title="Users" actions={<button className="rounded bg-accent px-3 py-2 text-xs font-bold text-ink">Review KYC</button>} />
      <div className="space-y-4 p-4">
        <div className="grid gap-3 md:grid-cols-4">
          <ControlCard icon="check" title="Active Users" value="321.2M" detail="registered accounts" tone="positive" />
          <ControlCard icon="clock" title="KYC Pending" value="24" detail="operator queue" />
          <ControlCard icon="lock" title="2FA Enabled" value="87.4%" detail="TOTP/passkey coverage" tone="positive" />
          <ControlCard icon="risk" title="Frozen" value="41" detail="risk or compliance hold" tone="danger" />
        </div>
        <OperationsTable
          title="User Review"
          rows={[
            { user: 'user_1482', email: 'trader1482@example.com', tier: 'VIP 1', kyc: 'Approved', status: 'Active' },
            { user: 'user_4420', email: 'kyc4420@example.com', tier: 'Retail', kyc: 'Pending', status: 'Active' },
            { user: 'user_7001', email: 'case7001@example.com', tier: 'Retail', kyc: 'Review', status: 'Frozen' }
          ]}
        />
      </div>
    </ExchangeShell>
  );
}
