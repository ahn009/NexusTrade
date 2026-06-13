// apps/frontend/components/exchange-shell.tsx
import Link from 'next/link';
import {
  Activity,
  Bell,
  CandlestickChart,
  CircleDollarSign,
  Landmark,
  LayoutDashboard,
  ListChecks,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  WalletCards
} from 'lucide-react';

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/trading', label: 'Trading', icon: CandlestickChart },
  { href: '/wallets', label: 'Wallets', icon: WalletCards },
  { href: '/deposits', label: 'Deposits', icon: CircleDollarSign },
  { href: '/withdrawals', label: 'Withdrawals', icon: Landmark },
  { href: '/users', label: 'Users', icon: Users },
  { href: '/risk', label: 'Risk', icon: Activity },
  { href: '/compliance', label: 'Compliance', icon: ShieldCheck },
  { href: '/settings', label: 'Settings', icon: SlidersHorizontal }
];

export function ExchangeShell({ children, section }: Readonly<{ children: React.ReactNode; section: string }>) {
  return (
    <div className="min-h-screen bg-app text-foreground">
      <header className="sticky top-0 z-20 border-b border-line bg-panel/95 backdrop-blur">
        <div className="flex min-h-14 items-center justify-between px-4 lg:px-6">
          <div className="flex items-center gap-5">
            <Link href="/dashboard" className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded bg-accent text-sm font-black text-ink">N</span>
              <span className="text-sm font-semibold tracking-wide">NexusTrade</span>
            </Link>
            <nav className="hidden items-center gap-1 lg:flex">
              {['Buy Crypto', 'Markets', 'Spot', 'Futures', 'Earn', 'Institutional'].map((item) => (
                <a key={item} className="rounded px-3 py-2 text-xs font-medium text-muted transition-colors hover:bg-soft hover:text-foreground">
                  {item}
                </a>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/login" className="hidden rounded px-3 py-2 text-xs font-semibold text-muted transition-colors hover:bg-soft hover:text-foreground sm:inline-flex">
              Log In
            </Link>
            <Link href="/register" className="rounded bg-accent px-3 py-2 text-xs font-bold text-ink transition-transform active:scale-[0.97]">
              Register
            </Link>
            <button aria-label="Notifications" className="grid h-8 w-8 place-items-center rounded border border-line text-muted transition-colors hover:border-accent hover:text-foreground">
              <Bell size={16} />
            </button>
          </div>
        </div>
      </header>

      <div className="grid min-h-[calc(100vh-57px)] lg:grid-cols-[224px_1fr]">
        <aside className="hidden border-r border-line bg-panel lg:block">
          <div className="px-3 py-4">
            <div className="mb-3 px-3 text-[11px] font-semibold uppercase text-muted">Exchange Console</div>
            <nav className="space-y-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                const active = item.label === section;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-3 rounded px-3 py-2 text-sm transition-colors ${
                      active ? 'bg-accent text-ink' : 'text-muted hover:bg-soft hover:text-foreground'
                    }`}
                  >
                    <Icon size={16} />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>
          <div className="border-t border-line px-6 py-5">
            <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
              <ListChecks size={15} className="text-positive" />
              Risk Controls
            </div>
            <p className="mt-2 text-xs leading-5 text-muted">RBAC, TOTP, status checks, and transport hardening are active in the latest build.</p>
          </div>
        </aside>
        <main className="min-w-0">{children}</main>
      </div>
    </div>
  );
}
