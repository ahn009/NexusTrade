// apps/frontend/app/settings/page.tsx
import { OperationsTable, PageHeader, Panel } from '../../components/exchange-widgets';
import { ExchangeShell } from '../../components/exchange-shell';
import { ApiClient } from '../../lib/api-client';

export default async function SettingsPage() {
  const api = new ApiClient(process.env.NEXT_PUBLIC_API_BASE_URL);
  const exchangeInfo = await api.request<{ symbols?: string[] }>('/exchangeInfo').catch(() => ({ symbols: [] }));
  const symbols = exchangeInfo.symbols?.length ? exchangeInfo.symbols : ['BTC-USDT', 'ETH-USDT', 'SOL-USDT'];
  return (
    <ExchangeShell section="Settings">
      <PageHeader eyebrow="Configuration" title="Settings" actions={<button className="rounded bg-accent px-3 py-2 text-xs font-bold text-ink">Save Draft</button>} />
      <div className="grid gap-4 p-4 xl:grid-cols-[1fr_360px]">
        <OperationsTable
          title="Trading Pairs"
          rows={symbols.map((symbol) => ({
            symbol,
            status: 'Enabled',
            tickSize: symbol.startsWith('BTC') ? '0.10' : '0.01',
            lotSize: symbol.startsWith('BTC') ? '0.00001' : '0.001',
            feeTier: 'Default'
          }))}
        />
        <div className="space-y-4">
          <Panel title="Security Defaults" action="Production">
            <div className="space-y-3 text-sm">
              {[
                ['RBAC', 'Admin/operator claims required'],
                ['TOTP', 'Pending-secret verification'],
                ['Kafka', 'SSL/SASL configurable'],
                ['gRPC', 'TLS certificate paths configurable']
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4 border-b border-line pb-2 last:border-0">
                  <span className="font-medium">{label}</span>
                  <span className="text-right text-xs text-muted">{value}</span>
                </div>
              ))}
            </div>
          </Panel>
          <Panel title="Fee Schedule" action="BPS">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="rounded bg-soft p-3"><div className="text-xs text-muted">Maker</div><div className="font-semibold">2 bps</div></div>
              <div className="rounded bg-soft p-3"><div className="text-xs text-muted">Taker</div><div className="font-semibold">4 bps</div></div>
            </div>
          </Panel>
        </div>
      </div>
    </ExchangeShell>
  );
}
