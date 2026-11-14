import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Alert } from '@/components/ui/alert';
import { StatusBadge } from '@/components/ui/badge';
import { buttonClassName } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ProjectTenantEditForm } from '@/components/projects/project-tenant-edit-form';
import { roleCan } from '@/lib/server/auth/roles';
import { requireServerSession } from '@/lib/server/auth/server-session';
import { getProject } from '@/lib/server/projects/project-service';
import { getProjectTenant } from '@/lib/server/projects/project-data-service';
import type { ProjectTenantSummary } from '@/lib/shared/platform-types';

export const dynamic = 'force-dynamic';

export default async function ProjectTenantPage({
  params,
}: {
  params: Promise<{ projectId: string; tenantId: string }>;
}) {
  const session = await requireServerSession();
  const { projectId, tenantId } = await params;

  const project = await getProject(projectId);
  if (!project) notFound();

  let tenant: ProjectTenantSummary | null = null;
  let readError: string | null = null;
  try {
    tenant = await getProjectTenant(project, tenantId);
  } catch (error) {
    readError = error instanceof Error ? error.message : 'The tenant could not be read.';
  }
  if (!tenant && !readError) notFound();

  const canWriteTenants =
    roleCan(session.role, 'tenant:write') && project.accessMode === 'read-write';

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">
            {project.displayName} / tenant
          </p>
          <h1 className="text-2xl font-semibold text-slate-900">
            {tenant?.displayName ?? tenantId}
          </h1>
          <p className="mt-1 font-mono text-xs text-slate-500">{tenantId}</p>
          {project.accessMode === 'read-only' ? (
            <p className="mt-2">
              <StatusBadge status="unknown" label="Read-only project" />
            </p>
          ) : null}
        </div>
        <Link
          href={`/projects/${project.projectId}/tenants`}
          className={buttonClassName('secondary', 'sm')}
        >
          Back to tenants
        </Link>
      </header>

      {readError ? (
        <Alert tone="danger" title="Could not read the tenant">
          {readError}
        </Alert>
      ) : null}

      {tenant ? (
        <>
          <Card>
            <CardHeader
              title="Tenant details"
              description={`Read directly from project ${project.projectId}. Nothing is stored in the admin project.`}
            />
            <CardBody>
              <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">
                    Tenant id
                  </dt>
                  <dd className="mt-0.5 font-mono text-slate-900">{tenant.tenantId}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">
                    Status
                  </dt>
                  <dd className="mt-0.5">
                    <StatusBadge status={tenant.status} />
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">
                    Source
                  </dt>
                  <dd className="mt-0.5 text-slate-900">{tenant.source}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">
                    Project
                  </dt>
                  <dd className="mt-0.5 font-mono text-slate-900">{project.projectId}</dd>
                </div>
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Edit tenant"
              description={
                canWriteTenants
                  ? 'Changes are written to the managed project.'
                  : 'Your role can read tenants but not modify them.'
              }
            />
            <CardBody>
              {canWriteTenants ? (
                <ProjectTenantEditForm
                  projectId={project.projectId}
                  tenant={tenant}
                  tenantSource={project.tenantSource}
                />
              ) : (
                <p className="text-sm text-slate-500">
                  Owners, admins and operators can edit tenant records.
                </p>
              )}
            </CardBody>
          </Card>
        </>
      ) : null}
    </div>
  );
}
