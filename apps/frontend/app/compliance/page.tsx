// apps/frontend/app/compliance/page.tsx
import { ControlCard, OperationsTable, PageHeader } from '../../components/exchange-widgets';
import { ExchangeShell } from '../../components/exchange-shell';

export default async function CompliancePage() {
  return (
    <ExchangeShell section="Compliance">
      <PageHeader eyebrow="KYC / AML" title="Compliance" actions={<button className="rounded bg-accent px-3 py-2 text-xs font-bold text-ink">Screen Address</button>} />
      <div className="space-y-4 p-4">
        <div className="grid gap-3 md:grid-cols-4">
          <ControlCard icon="risk" title="Open Alerts" value="5" detail="sanctions/watchlist" tone="danger" />
          <ControlCard icon="check" title="Screened Today" value="82,114" detail="addresses + users" tone="positive" />
          <ControlCard icon="clock" title="SAR Drafts" value="2" detail="operator workflow" />
          <ControlCard icon="data" title="Policy Matrix" value="14" detail="jurisdiction rules" />
        </div>
        <OperationsTable
          title="AML Alert Queue"
          rows={[
            { case: 'AML-24018', subject: 'user_7001', trigger: 'Watchlist address', severity: 'High', status: 'Frozen' },
            { case: 'AML-24019', subject: 'user_1841', trigger: 'Velocity pattern', severity: 'Medium', status: 'Review' },
            { case: 'KYC-77420', subject: 'user_4420', trigger: 'Document mismatch', severity: 'Low', status: 'Pending' }
          ]}
        />
      </div>
    </ExchangeShell>
  );
}
