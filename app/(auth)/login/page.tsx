import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { LoginForm } from '@/components/auth/login-form';
import { getServerSession } from '@/lib/server/auth/server-session';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Sign in',
  robots: { index: false, follow: false },
};

function safeNextPath(rawNextPath: string | string[] | undefined): string {
  const candidate = Array.isArray(rawNextPath) ? rawNextPath[0] : rawNextPath;
  if (!candidate) return '/';
  if (!candidate.startsWith('/') || candidate.startsWith('//')) return '/';
  if (candidate.startsWith('/api/') || candidate.startsWith('/login')) return '/';
  return candidate;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const session = await getServerSession();
  if (session) redirect('/');

  const resolvedSearchParams = await searchParams;

  return (
    <main id="main-content" className="flex min-h-screen flex-col justify-center bg-slate-100 px-4 py-12">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-6 text-center">
          <p className="text-xs font-semibold tracking-[0.2em] text-indigo-600 uppercase">
            UniconHub
          </p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-900">Platform Admin</h1>
          <p className="mt-1 text-sm text-slate-600">
            Platform control plane. Authorised staff only.
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <LoginForm nextPath={safeNextPath(resolvedSearchParams.next)} />
        </div>

        <p className="mt-6 text-center text-xs text-slate-500">
          All access attempts are audited. This host is not indexed.
        </p>
      </div>
    </main>
  );
}
