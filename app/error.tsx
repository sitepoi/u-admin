'use client';

import { useEffect } from 'react';

export default function PlatformError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log only the digest and message: never the request body or tokens.
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'ui.route_error',
        digest: error.digest ?? null,
        message: error.message.slice(0, 300),
      }),
    );
  }, [error]);

  return (
    <main id="main-content" className="mx-auto max-w-lg px-6 py-24 text-center">
      <h1 className="text-2xl font-semibold text-slate-900">Something went wrong</h1>
      <p className="mt-2 text-sm text-slate-600">
        The platform could not render this page. No secret material is ever included in error
        output.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-6 inline-flex items-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
      >
        Try again
      </button>
    </main>
  );
}
