import { redirect } from 'next/navigation';
import { AppNav } from '@/components/layout/app-nav';
import { getSession } from '@/lib/auth/session';

export const runtime = 'nodejs';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // LAYER 2, the real boundary. middleware.ts only saw that a cookie existed; this
  // resolves the token against the sessions table and redirects if it does not check out.
  const session = await getSession();

  if (!session) {
    redirect('/login');
  }

  return (
    <div className="min-h-screen">
      <AppNav userName={session.name} />
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
