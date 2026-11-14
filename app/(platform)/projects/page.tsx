import Link from 'next/link';

import { Badge, StatusBadge } from '@/components/ui/badge';
import { buttonClassName } from '@/components/ui/button';
import { Card, CardBody, CardHeader, EmptyState } from '@/components/ui/card';
import { ProjectCreateDialog } from '@/components/projects/project-create-dialog';
import { formatDateTime } from '@/lib/client/format';
import { roleCan } from '@/lib/server/auth/roles';
import { requireServerSession } from '@/lib/server/auth/server-session';
import { listProjects } from '@/lib/server/projects/project-service';

export const dynamic = 'force-dynamic';

export default async function ProjectsPage() {
  const session = await requireServerSession();
  const projects = await listProjects();
  const canManageProjects = roleCan(session.role, 'project:manage');

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Projects</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">
            Each project is a Firebase/GCP project that contains its own tenants. The admin
            project stores only this registry, never tenant documents.
          </p>
        </div>
        {canManageProjects ? <ProjectCreateDialog /> : null}
      </header>

      <Card>
        <CardHeader
          title="Managed projects"
          description={`${projects.length} project(s) registered.`}
        />
        <CardBody className="px-0 py-0">
          {projects.length === 0 ? (
            <div className="px-5 py-6">
              <EmptyState
                title="No projects registered"
                description="Add the first Firebase project to start reading and managing its tenants."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Project</th>
                    <th scope="col">Tenant source</th>
                    <th scope="col">Access</th>
                    <th scope="col">Status</th>
                    <th scope="col">Updated</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {projects.map((project) => (
                    <tr key={project.projectId}>
                      <td>
                        <span className="block font-medium text-slate-900">
                          {project.displayName}
                        </span>
                        <span className="font-mono text-xs text-slate-500">
                          {project.projectId}
                        </span>
                      </td>
                      <td>
                        <span className="text-sm text-slate-700">
                          {project.tenantSource === 'identity-platform'
                            ? 'Identity Platform'
                            : `Firestore: ${project.tenantCollection}`}
                        </span>
                      </td>
                      <td>
                        <Badge tone={project.accessMode === 'read-write' ? 'warning' : 'neutral'}>
                          {project.accessMode}
                        </Badge>
                      </td>
                      <td>
                        <StatusBadge status={project.status} />
                      </td>
                      <td className="whitespace-nowrap">{formatDateTime(project.updatedAt)}</td>
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
