import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Not found',
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <main id="main-content" className="mx-auto max-w-lg px-6 py-24 text-center">
      <p className="text-sm font-semibold tracking-wide text-indigo-600 uppercase">404</p>
      <h1 className="mt-2 text-2xl font-semibold text-slate-900">Page not found</h1>
      <p className="mt-2 text-sm text-slate-600">
        The page you requested does not exist in the platform control plane.
      </p>
      <a
        href="/"
        className="mt-6 inline-flex items-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
      >
        Return to dashboard
      </a>
    </main>
  );
}
