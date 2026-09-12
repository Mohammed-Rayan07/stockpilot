'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { Bot, ClipboardList, LayoutDashboard, Package, Receipt, Truck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiPost } from '@/lib/client-api';

const LINKS = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/products', label: 'Products', icon: Package },
  { href: '/sales', label: 'Sales', icon: Receipt },
  { href: '/reorder', label: 'Reorder Advisor', icon: ClipboardList },
  { href: '/purchase-orders', label: 'Purchase orders', icon: Truck },
  { href: '/assistant', label: 'Assistant', icon: Bot },
];

export function AppNav({ userName }: { userName: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function onSignOut() {
    setSigningOut(true);
    try {
      await apiPost('/api/auth/logout');
      router.push('/login');
      router.refresh();
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <header className="border-b">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-3">
        <Link href="/dashboard" className="font-semibold tracking-tight">
          StockPilot
        </Link>

        <nav className="flex flex-1 flex-wrap gap-x-4 gap-y-1 text-sm">
          {LINKS.map((link) => {
            const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
            const Icon = link.icon;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={
                  active
                    ? 'flex items-center gap-1.5 text-foreground font-medium'
                    : 'flex items-center gap-1.5 text-muted-foreground hover:text-foreground'
                }
              >
                <Icon className="size-4" />
                {link.label}
              </Link>
            );
          })}
        </nav>

        <span className="text-muted-foreground hidden text-sm sm:inline">{userName}</span>
        <Button variant="outline" size="sm" onClick={onSignOut} disabled={signingOut}>
          {signingOut ? 'Signing out…' : 'Sign out'}
        </Button>
      </div>
    </header>
  );
}
