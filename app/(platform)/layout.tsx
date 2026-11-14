import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { SidebarNav, type NavItem } from '@/components/layout/sidebar-nav';
import { LogoutButton } from '@/components/layout/logout-button';
import { Badge } from '@/components/ui/badge';
import { getServerSession } from '@/lib/server/auth/server-session';
import { roleCan } from '@/lib/server/auth/roles';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function PlatformLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await getServerSession();
  if (!session) redirect('/login');

  const navItems: NavItem[] = [
    { href: '/', label: 'Dashboard', description: 'Platform overview' },
    { href: '/projects', label: 'Projects', description: 'Managed projects and tenants' },
  ];

  if (roleCan(session.role, 'secret:metadata:read')) {
    navItems.push({ href: '/secrets', label: 'Secrets', description: 'First-party metadata' });
  }
  if (roleCan(session.role, 'audit:read')) {
    navItems.push({ href: '/audit', label: 'Audit', description: 'Append-only trail' });
  }
  navItems.push({ href: '/settings', label: 'Settings', description: 'Platform configuration' });

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[280px_1fr]">
      <aside className="hidden border-r border-slate-200 bg-white lg:flex lg:min-h-screen lg:flex-col lg:justify-between lg:px-4 lg:py-6">
        <div>
          <div className="px-3">
            <p className="text-xs font-semibold tracking-[0.2em] text-indigo-600 uppercase">
              UniconHub
            </p>
            <p className="mt-1 text-lg font-semibold text-slate-900">Platform Admin</p>
            <p className="mt-1 text-xs text-slate-500">No tenant boundary</p>
          </div>
          <div className="mt-6">
            <SidebarNav items={navItems} />
          </div>
        </div>

        <div className="mt-8 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div>
            <p className="truncate text-sm font-medium text-slate-800" title={session.email}>
              {session.email}
            </p>
            <div className="mt-1">
              <Badge tone="indigo">{session.role}</Badge>
            </div>
          </div>
          <LogoutButton />
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="border-b border-slate-200 bg-white px-4 py-3 lg:px-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="lg:hidden">
              <p className="text-xs font-semibold tracking-[0.2em] text-indigo-600 uppercase">
                UniconHub
              </p>
              <p className="text-base font-semibold text-slate-900">Platform Admin</p>
            </div>
            <div className="hidden lg:block">
              <p className="text-xs text-slate-500">
                Signed in as <span className="font-medium text-slate-700">{session.email}</span>
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge tone="indigo">{session.role}</Badge>
              <span className="lg:hidden">
                <LogoutButton />
              </span>
            </div>
          </div>

          <div className="mt-3 lg:hidden">
            <nav aria-label="Platform sections" className="flex gap-1 overflow-x-auto pb-1">
              {navItems.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  className="shrink-0 rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
                >
                  {item.label}
                </a>
              ))}
            </nav>
          </div>
        </header>

        <main id="main-content" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 lg:px-8 lg:py-8">
          {children}
        </main>

        <footer className="border-t border-slate-200 px-4 py-4 text-xs text-slate-400 lg:px-8">
          Private platform control plane. All actions are audited.
        </footer>
      </div>
    </div>
  );
}
