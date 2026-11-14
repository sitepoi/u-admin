import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { buttonClassName } from '@/components/ui/button';
import { Card, CardBody, CardHeader, EmptyState } from '@/components/ui/card';
import { ProjectSwitcher } from '@/components/projects/project-switcher';
import { requireServerSession } from '@/lib/server/auth/server-session';
import { listRelayProjects, listRelayTenants } from '@/lib/server/relay/relay-client';
import type { RelayProjectSummary, RelayTenantSummary } from '@/lib/shared/platform-types';

export const dynamic = 'force-dynamic';

export default async function ProjectTenantsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  await requireServerSession();
  const { projectId } = await params;

  let projects: RelayProjectSummary[] = [];
  let tenants: RelayTenantSummary[] = [];
  let readError: string | null = null;

  try {
    projects = await listRelayProjects();
    tenants = await listRelayTenants(projectId);
  } catch (error) {
    readError = error instanceof Error ? error.message : 'The relay could not be read.';
  }

  if (!readError && !projects.some((project) => project.projectId === projectId)) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">Project</p>
          <h1 className="font-mono text-2xl font-semibold text-slate-900">{projectId}</h1>
          <p className="mt-1 text-sm text-slate-600">
            Tenants are relay applications whose decoded Firebase settings use this project id.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {projects.length > 0 ? (
            <ProjectSwitcher
              projects={projects.map((project) => ({
                projectId: project.projectId,
                displayName: project.projectId,
              }))}
              selectedProjectId={projectId}
            />
          ) : null}
          <Badge tone="neutral">Read-only</Badge>
        </div>
      </header>

      {readError ? (
        <Alert tone="danger" title="Could not reach sitepoi-relay">
          {readError}
        </Alert>
      ) : null}

      <Card>
        <CardHeader
          title="Tenants in this project"
          description={`${tenants.length} relay application(s) map to this project.`}
        />
        <CardBody className="px-0 py-0">
          {readError ? (
            <p className="px-5 py-6 text-sm text-slate-500">
              Check <code>PLATFORM_PROJECTS_SERVICE_ACCOUNT_JSON</code> and the read role on the
              relay project.
            </p>
          ) : tenants.length === 0 ? (
            <div className="px-5 py-6">
              <EmptyState
                title="No tenants in this project"
                description="No relay application decodes to this project id."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Tenant</th>
                    <th scope="col">Hostnames</th>
                    <th scope="col">Auth tenant</th>
                    <th scope="col">Table extension</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {tenants.map((tenant) => (
                    <tr key={tenant.applicationId}>
                      <td>
                        <span className="block font-medium text-slate-900">
                          {tenant.tenantId}
                        </span>
                        <span className="font-mono text-xs text-slate-500">
                          {tenant.applicationId}
                        </span>
                      </td>
                      <td className="text-xs text-slate-600">
                        {tenant.hostNames.length > 0 ? tenant.hostNames.join(', ') : '-'}
                      </td>
                      <td className="font-mono text-xs text-slate-600">
                        {tenant.authTenant || '-'}
                      </td>
                      <td className="text-xs text-slate-600">
                        {tenant.tableExtension || '-'}
                      </td>
                      <td>
                        <Link
                          href={`/projects/${projectId}/tenants/${encodeURIComponent(
                            tenant.applicationId,
                          )}`}
                          className={buttonClassName('secondary', 'sm')}
                        >
                          Open
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      <Link href="/projects" className={buttonClassName('ghost', 'sm')}>
        Back to projects
      </Link>
    </div>
  );
}
