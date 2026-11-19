import type {
  DatasourceApi,
  DatasourceResource,
  DatasourceSelector,
  GlobalDatasourceResource,
} from '@perses-dev/client';
import { buildProxyUrl } from '@perses-dev/client';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import { fetchProjects } from './projects';
import {
  ForbiddenError,
  UnauthorizedError,
  apiDelete,
  apiGetJson,
  apiSendJson,
  persesFetchFn,
  toProxyBasePath,
} from '@/lib/api/http';
import { queryKeys } from '@/lib/api/queryKeys';

export function fetchGlobalDatasources(): Promise<GlobalDatasourceResource[]> {
  return apiGetJson<GlobalDatasourceResource[]>('/api/v1/globaldatasources');
}

export function createGlobalDatasource(ds: GlobalDatasourceResource): Promise<GlobalDatasourceResource> {
  return apiSendJson<GlobalDatasourceResource>('/api/v1/globaldatasources', 'POST', ds);
}

export function updateGlobalDatasource(ds: GlobalDatasourceResource): Promise<GlobalDatasourceResource> {
  return apiSendJson<GlobalDatasourceResource>(
    `/api/v1/globaldatasources/${encodeURIComponent(ds.metadata.name)}`,
    'PUT',
    ds,
  );
}

export function deleteGlobalDatasource(name: string): Promise<void> {
  return apiDelete(`/api/v1/globaldatasources/${encodeURIComponent(name)}`);
}

export function fetchProjectDatasources(project: string): Promise<DatasourceResource[]> {
  return apiGetJson<DatasourceResource[]>(`/api/v1/projects/${encodeURIComponent(project)}/datasources`);
}

export function createProjectDatasource(project: string, ds: DatasourceResource): Promise<DatasourceResource> {
  return apiSendJson<DatasourceResource>(
    `/api/v1/projects/${encodeURIComponent(project)}/datasources`,
    'POST',
    ds,
  );
}

export function updateProjectDatasource(project: string, ds: DatasourceResource): Promise<DatasourceResource> {
  return apiSendJson<DatasourceResource>(
    `/api/v1/projects/${encodeURIComponent(project)}/datasources/${encodeURIComponent(ds.metadata.name)}`,
    'PUT',
    ds,
  );
}

export function deleteProjectDatasource(project: string, name: string): Promise<void> {
  return apiDelete(
    `/api/v1/projects/${encodeURIComponent(project)}/datasources/${encodeURIComponent(name)}`,
  );
}

export interface DatasourceTarget {
  scope: 'global' | 'project';
  project?: string;
  name: string;
  displayName: string;
  pluginKind: string;
  isDefault: boolean;
  proxyUrl?: string;
}

function extractProxyUrl(spec: { plugin?: { spec?: unknown } }): string | undefined {
  const pluginSpec = spec.plugin?.spec as { proxy?: { spec?: { url?: string } }; directUrl?: string } | undefined;
  return pluginSpec?.proxy?.spec?.url ?? pluginSpec?.directUrl;
}

export async function fetchAllDatasourceTargets(): Promise<DatasourceTarget[]> {
  const results: DatasourceTarget[] = [];

  try {
    const globals = await fetchGlobalDatasources();
    for (const ds of globals) {
      results.push({
        scope: 'global',
        name: ds.metadata.name,
        displayName: ds.spec.display?.name || ds.metadata.name,
        pluginKind: ds.spec.plugin.kind,
        isDefault: Boolean(ds.spec.default),
        proxyUrl: extractProxyUrl(ds.spec),
      });
    }
  } catch (err) {
    if (err instanceof UnauthorizedError) throw err;
  }

  try {
    const projects = await fetchProjects();
    const perProject = await Promise.all(
      projects.map(async (p) => {
        try {
          return await fetchProjectDatasources(p.metadata.name);
        } catch {
          return [];
        }
      }),
    );
    for (const list of perProject) {
      for (const ds of list) {
        results.push({
          scope: 'project',
          project: ds.metadata.project,
          name: ds.metadata.name,
          displayName: ds.spec.display?.name || ds.metadata.name,
          pluginKind: ds.spec.plugin.kind,
          isDefault: Boolean(ds.spec.default),
          proxyUrl: extractProxyUrl(ds.spec),
        });
      }
    }
  } catch (err) {
    if (err instanceof UnauthorizedError) throw err;
  }

  return results.sort((a, b) => {
    if (a.scope !== b.scope) return a.scope === 'global' ? -1 : 1;
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export function useDatasourceTargets(pluginKind?: string) {
  const query = useQuery<DatasourceTarget[], Error>({
    queryKey: queryKeys.allDatasourceTargets,
    queryFn: fetchAllDatasourceTargets,
  });

  const targets = useMemo(() => {
    const list = query.data ?? [];
    if (!pluginKind) return list;
    return list.filter((t) => t.pluginKind === pluginKind);
  }, [query.data, pluginKind]);

  const defaultTarget = useMemo(() => targets.find((t) => t.isDefault) ?? targets[0] ?? null, [targets]);

  return {
    ...query,
    targets,
    defaultTarget,
  };
}

export function resolveDatasourceTarget(
  targets: DatasourceTarget[],
  pluginKind: string,
  preferredKey?: string,
): DatasourceTarget | null {
  const matching = targets.filter((t) => t.pluginKind === pluginKind);
  if (matching.length === 0) return null;
  if (preferredKey) {
    const exact = matching.find((t) => datasourceTargetKey(t) === preferredKey || t.name === preferredKey);
    if (exact) return exact;
  }
  return matching.find((t) => t.isDefault) ?? matching[0];
}

export function datasourceTargetKey(t: Pick<DatasourceTarget, 'scope' | 'project' | 'name'>): string {
  return t.scope === 'project' ? `project:${t.project ?? ''}:${t.name}` : `global:${t.name}`;
}

export interface DatasourceProbeResult {
  key: string;
  name: string;
  scope: 'global' | 'project';
  project?: string;
  kind: string;
  ok: boolean;
  statusCode: number;
  latencyMs: number;
  detail: string;
}

export async function probeDatasource(
  ds: GlobalDatasourceResource | DatasourceResource,
): Promise<DatasourceProbeResult> {
  const isProject = ds.kind === 'Datasource';
  const project = isProject ? ds.metadata.project : undefined;
  const name = ds.metadata.name;
  const kind = ds.spec.plugin.kind;
  const scope: 'global' | 'project' = isProject ? 'project' : 'global';
  const key = datasourceTargetKey({ scope, project, name });
  const basePath = toProxyBasePath({ scope, project, name });
  const started = performance.now();

  if (kind === 'PrometheusDatasource') {
    const url = `${basePath}/api/v1/status/buildinfo`;
    const res = await persesFetchFn(url, { credentials: 'include' });
    const latencyMs = Math.round(performance.now() - started);
    const text = await res.text();
    if (!res.ok) {
      return { key, name, scope, project, kind, ok: false, statusCode: res.status, latencyMs, detail: text || res.statusText };
    }
    return { key, name, scope, project, kind, ok: true, statusCode: res.status, latencyMs, detail: text };
  }

  if (kind === 'VictoriaLogsDatasource') {
    const url = `${basePath}/select/logsql/query?query=*&limit=1`;
    const res = await persesFetchFn(url, { credentials: 'include' });
    const latencyMs = Math.round(performance.now() - started);
    const text = await res.text();
    if (!res.ok) {
      return { key, name, scope, project, kind, ok: false, statusCode: res.status, latencyMs, detail: text || res.statusText };
    }
    return {
      key,
      name,
      scope,
      project,
      kind,
      ok: true,
      statusCode: res.status,
      latencyMs,
      detail: text.trim() || 'Connected (0 matching records in latest slice)',
    };
  }

  if (kind === 'JaegerDatasource') {
    let res = await persesFetchFn(`${basePath}/api/services`, { credentials: 'include' });
    if (res.status === 404) {
      res = await persesFetchFn(`${basePath}/api/v3/services`, { credentials: 'include' });
    }
    const latencyMs = Math.round(performance.now() - started);
    const text = await res.text();
    if (!res.ok) {
      return { key, name, scope, project, kind, ok: false, statusCode: res.status, latencyMs, detail: text || res.statusText };
    }
    return { key, name, scope, project, kind, ok: true, statusCode: res.status, latencyMs, detail: text };
  }

  if (kind === 'TempoDatasource') {
    const url = `${basePath}/api/search?limit=1`;
    const res = await persesFetchFn(url, { credentials: 'include' });
    const latencyMs = Math.round(performance.now() - started);
    const text = await res.text();
    if (!res.ok) {
      return { key, name, scope, project, kind, ok: false, statusCode: res.status, latencyMs, detail: text || res.statusText };
    }
    return { key, name, scope, project, kind, ok: true, statusCode: res.status, latencyMs, detail: text };
  }

  const latencyMs = Math.round(performance.now() - started);
  return {
    key,
    name,
    scope,
    project,
    kind,
    ok: false,
    statusCode: 0,
    latencyMs,
    detail: `Live probe is only built-in for PrometheusDatasource, VictoriaLogsDatasource, JaegerDatasource, and TempoDatasource (plugin kind: ${kind}).`,
  };
}

export function probeGlobalDatasource(ds: GlobalDatasourceResource): Promise<DatasourceProbeResult> {
  return probeDatasource(ds);
}

async function safeFetchGlobalDatasources(): Promise<GlobalDatasourceResource[]> {
  try {
    return await fetchGlobalDatasources();
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return [];
    }
    throw err;
  }
}

export function usePersesDatasourceApi(projectName?: string): DatasourceApi {
  const { data: globalDatasources } = useQuery<GlobalDatasourceResource[]>({
    queryKey: queryKeys.globalDatasources,
    queryFn: safeFetchGlobalDatasources,
  });

  const { data: projectDatasources } = useQuery<DatasourceResource[]>({
    queryKey: projectName ? queryKeys.projectDatasources(projectName) : ['perses', 'datasources', undefined],
    queryFn: () => fetchProjectDatasources(projectName!),
    enabled: Boolean(projectName),
  });

  const getDatasource = useCallback(
    async (project: string, selector: DatasourceSelector) => {
      const list = project === projectName ? projectDatasources : await fetchProjectDatasources(project);
      return (list ?? []).find((ds) => {
        if (ds.metadata.project !== project) return false;
        if (ds.spec.plugin.kind !== selector.kind) return false;
        if (!selector.name) return Boolean(ds.spec.default);
        return ds.metadata.name.toLowerCase() === selector.name.toLowerCase();
      });
    },
    [projectDatasources, projectName],
  );

  const getGlobalDatasource = useCallback(
    async (selector: DatasourceSelector) => {
      const list = globalDatasources ?? (await safeFetchGlobalDatasources());
      return list.find((ds) => {
        if (ds.spec.plugin.kind !== selector.kind) return false;
        if (!selector.name) return Boolean(ds.spec.default);
        return ds.metadata.name.toLowerCase() === selector.name.toLowerCase();
      });
    },
    [globalDatasources],
  );

  const listDatasources = useCallback(
    async (project: string, pluginKind?: string) => {
      const list = project === projectName ? projectDatasources : await fetchProjectDatasources(project);
      return (list ?? []).filter((ds) => {
        if (ds.metadata.project !== project) return false;
        if (pluginKind && ds.spec.plugin.kind !== pluginKind) return false;
        return true;
      });
    },
    [projectDatasources, projectName],
  );

  const listGlobalDatasources = useCallback(
    async (pluginKind?: string) => {
      const list = globalDatasources ?? (await safeFetchGlobalDatasources());
      return list.filter((ds) => (!pluginKind ? true : ds.spec.plugin.kind === pluginKind));
    },
    [globalDatasources],
  );

  return useMemo(
    () => ({
      getDatasource,
      getGlobalDatasource,
      listDatasources,
      listGlobalDatasources,
      buildProxyUrl,
    }),
    [getDatasource, getGlobalDatasource, listDatasources, listGlobalDatasources],
  );
}
