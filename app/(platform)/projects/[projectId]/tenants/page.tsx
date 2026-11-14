import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Alert } from '@/components/ui/alert';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { buttonClassName } from '@/components/ui/button';
import { Card, CardBody, CardHeader, EmptyState } from '@/components/ui/card';
import { ProjectSwitcher } from '@/components/projects/project-switcher';
import { ProjectAccessForm } from '@/components/projects/project-access-form';
import { ProjectTenantCreateDialog } from '@/components/projects/project-tenant-create-dialog';
import { roleCan } from '@/lib/server/auth/roles';
import { requireServerSession } from '@/lib/server/auth/server-session';
import { getProject, listProjects } from '@/lib/server/projects/project-service';
import { listProjectTenants } from '@/lib/server/projects/project-data-service';
import type { ProjectTenantSummary } from '@/lib/shared/platform-types';

export const dynamic = 'force-dynamic';

export default async function ProjectTenantsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const session = await requireServerSession();
  const { projectId } = await params;

  const [projects, project] = await Promise.all([listProjects(), getProject(projectId)]);
  if (!project) notFound();

  let tenants: ProjectTenantSummary[] = [];
  let readError: string | null = null;
  try {
    tenants = await listProjectTenants(project);
  } catch (error) {
    readError = error instanceof Error ? error.message : 'The project could not be read.';
  }

  const canWriteTenants =
    roleCan(session.role, 'tenant:write') && project.accessMode === 'read-write';
  const canManageProject = roleCan(session.role, 'project:manage');

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">Project</p>
          <h1 className="text-2xl font-semibold text-slate-900">{project.displayName}</h1>
          <p className="mt-1 font-mono text-xs text-slate-500">{project.projectId}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <ProjectSwitcher projects={projects} selectedProjectId={project.projectId} />
          {project.accessMode === 'read-only' ? (
            <Badge tone="neutral">Read-only</Badge>
          ) : null}
          {canWriteTenants && project.status === 'active' ? (
            <ProjectTenantCreateDialog
              projectId={project.projectId}
              tenantSource={project.tenantSource}
            />
          ) : null}
        </div>
      </header>

      {project.status === 'disabled' ? (
        <Alert tone="warning" title="Project disabled">
          Tenant reads and writes are blocked until the project is enabled again.
        </Alert>
      ) : null}

      {readError ? (
        <Alert tone="danger" title="Could not reach the project">
          {readError}
        </Alert>
      ) : null}

      {canManageProject ? (
        <Card>
          <CardHeader
            title="Project access"
            description="The service account's IAM roles must match this setting. Read-only blocks every tenant write."
          />
          <CardBody>
            <ProjectAccessForm
              projectId={project.projectId}
              accessMode={project.accessMode}
            />
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title="Tenants in this project"
          description={`${tenants.length} tenant(s) read from ${
            project.tenantSource === 'identity-platform'
              ? 'Identity Platform'
              : `${project.projectId}/${project.tenantCollection}`
          }.`}
          actions={
            <Badge tone={project.tenantSource === 'identity-platform' ? 'indigo' : 'neutral'}>
              {project.tenantSource === 'identity-platform'
                ? 'Identity Platform'
                : 'Firestore'}
            </Badge>
          }
        />
        <CardBody className="px-0 py-0">
          {readError ? (
            <p className="px-5 py-6 text-sm text-slate-500">
              Fix the project access configuration and reload this page.
            </p>
          ) : tenants.length === 0 ? (
            <div className="px-5 py-6">
              <EmptyState
                title="No tenants in this project"
                description="The tenant collection is empty, or the configured fields do not match the documents."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Tenant</th>
                    <th scope="col">Status</th>
                    <th scope="col">Source</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {tenants.map((tenant) => (
                    <tr key={tenant.tenantId}>
                      <td>
                        <span className="block font-medium text-slate-900">
                          {tenant.displayName}
                        </span>
                        <span className="font-mono text-xs text-slate-500">
                          {tenant.tenantId}
                        </span>
                      </td>
                      <td>
                        <StatusBadge status={tenant.status} />
                      </td>
                      <td className="text-xs text-slate-500">{tenant.source}</td>
                      <td>
                        <Link
                          href={`/projects/${project.projectId}/tenants/${encodeURIComponent(
                            tenant.recordId ?? tenant.tenantId,
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
