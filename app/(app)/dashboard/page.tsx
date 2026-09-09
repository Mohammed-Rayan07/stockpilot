import { requireSession } from '@/lib/auth/guard';

export const runtime = 'nodejs';

export const metadata = { title: 'Dashboard · StockPilot' };

// Placeholder until Phase 4 builds the analytics. It exists now so that Phase 2's
// verification — /dashboard unreachable when signed out — has something to protect.
export default async function DashboardPage() {
  const session = await requireSession();

  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
      <p className="text-muted-foreground">
        Signed in as {session.name} ({session.email}).
      </p>
      <p className="text-muted-foreground">Analytics arrive in Phase 4.</p>
    </div>
  );
}
