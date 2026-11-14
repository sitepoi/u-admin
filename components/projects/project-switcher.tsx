'use client';

import { useRouter } from 'next/navigation';

interface ProjectOption {
  projectId: string;
  displayName: string;
}

export function ProjectSwitcher({
  projects,
  selectedProjectId,
}: {
  projects: ProjectOption[];
  selectedProjectId: string;
}) {
  const router = useRouter();

  return (
    <label className="flex items-center gap-2 text-sm text-slate-600">
      <span className="whitespace-nowrap font-medium">Project</span>
      <select
        value={selectedProjectId}
        onChange={(event) => router.push(`/projects/${event.target.value}/tenants`)}
        className="rounded-md border-0 bg-white px-3 py-1.5 text-sm text-slate-900 shadow-sm ring-1 ring-slate-300 ring-inset focus:ring-2 focus:ring-indigo-600"
      >
        {projects.map((project) => (
          <option key={project.projectId} value={project.projectId}>
            {project.displayName} ({project.projectId})
          </option>
        ))}
      </select>
    </label>
  );
}
