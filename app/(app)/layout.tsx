import Link from 'next/link';
import { requireUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
        <nav className="flex items-center gap-4 text-sm">
          <span className="font-semibold">Expired Dialer</span>
          <Link href="/dialer">Dialer</Link>
          <Link href="/leads">Leads</Link>
          <Link href="/callbacks">Callbacks</Link>
          <Link href="/import">Import</Link>
          <Link href="/settings">Settings</Link>
        </nav>
        <span className="text-sm text-neutral-600">{user.email}</span>
      </header>
      <main className="p-4">{children}</main>
    </div>
  );
}
