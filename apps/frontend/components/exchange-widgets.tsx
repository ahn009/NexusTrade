// apps/frontend/components/exchange-widgets.tsx
import { ArrowDownLeft, ArrowUpRight, CheckCircle2, Clock3, DatabaseZap, LineChart, LockKeyhole, ShieldAlert, Wallet } from 'lucide-react';

export type Ticker = {
  symbol: string;
  lastPrice: string;
  volume: string;
  priceChangePercent?: string;
};

export type Depth = {
  bids?: Array<[string, string]>;
  asks?: Array<[string, string]>;
};

export const fallbackMarkets = [
  { symbol: 'BTC-USDT', name: 'Bitcoin', price: '63,590.00', change: '+1.24%', volume: '$18.2B' },
  { symbol: 'ETH-USDT', name: 'Ethereum', price: '1,665.14', change: '-0.55%', volume: '$9.8B' },
  { symbol: 'SOL-USDT', name: 'Solana', price: '141.22', change: '+3.18%', volume: '$1.6B' },
  { symbol: 'BNB-USDT', name: 'BNB', price: '600.20', change: '-0.49%', volume: '$742M' },
  { symbol: 'XRP-USDT', name: 'XRP', price: '1.13', change: '-1.03%', volume: '$611M' }
];

export const defaultDepth: Required<Depth> = {
  asks: [
    ['63,612.40', '0.418'],
    ['63,608.90', '1.263'],
    ['63,604.20', '0.774'],
    ['63,598.10', '2.019'],
    ['63,594.70', '0.508'],
    ['63,591.30', '1.640']
  ],
  bids: [
    ['63,589.80', '0.932'],
    ['63,585.60', '1.128'],
    ['63,580.10', '0.446'],
    ['63,574.90', '2.770'],
    ['63,569.50', '0.615'],
    ['63,560.00', '1.904']
  ]
};

export const recentTrades = [
  { price: '63,590.00', amount: '0.0382', time: '12:41:09', side: 'buy' },
  { price: '63,588.20', amount: '0.1140', time: '12:41:07', side: 'sell' },
  { price: '63,591.40', amount: '0.0428', time: '12:41:05', side: 'buy' },
  { price: '63,584.10', amount: '0.2271', time: '12:41:03', side: 'sell' },
  { price: '63,597.80', amount: '0.0198', time: '12:40:59', side: 'buy' },
  { price: '63,600.30', amount: '0.0674', time: '12:40:55', side: 'buy' }
];

export function PageHeader({ title, eyebrow, actions }: Readonly<{ title: string; eyebrow: string; actions?: React.ReactNode }>) {
  return (
    <div className="flex flex-col gap-3 border-b border-line bg-panel px-4 py-4 lg:flex-row lg:items-center lg:justify-between lg:px-6">
      <div>
        <p className="text-xs font-semibold uppercase text-muted">{eyebrow}</p>
        <h1 className="mt-1 text-2xl font-semibold">{title}</h1>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function MetricStrip({ ticker }: Readonly<{ ticker: Ticker }>) {
  const metrics = [
    { label: 'BTC-USDT', value: ticker.lastPrice || '63,590.00', detail: ticker.priceChangePercent ?? '+1.24%', tone: 'positive' },
    { label: '24H Volume', value: ticker.volume || '18.2B', detail: 'deep liquidity', tone: 'neutral' },
    { label: 'Proof Controls', value: '4', detail: 'risk gates active', tone: 'neutral' },
    { label: 'Gateway', value: 'Online', detail: 'request-id tracked', tone: 'positive' }
  ];
  return (
    <div className="grid border-b border-line bg-panel md:grid-cols-4">
      {metrics.map((metric) => (
        <div key={metric.label} className="border-b border-line px-4 py-3 md:border-b-0 md:border-r last:md:border-r-0 lg:px-6">
          <div className="text-[11px] font-semibold uppercase text-muted">{metric.label}</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-lg font-semibold">{metric.value}</span>
            <span className={metric.tone === 'positive' ? 'text-xs font-semibold text-positive' : 'text-xs text-muted'}>{metric.detail}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

export function MarketTable() {
  return (
    <Panel title="Markets" action="View All">
      <div className="space-y-1">
        {fallbackMarkets.map((market) => (
          <div key={market.symbol} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 rounded px-2 py-2 text-sm hover:bg-soft">
            <div>
              <div className="font-semibold">{market.symbol}</div>
              <div className="text-xs text-muted">{market.name}</div>
            </div>
            <div className="text-right font-medium">{market.price}</div>
            <div className={`w-20 text-right text-xs font-semibold ${market.change.startsWith('+') ? 'text-positive' : 'text-danger'}`}>{market.change}</div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

export function OrderBook({ depth = defaultDepth }: Readonly<{ depth?: Depth }>) {
  const asks = (depth.asks?.length ? depth.asks : defaultDepth.asks).slice(0, 8).reverse();
  const bids = (depth.bids?.length ? depth.bids : defaultDepth.bids).slice(0, 8);
  return (
    <Panel title="Order Book" action="0.01">
      <div className="grid grid-cols-3 px-2 pb-2 text-[11px] font-semibold uppercase text-muted">
        <span>Price</span>
        <span className="text-right">Amount</span>
        <span className="text-right">Total</span>
      </div>
      <div className="space-y-0.5">
        {asks.map(([price, amount]) => <BookRow key={`ask-${price}-${amount}`} price={price} amount={amount} side="ask" />)}
      </div>
      <div className="my-2 rounded bg-soft px-2 py-2 text-center text-lg font-semibold text-positive">63,590.00</div>
      <div className="space-y-0.5">
        {bids.map(([price, amount]) => <BookRow key={`bid-${price}-${amount}`} price={price} amount={amount} side="bid" />)}
      </div>
    </Panel>
  );
}

function BookRow({ price, amount, side }: Readonly<{ price: string; amount: string; side: 'bid' | 'ask' }>) {
  const total = Number(String(price).replace(/,/g, '')) * Number(amount);
  return (
    <div className="grid grid-cols-3 rounded px-2 py-1 text-xs hover:bg-soft">
      <span className={side === 'bid' ? 'font-medium text-positive' : 'font-medium text-danger'}>{price}</span>
      <span className="text-right">{amount}</span>
      <span className="text-right text-muted">{Number.isFinite(total) ? total.toLocaleString('en-US', { maximumFractionDigits: 0 }) : '-'}</span>
    </div>
  );
}

export function TradingChart() {
  const bars = [44, 58, 51, 73, 62, 68, 92, 81, 76, 88, 69, 95, 104, 97, 118, 110, 126, 116, 134, 128, 145, 137, 153, 149];
  return (
    <Panel title="BTC-USDT" action="Spot">
      <div className="flex flex-wrap items-center gap-4 border-b border-line px-2 pb-3 text-xs text-muted">
        <span className="text-xl font-semibold text-foreground">63,590.00</span>
        <span className="font-semibold text-positive">+1.24%</span>
        <span>High 64,210.30</span>
        <span>Low 62,880.10</span>
        <span>Vol 18.2B USDT</span>
      </div>
      <div className="relative mt-4 h-72 overflow-hidden rounded bg-chart">
        <div className="absolute inset-0 chart-grid" />
        <div className="absolute inset-x-4 bottom-8 flex h-52 items-end gap-1">
          {bars.map((height, index) => (
            <div
              key={index}
              className={`min-w-0 flex-1 rounded-t ${index % 5 === 1 || index % 7 === 2 ? 'bg-danger/80' : 'bg-positive/80'}`}
              style={{ height: `${height}px` }}
            />
          ))}
        </div>
        <div className="absolute bottom-3 left-4 right-4 flex justify-between text-[10px] text-muted">
          <span>09:00</span>
          <span>12:00</span>
          <span>15:00</span>
          <span>18:00</span>
        </div>
      </div>
    </Panel>
  );
}

export function OrderTicket() {
  return (
    <Panel title="Place Order" action="Isolated">
      <div className="grid grid-cols-3 rounded bg-soft p-1 text-xs font-semibold">
        <button className="rounded bg-panel py-2 text-positive">Buy</button>
        <button className="rounded py-2 text-muted">Sell</button>
        <button className="rounded py-2 text-muted">Convert</button>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
        {['Limit', 'Market', 'Stop'].map((type, index) => (
          <button key={type} className={`rounded border px-2 py-2 ${index === 0 ? 'border-accent text-accent' : 'border-line text-muted'}`}>{type}</button>
        ))}
      </div>
      <FormField label="Price" value="63,590.00 USDT" />
      <FormField label="Amount" value="0.025 BTC" />
      <FormField label="Total" value="1,589.75 USDT" />
      <div className="mt-4 grid grid-cols-4 gap-2 text-[11px] text-muted">
        {['25%', '50%', '75%', '100%'].map((item) => <button key={item} className="rounded border border-line py-1.5 hover:border-accent hover:text-foreground">{item}</button>)}
      </div>
      <button className="mt-5 w-full rounded bg-positive px-3 py-3 text-sm font-bold text-white transition-transform active:scale-[0.98]">Buy BTC</button>
      <div className="mt-4 space-y-2 text-xs text-muted">
        <div className="flex justify-between"><span>Available</span><span>12,450.00 USDT</span></div>
        <div className="flex justify-between"><span>Fee tier</span><span>Maker 0.02% / Taker 0.04%</span></div>
      </div>
    </Panel>
  );
}

function FormField({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <label className="mt-3 block text-xs text-muted">
      {label}
      <input value={value} readOnly className="mt-1 w-full rounded border border-line bg-app px-3 py-2 text-sm font-medium text-foreground outline-none" />
    </label>
  );
}

export function RecentTrades() {
  return (
    <Panel title="Market Trades" action="Live">
      <div className="space-y-1">
        {recentTrades.map((trade) => (
          <div key={`${trade.time}-${trade.price}`} className="grid grid-cols-3 px-2 py-1 text-xs">
            <span className={trade.side === 'buy' ? 'font-medium text-positive' : 'font-medium text-danger'}>{trade.price}</span>
            <span className="text-right">{trade.amount}</span>
            <span className="text-right text-muted">{trade.time}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

export function OperationsTable({ title, rows }: Readonly<{ title: string; rows: Array<Record<string, string>> }>) {
  const keys = Object.keys(rows[0] ?? {});
  return (
    <Panel title={title} action={`${rows.length} items`}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] text-left text-sm">
          <thead className="text-[11px] uppercase text-muted">
            <tr>{keys.map((key) => <th key={key} className="border-b border-line px-3 py-2 font-semibold">{key}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index} className="hover:bg-soft">
                {keys.map((key) => <td key={key} className="border-b border-line px-3 py-3 text-xs">{row[key]}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

export function WalletOverview() {
  const rows = [
    { asset: 'USDT', available: '124,500.00', locked: '1,589.75', value: '$126,089.75' },
    { asset: 'BTC', available: '2.1842', locked: '0.0250', value: '$140,501.12' },
    { asset: 'ETH', available: '48.8021', locked: '0.0000', value: '$81,260.54' },
    { asset: 'SOL', available: '1,842.90', locked: '25.0000', value: '$263,102.60' }
  ];
  return (
    <Panel title="Wallet Balances" action={`${rows.length} assets`}>
      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.asset} className="rounded border border-line px-3 py-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold">{row.asset}</span>
              <span className="text-sm font-semibold">{row.value}</span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-3 text-xs text-muted">
              <div>
                <div className="font-semibold uppercase">Available</div>
                <div className="mt-0.5 text-foreground">{row.available}</div>
              </div>
              <div className="text-right">
                <div className="font-semibold uppercase">Locked</div>
                <div className="mt-0.5 text-foreground">{row.locked}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

export function ControlCard({ icon, title, value, detail, tone = 'neutral' }: Readonly<{ icon: 'wallet' | 'lock' | 'risk' | 'data' | 'clock' | 'check'; title: string; value: string; detail: string; tone?: 'neutral' | 'positive' | 'danger' }>) {
  const icons = {
    wallet: Wallet,
    lock: LockKeyhole,
    risk: ShieldAlert,
    data: DatabaseZap,
    clock: Clock3,
    check: CheckCircle2
  };
  const Icon = icons[icon];
  return (
    <div className="rounded-md border border-line bg-panel p-4">
      <div className="flex items-center justify-between">
        <div className={`grid h-9 w-9 place-items-center rounded ${tone === 'danger' ? 'bg-danger/10 text-danger' : tone === 'positive' ? 'bg-positive/10 text-positive' : 'bg-soft text-muted'}`}>
          <Icon size={18} />
        </div>
        {tone === 'positive' ? <ArrowUpRight size={16} className="text-positive" /> : tone === 'danger' ? <ArrowDownLeft size={16} className="text-danger" /> : <LineChart size={16} className="text-muted" />}
      </div>
      <div className="mt-4 text-xs font-semibold uppercase text-muted">{title}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
      <div className="mt-1 text-xs text-muted">{detail}</div>
    </div>
  );
}

export function Panel({ title, action, children }: Readonly<{ title: string; action?: string; children: React.ReactNode }>) {
  return (
    <section className="rounded-md border border-line bg-panel">
      <div className="flex min-h-11 items-center justify-between border-b border-line px-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action ? <span className="text-xs font-medium text-muted">{action}</span> : null}
      </div>
      <div className="p-3">{children}</div>
    </section>
  );
}
