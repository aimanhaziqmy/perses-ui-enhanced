import type { DashboardResource, ProjectResource } from '@perses-dev/client';

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

export function fetchDashboards(project: string): Promise<DashboardResource[]> {
  return apiGetJson<DashboardResource[]>(`/api/v1/projects/${encodeURIComponent(project)}/dashboards`);
}

export function fetchDashboard(project: string, name: string): Promise<DashboardResource> {
  return apiGetJson<DashboardResource>(
    `/api/v1/projects/${encodeURIComponent(project)}/dashboards/${encodeURIComponent(name)}`,
  );
}

export function createDashboard(project: string, dashboard: DashboardResource): Promise<DashboardResource> {
  return apiSendJson<DashboardResource>(
    `/api/v1/projects/${encodeURIComponent(project)}/dashboards`,
    'POST',
    dashboard,
  );
}

export function updateDashboard(project: string, dashboard: DashboardResource): Promise<DashboardResource> {
  return apiSendJson<DashboardResource>(
    `/api/v1/projects/${encodeURIComponent(project)}/dashboards/${encodeURIComponent(dashboard.metadata.name)}`,
    'PUT',
    dashboard,
  );
}

export function deleteDashboard(project: string, name: string): Promise<void> {
  return apiDelete(
    `/api/v1/projects/${encodeURIComponent(project)}/dashboards/${encodeURIComponent(name)}`,
  );
}

export function unwrapGrafanaDashboard(raw: Record<string, unknown>): Record<string, unknown> {
  const inner = raw.dashboard;
  if (
    inner &&
    typeof inner === 'object' &&
    !Array.isArray(inner) &&
    ('panels' in inner || 'rows' in inner || 'title' in inner || 'schemaVersion' in inner)
  ) {
    return inner as Record<string, unknown>;
  }
  return raw;
}

export function isGrafanaDashboardJson(raw: Record<string, unknown>): boolean {
  if (raw.kind === 'Dashboard') return false;
  const spec = raw.spec;
  if (
    spec &&
    typeof spec === 'object' &&
    !Array.isArray(spec) &&
    'panels' in spec &&
    !Array.isArray((spec as Record<string, unknown>).panels) &&
    'layouts' in spec
  ) {
    return false;
  }
  const candidate = unwrapGrafanaDashboard(raw);
  if (Array.isArray(candidate.panels) || Array.isArray(candidate.rows)) return true;
  if (typeof candidate.schemaVersion === 'number') return true;
  if (candidate.templating && typeof candidate.templating === 'object') return true;
  return false;
}

export function migrateGrafanaDashboard(
  rawGrafanaJson: Record<string, unknown>,
  useDefaultDatasource = true,
): Promise<DashboardResource> {
  return apiSendJson<DashboardResource>('/api/migrate', 'POST', {
    grafanaDashboard: unwrapGrafanaDashboard(rawGrafanaJson),
    useDefaultDatasource,
  });
}

export function countUnsupportedMigratedQueries(dashboard: DashboardResource): number {
  const serialized = JSON.stringify(dashboard.spec?.panels ?? {});
  const matches = serialized.match(/migration_from_grafana_not_supported/g);
  return matches ? matches.length : 0;
}
