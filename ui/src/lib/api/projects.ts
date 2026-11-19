import type { ProjectResource } from '@perses-dev/client';

import { apiDelete, apiGetJson, apiSendJson } from './http';

export function fetchProjects(): Promise<ProjectResource[]> {
  return apiGetJson<ProjectResource[]>('/api/v1/projects');
}

export function createProject(project: ProjectResource): Promise<ProjectResource> {
  return apiSendJson<ProjectResource>('/api/v1/projects', 'POST', project);
}

export function deleteProject(name: string): Promise<void> {
  return apiDelete(`/api/v1/projects/${encodeURIComponent(name)}`);
}
