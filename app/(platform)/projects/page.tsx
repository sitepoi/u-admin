import Link from 'next/link';

import { Alert } from '@/components/ui/alert';
import { buttonClassName } from '@/components/ui/button';
import { Card, CardBody, CardHeader, EmptyState } from '@/components/ui/card';
import { requireServerSession } from '@/lib/server/auth/server-session';
import { listRelayProjects } from '@/lib/server/relay/relay-client';
import type { RelayProjectSummary } from '@/lib/shared/platform-types';

export const dynamic = 'force-dynamic';

export default async function ProjectsPage() {
  await requireServerSession();

  let projects: RelayProjectSummary[] = [];
  let readError: string | null = null;
  try {
    projects = await listRelayProjects();
  } catch (error) {
    readError = error instanceof Error ? error.message : 'The relay could not be read.';
  }

  const tenantCount = projects.reduce((total, project) => total + project.tenantCount, 0);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Projects</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">
          Projects are derived from the sitepoi-relay <code>applications</code> registry. A project
          exists as the <code>projectId</code> inside each application's decoded Firebase settings.
          There is no projects collection, no tenants collection, and no manual registry.
        </p>
      </header>

      {readError ? (
        <Alert tone="danger" title="Could not read sitepoi-relay">
          {readError}
        </Alert>
      ) : null}

      <Card>
        <CardHeader
          title="Projects in the relay"
          description={`${projects.length} project(s), ${tenantCount} tenant(s). Read-only.`}
        />
        <CardBody className="px-0 py-0">
          {readError ? (
            <p className="px-5 py-6 text-sm text-slate-500">
              Check <code>PLATFORM_PROJECTS_SERVICE_ACCOUNT_JSON</code> and the service account's
              read role on the relay project.
            </p>
          ) : projects.length === 0 ? (
            <div className="px-5 py-6">
              <EmptyState
                title="No applications found"
                description="The relay applications collection is empty, or the service account cannot read it."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Project id</th>
                    <th scope="col">Tenants</th>
                    <th scope="col">Hostnames</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {projects.map((project) => (
                    <tr key={project.projectId}>
                      <td className="font-mono text-xs text-slate-900">{project.projectId}</td>
                      <td className="text-sm text-slate-700">{project.tenantCount}</td>
                      <td className="text-sm text-slate-700">{project.hostCount}</td>
                      <td>
                        <Link
                          href={`/projects/${project.projectId}/tenants`}
                          className={buttonClassName('secondary', 'sm')}
                        >
                          Open tenants
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
    </div>
  );
}
