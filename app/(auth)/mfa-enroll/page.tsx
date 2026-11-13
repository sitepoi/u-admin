import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { MfaEnrollForm } from '@/components/auth/mfa-enroll-form';
import { getServerSession } from '@/lib/server/auth/server-session';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Enrol MFA',
  robots: { index: false, follow: false },
};

export default async function MfaEnrollPage() {
  const session = await getServerSession();
  if (session) redirect('/');

  return (
    <main
      id="main-content"
      className="flex min-h-screen flex-col justify-center bg-slate-100 px-4 py-12"
    >
      <div className="mx-auto w-full max-w-lg">
        <div className="mb-6 text-center">
          <p className="text-xs font-semibold tracking-[0.2em] text-indigo-600 uppercase">
            UniconHub
          </p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-900">Enrol a second factor</h1>
          <p className="mt-1 text-sm text-slate-600">
            Every platform session requires MFA. Enrol once, then use the normal sign-in page.
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <MfaEnrollForm />
        </div>

        <p className="mt-6 text-center text-xs text-slate-500">
          <a href="/login" className="text-indigo-700 hover:underline">
            Back to sign in
          </a>
        </p>
      </div>
    </main>
  );
}
