'use client';

// apps/frontend/app/page.tsx
import { Activity, AlertTriangle, BadgeDollarSign, Database, ShieldCheck, Users } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const health = [
  { name: 'API Gateway', status: 'healthy', value: '28 ms' },
  { name: 'Kafka', status: 'healthy', value: '3 ms lag' },
  { name: 'PostgreSQL', status: 'healthy', value: '42 conns' },
  { name: 'ClickHouse', status: 'healthy', value: '12 qps' },
  { name: 'Redis', status: 'healthy', value: '0.9 ms' }
];

const volume = [
  { time: '09:00', volume: 42 },
  { time: '10:00', volume: 58 },
  { time: '11:00', volume: 53 },
  { time: '12:00', volume: 76 },
  { time: '13:00', volume: 71 },
  { time: '14:00', volume: 89 }
];

const queues = [
  { label: 'KYC Review', value: 18, icon: Users },
  { label: 'Withdrawal Approvals', value: 7, icon: BadgeDollarSign },
  { label: 'Risk Alerts', value: 4, icon: AlertTriangle },
  { label: 'Compliance SAR', value: 3, icon: ShieldCheck }
];

export default function Page() {
  return (
    <main className="min-h-screen">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-xl font-semibold tracking-normal">NexusTrade Admin</h1>
            <p className="text-sm text-muted">Exchange operations, risk, compliance, wallets, and market data</p>
          </div>
          <div className="flex items-center gap-2 rounded border border-line px-3 py-2 text-sm">
            <Activity className="h-4 w-4 text-accent" />
            Live
          </div>
        </div>
      </header>

      <section className="mx-auto grid max-w-7xl gap-5 px-6 py-6 lg:grid-cols-[1.4fr_0.8fr]">
        <div className="rounded-md border border-line bg-white p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold">24h Trading Volume</h2>
            <span className="text-sm text-muted">BTC-USDT, ETH-USDT, SOL-USDT</span>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={volume}>
                <CartesianGrid stroke="#d9e0e8" strokeDasharray="3 3" />
                <XAxis dataKey="time" />
                <YAxis />
                <Tooltip />
                <Area type="monotone" dataKey="volume" stroke="#0d9488" fill="#99f6e4" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-md border border-line bg-white p-5">
          <h2 className="mb-4 text-base font-semibold">System Health</h2>
          <div className="space-y-3">
            {health.map((item) => (
              <div key={item.name} className="flex items-center justify-between border-b border-line pb-3 last:border-0">
                <div className="flex items-center gap-3">
                  <Database className="h-4 w-4 text-accent" />
                  <span className="text-sm font-medium">{item.name}</span>
                </div>
                <span className="text-sm text-muted">{item.value}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-5 px-6 pb-8 md:grid-cols-4">
        {queues.map((queue) => {
          const Icon = queue.icon;
          return (
            <div key={queue.label} className="rounded-md border border-line bg-white p-5">
              <div className="mb-4 flex items-center justify-between">
                <Icon className="h-5 w-5 text-accent" />
                <span className="text-2xl font-semibold">{queue.value}</span>
              </div>
              <p className="text-sm font-medium">{queue.label}</p>
            </div>
          );
        })}
      </section>
    </main>
  );
}
