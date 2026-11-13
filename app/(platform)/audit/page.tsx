import Link from 'next/link';

import { Alert } from '@/components/ui/alert';
import { StatusBadge } from '@/components/ui/badge';
import { buttonClassName } from '@/components/ui/button';
import { Card, CardBody, CardHeader, EmptyState } from '@/components/ui/card';
import { formatDateTime } from '@/lib/client/format';
import { AUDIT_ACTIONS, AUDIT_RESULTS } from '@/lib/shared/platform-types';
import { AUDIT_PAGE_SIZE } from '@/lib/shared/constants';
import { roleCan } from '@/lib/server/auth/roles';
import { requireServerSession } from '@/lib/server/auth/server-session';
import { getPlatformStore } from '@/lib/server/firestore/store-provider';

export const dynamic = 'force-dynamic';

function firstValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

function toIsoStart(dateValue: string): string | null {
  if (!dateValue) return null;
  const timestamp = Date.parse(`${dateValue}T00:00:00.000Z`);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function toIsoEnd(dateValue: string): string | null {
  if (!dateValue) return null;
  const timestamp = Date.parse(`${dateValue}T23:59:59.999Z`);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireServerSession();

  if (!roleCan(session.role, 'audit:read')) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold text-slate-900">Audit log</h1>
        <Alert tone="warning" title="Not permitted">
          Your role cannot read the audit log. Owners, admins and auditors can.
        </Alert>
      </div>
    );
  }

  const resolvedSearchParams = await searchParams;
  const tenantId = firstValue(resolvedSearchParams.tenantId).trim();
  const action = firstValue(resolvedSearchParams.action).trim();
  const result = firstValue(resolvedSearchParams.result).trim();
  const fromDate = firstValue(resolvedSearchParams.from).trim();
  const toDate = firstValue(resolvedSearchParams.to).trim();
  const cursor = firstValue(resolvedSearchParams.cursor).trim();

  const page = await getPlatformStore().listAudit({
    tenantId: tenantId || null,
    action: action || null,
    result: result || null,
    from: toIsoStart(fromDate),
    to: toIsoEnd(toDate),
    limit: AUDIT_PAGE_SIZE,
    cursor: cursor || null,
  });

  const nextPageParams = new URLSearchParams();
  if (tenantId) nextPageParams.set('tenantId', tenantId);
  if (action) nextPageParams.set('action', action);
  if (result) nextPageParams.set('result', result);
  if (fromDate) nextPageParams.set('from', fromDate);
  if (toDate) nextPageParams.set('to', toDate);
  if (page.nextCursor) nextPageParams.set('cursor', page.nextCursor);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Audit log</h1>
        <p className="mt-1 text-sm text-slate-600">
          Append-only. Records cannot be edited or deleted through this application.
        </p>
      </header>

      <Card>
        <CardHeader title="Filters" description="Filters are applied server-side." />
        <CardBody>
          <form method="get" action="/audit" className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
            <div>
              <label htmlFor="audit-tenant" className="block text-sm font-medium text-slate-800">
                Tenant id
              </label>
              <input
                id="audit-tenant"
                name="tenantId"
                defaultValue={tenantId}
                className="mt-1 block w-full rounded-md border-0 bg-white px-3 py-2 text-sm shadow-sm ring-1 ring-slate-300 ring-inset focus:ring-2 focus:ring-indigo-600"
              />
            </div>
            <div>
              <label htmlFor="audit-action" className="block text-sm font-medium text-slate-800">
                Action
              </label>
              <select
                id="audit-action"
                name="action"
                defaultValue={action}
                className="mt-1 block w-full rounded-md border-0 bg-white px-3 py-2 text-sm shadow-sm ring-1 ring-slate-300 ring-inset focus:ring-2 focus:ring-indigo-600"
              >
                <option value="">All actions</option>
                {AUDIT_ACTIONS.map((auditAction) => (
                  <option key={auditAction} value={auditAction}>
                    {auditAction}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="audit-result" className="block text-sm font-medium text-slate-800">
                Result
              </label>
              <select
                id="audit-result"
                name="result"
                defaultValue={result}
                className="mt-1 block w-full rounded-md border-0 bg-white px-3 py-2 text-sm shadow-sm ring-1 ring-slate-300 ring-inset focus:ring-2 focus:ring-indigo-600"
              >
                <option value="">Any result</option>
                {AUDIT_RESULTS.map((auditResult) => (
                  <option key={auditResult} value={auditResult}>
                    {auditResult}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="audit-from" className="block text-sm font-medium text-slate-800">
                From (UTC)
              </label>
              <input
                id="audit-from"
                name="from"
                type="date"
                defaultValue={fromDate}
                className="mt-1 block w-full rounded-md border-0 bg-white px-3 py-2 text-sm shadow-sm ring-1 ring-slate-300 ring-inset focus:ring-2 focus:ring-indigo-600"
              />
            </div>
            <div>
              <label htmlFor="audit-to" className="block text-sm font-medium text-slate-800">
                To (UTC)
              </label>
              <input
                id="audit-to"
                name="to"
                type="date"
                defaultValue={toDate}
                className="mt-1 block w-full rounded-md border-0 bg-white px-3 py-2 text-sm shadow-sm ring-1 ring-slate-300 ring-inset focus:ring-2 focus:ring-indigo-600"
              />
            </div>
            <div className="flex items-end gap-2">
              <button type="submit" className={buttonClassName('primary', 'md')}>
                Apply
              </button>
              <Link href="/audit" className={buttonClassName('ghost', 'md')}>
                Reset
              </Link>
            </div>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Audit records"
          description={`Showing ${page.entries.length} record(s), newest first.`}
        />
        <CardBody className="px-0 py-0">
          {page.entries.length === 0 ? (
            <div className="px-5 py-6">
              <EmptyState title="No audit records match" description="Adjust the filters." />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Time</th>
                    <th scope="col">Actor</th>
                    <th scope="col">Action</th>
                    <th scope="col">Target</th>
                    <th scope="col">Tenant</th>
                    <th scope="col">Result</th>
                    <th scope="col">Context</th>
                  </tr>
                </thead>
                <tbody>
                  {page.entries.map((entry) => (
                    <tr key={entry.auditId}>
                      <td className="whitespace-nowrap text-xs">{formatDateTime(entry.createdAt)}</td>
                      <td className="text-xs">
                        <span className="block text-slate-900">{entry.actorEmail}</span>
                        <span className="block text-slate-500">{entry.actorRole}</span>
                        <span className="block font-mono text-[11px] text-slate-400">{entry.actorUid}</span>
                      </td>
                      <td className="font-mono text-xs">{entry.action}</td>
                      <td className="text-xs">
                        <span className="block font-mono">
                          {entry.targetType}: {entry.targetId}
                        </span>
                        {entry.appId ? (
                          <span className="block text-slate-500">app: {entry.appId}</span>
                        ) : null}
                        {entry.kid ? (
                          <span className="block font-mono text-slate-500">kid: {entry.kid}</span>
                        ) : null}
                      </td>
                      <td className="font-mono text-xs">{entry.tenantId ?? '-'}</td>
                      <td>
                        <StatusBadge status={entry.result} />
                      </td>
                      <td className="text-xs">
                        <details>
                          <summary className="cursor-pointer text-indigo-700">Details</summary>
                          <div className="mt-1 space-y-1 text-slate-500">
                            <p className="font-mono text-[11px]">request: {entry.requestId}</p>
                            <p className="font-mono text-[11px]">ip: {entry.ip}</p>
                            <pre className="mt-1 max-w-md overflow-x-auto rounded bg-slate-900 p-2 text-[11px] text-slate-100">
                              {JSON.stringify(entry.metadata, null, 2)}
                            </pre>
                          </div>
                        </details>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      <div className="flex items-center justify-between gap-3">
        <a
          href="/audit"
          className={page.entries.length === 0 ? 'pointer-events-none opacity-50' : ''}
        >
          <span className={buttonClassName('ghost', 'sm')}>First page</span>
        </a>
        {page.nextCursor ? (
          <Link href={`/audit?${nextPageParams.toString()}`} className={buttonClassName('secondary', 'sm')}>
            Next page
          </Link>
        ) : (
          <span className="text-xs text-slate-400">End of results</span>
        )}
      </div>
    </div>
  );
}
