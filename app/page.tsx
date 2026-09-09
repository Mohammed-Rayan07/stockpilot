import Link from 'next/link';
import { redirect } from 'next/navigation';
import { buttonVariants } from '@/components/ui/button';
import { getSession } from '@/lib/auth/session';

export const runtime = 'nodejs';

export default async function HomePage() {
  const session = await getSession();

  if (session) {
    redirect('/dashboard');
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-6">
      <div>
        <h1 className="text-4xl font-semibold tracking-tight">StockPilot</h1>
        <p className="text-muted-foreground mt-3 text-lg">
          Inventory, sales and reorder planning for small businesses.
        </p>
      </div>
      <div className="flex gap-3">
        <Link href="/register" className={buttonVariants({ size: 'lg' })}>
          Create an account
        </Link>
        <Link href="/login" className={buttonVariants({ variant: 'outline', size: 'lg' })}>
          Sign in
        </Link>
      </div>
    </main>
  );
}
