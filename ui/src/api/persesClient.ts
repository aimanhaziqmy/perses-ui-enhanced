import type {
  DashboardResource,
  DatasourceApi,
  DatasourceResource,
  DatasourceSelector,
  GlobalDatasourceResource,
  ProjectResource,
  RoleBindingResource,
  RoleResource,
} from '@perses-dev/client';
import { buildProxyUrl, fetch as persesFetch, fetchJson } from '@perses-dev/client';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

export interface PersesHealthResponse {
  buildTime?: string;
  version?: string;
  commit?: string;
  database?: boolean;
}

export interface PersesAuthProviderSummary {
  slug_id: string;
  name: string;
  auth_url?: string;
  issuer?: string;
}

export interface PersesFrontendConfig {
  security?: {
    enable_auth?: boolean;
    readonly?: boolean;
    authentication?: {
      disable_sign_up?: boolean;
      providers?: {
        enable_native?: boolean;
        oauth?: PersesAuthProviderSummary[];
        oidc?: PersesAuthProviderSummary[];
      };
    };
  };
  frontend?: {
    explorer?: { enable?: boolean };
    information?: string;
  };
}

export interface PersesUserResource {
  kind: 'User';
  metadata: {
    name: string;
    createdAt?: string;
    updatedAt?: string;
    version?: number;
  };
  spec?: {
    firstName?: string;
    lastName?: string;
    nativeProvider?: {
      password?: string;
    };
    oauthProviders?: Array<{
      issuer?: string;
      email?: string;
      subject?: string;
    }>;
  };
}

export interface PersesPermission {
  actions: string[];
  scopes: string[];
}

export interface PersesGlobalRoleResource {
  kind: 'GlobalRole';
  metadata: {
    name: string;
    createdAt?: string;
    updatedAt?: string;
  };
  spec: {
    permissions: PersesPermission[];
  };
}

export interface PersesGlobalRoleBindingResource {
  kind: 'GlobalRoleBinding';
  metadata: {
    name: string;
    createdAt?: string;
    updatedAt?: string;
  };
  spec: {
    role: string;
    subjects: Array<{
      kind: 'User';
      name: string;
    }>;
  };
}

export interface PersesPluginModuleResource {
  kind?: string;
  metadata?: {
    name?: string;
    version?: string;
  };
  spec?: {
    plugins?: Array<{
      kind?: string;
      spec?: {
        name?: string;
        display?: {
          name?: string;
          description?: string;
        };
      };
    }>;
  };
}

export class UnauthorizedError extends Error {
  readonly status = 401;
  constructor(message = 'Authentication required') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends Error {
  readonly status = 403;
  constructor(message = 'Permission denied (403 Forbidden)') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

const CURRENT_USER_STORAGE_KEY = 'perses-current-user';

function decodeBase64UrlJson(segment: string): Record<string, unknown> | null {
  try {
    const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const jsonText = new TextDecoder().decode(bytes);
    const parsed = JSON.parse(jsonText) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function getCurrentPersesUsername(): string {
  if (typeof document !== 'undefined') {
    try {
      const cookies = document.cookie.split(';').map((c) => c.trim());
      const payloadCookie = cookies.find((c) => c.startsWith('jwtPayload='));
      if (payloadCookie) {
        const raw = decodeURIComponent(payloadCookie.slice('jwtPayload='.length)).replace(/^"|"$/g, '');
        const parts = raw.split('.');
        const candidate = parts.length >= 2 ? parts[1] : parts[0];
        const decoded = decodeBase64UrlJson(candidate);
        const sub = decoded?.sub ?? decoded?.preferred_username ?? decoded?.username ?? decoded?.name;
        if (typeof sub === 'string' && sub.trim()) {
          return sub.trim();
        }
      }
    } catch {
      // Ignore cookie parse errors and fall back to session cache
    }
  }
  try {
    const stored = window.sessionStorage.getItem(CURRENT_USER_STORAGE_KEY);
    if (stored && stored.trim()) {
      return stored.trim();
    }
  } catch {
    // Ignore storage read errors
  }
  return 'guest';
}

async function throwForBadResponse(res: Response, url: string): Promise<never> {
  if (res.status === 401) {
    throw new UnauthorizedError('Perses session expired or unauthenticated');
  }
  const body = await res.text();
  if (res.status === 403) {
    throw new ForbiddenError(`Permission denied (403): ${body || 'Your role lacks permission for this action.'}`);
  }
  throw new Error(`HTTP ${res.status} from ${url}: ${body || res.statusText}`);
}

async function apiGetJson<T>(url: string): Promise<T> {
  const res = await persesFetch(url, {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    await throwForBadResponse(res, url);
  }
  return (await res.json()) as T;
}

async function apiSendJson<T>(url: string, method: 'POST' | 'PUT', payload: unknown): Promise<T> {
  const res = await persesFetch(url, {
    method,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    await throwForBadResponse(res, url);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

async function apiDelete(url: string): Promise<void> {
  const res = await persesFetch(url, {
    method: 'DELETE',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    await throwForBadResponse(res, url);
  }
}

export function fetchPersesHealth(): Promise<PersesHealthResponse> {
  return apiGetJson<PersesHealthResponse>('/api/v1/health');
}

export function fetchPersesConfig(): Promise<PersesFrontendConfig> {
  return apiGetJson<PersesFrontendConfig>('/api/v1/config');
}

export async function loginNative(login: string, password: string): Promise<void> {
  await fetchJson<void>('/api/auth/providers/native/login', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ login, password }),
  });
  try {
    window.sessionStorage.setItem(CURRENT_USER_STORAGE_KEY, login);
  } catch {
    // Ignore storage errors
  }
}

export async function refreshAuthSession(): Promise<boolean> {
  const res = await globalThis.fetch('/api/auth/refresh', {
    method: 'POST',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  return res.ok;
}

export async function logoutPerses(): Promise<void> {
  try {
    window.sessionStorage.removeItem(CURRENT_USER_STORAGE_KEY);
  } catch {
    // Ignore storage errors
  }
  await globalThis.fetch('/api/auth/logout', {
    method: 'GET',
    credentials: 'include',
  });
}

// -----------------------------------------------------------------------------
// Projects & Dashboards CRUD
// -----------------------------------------------------------------------------

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

// -----------------------------------------------------------------------------
// Global & Project Datasources CRUD + Dynamic Discovery
// -----------------------------------------------------------------------------

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

export function buildProxyBasePath(target: Pick<DatasourceTarget, 'scope' | 'project' | 'name'>): string {
  if (target.scope === 'project' && target.project) {
    return `/proxy/projects/${encodeURIComponent(target.project)}/datasources/${encodeURIComponent(target.name)}`;
  }
  return `/proxy/globaldatasources/${encodeURIComponent(target.name)}`;
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
    // Ignore 403 on global datasources if user only has project access
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
    queryKey: ['perses', 'all-datasource-targets'],
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
  const basePath = buildProxyBasePath({ scope, project, name });
  const started = performance.now();

  if (kind === 'PrometheusDatasource') {
    const url = `${basePath}/api/v1/status/buildinfo`;
    const res = await globalThis.fetch(url, { credentials: 'include' });
    const latencyMs = Math.round(performance.now() - started);
    const text = await res.text();
    if (!res.ok) {
      return { key, name, scope, project, kind, ok: false, statusCode: res.status, latencyMs, detail: text || res.statusText };
    }
    return { key, name, scope, project, kind, ok: true, statusCode: res.status, latencyMs, detail: text };
  }

  if (kind === 'VictoriaLogsDatasource') {
    const url = `${basePath}/select/logsql/query?query=*&limit=1`;
    const res = await globalThis.fetch(url, { credentials: 'include' });
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
    detail: `Live probe is only built-in for PrometheusDatasource and VictoriaLogsDatasource (plugin kind: ${kind}).`,
  };
}

export function probeGlobalDatasource(ds: GlobalDatasourceResource): Promise<DatasourceProbeResult> {
  return probeDatasource(ds);
}

// -----------------------------------------------------------------------------
// Users, GlobalRoles, GlobalRoleBindings, Project Roles & RoleBindings CRUD
// -----------------------------------------------------------------------------

export function fetchPersesUsers(): Promise<PersesUserResource[]> {
  return apiGetJson<PersesUserResource[]>('/api/v1/users');
}

export function createPersesUser(user: PersesUserResource): Promise<PersesUserResource> {
  return apiSendJson<PersesUserResource>('/api/v1/users', 'POST', user);
}

export function updatePersesUser(user: PersesUserResource): Promise<PersesUserResource> {
  return apiSendJson<PersesUserResource>(
    `/api/v1/users/${encodeURIComponent(user.metadata.name)}`,
    'PUT',
    user,
  );
}

export function deletePersesUser(name: string): Promise<void> {
  return apiDelete(`/api/v1/users/${encodeURIComponent(name)}`);
}

export function fetchPersesGlobalRoles(): Promise<PersesGlobalRoleResource[]> {
  return apiGetJson<PersesGlobalRoleResource[]>('/api/v1/globalroles');
}

export function createPersesGlobalRole(role: PersesGlobalRoleResource): Promise<PersesGlobalRoleResource> {
  return apiSendJson<PersesGlobalRoleResource>('/api/v1/globalroles', 'POST', role);
}

export function updatePersesGlobalRole(role: PersesGlobalRoleResource): Promise<PersesGlobalRoleResource> {
  return apiSendJson<PersesGlobalRoleResource>(
    `/api/v1/globalroles/${encodeURIComponent(role.metadata.name)}`,
    'PUT',
    role,
  );
}

export function deletePersesGlobalRole(name: string): Promise<void> {
  return apiDelete(`/api/v1/globalroles/${encodeURIComponent(name)}`);
}

export function fetchPersesGlobalRoleBindings(): Promise<PersesGlobalRoleBindingResource[]> {
  return apiGetJson<PersesGlobalRoleBindingResource[]>('/api/v1/globalrolebindings');
}

export function createPersesGlobalRoleBinding(
  binding: PersesGlobalRoleBindingResource,
): Promise<PersesGlobalRoleBindingResource> {
  return apiSendJson<PersesGlobalRoleBindingResource>('/api/v1/globalrolebindings', 'POST', binding);
}

export function updatePersesGlobalRoleBinding(
  binding: PersesGlobalRoleBindingResource,
): Promise<PersesGlobalRoleBindingResource> {
  return apiSendJson<PersesGlobalRoleBindingResource>(
    `/api/v1/globalrolebindings/${encodeURIComponent(binding.metadata.name)}`,
    'PUT',
    binding,
  );
}

export function deletePersesGlobalRoleBinding(name: string): Promise<void> {
  return apiDelete(`/api/v1/globalrolebindings/${encodeURIComponent(name)}`);
}

export function fetchProjectRoles(project: string): Promise<RoleResource[]> {
  return apiGetJson<RoleResource[]>(`/api/v1/projects/${encodeURIComponent(project)}/roles`);
}

export function createProjectRole(project: string, role: RoleResource): Promise<RoleResource> {
  return apiSendJson<RoleResource>(`/api/v1/projects/${encodeURIComponent(project)}/roles`, 'POST', role);
}

export function updateProjectRole(project: string, role: RoleResource): Promise<RoleResource> {
  return apiSendJson<RoleResource>(
    `/api/v1/projects/${encodeURIComponent(project)}/roles/${encodeURIComponent(role.metadata.name)}`,
    'PUT',
    role,
  );
}

export function deleteProjectRole(project: string, name: string): Promise<void> {
  return apiDelete(
    `/api/v1/projects/${encodeURIComponent(project)}/roles/${encodeURIComponent(name)}`,
  );
}

export function fetchProjectRoleBindings(project: string): Promise<RoleBindingResource[]> {
  return apiGetJson<RoleBindingResource[]>(`/api/v1/projects/${encodeURIComponent(project)}/rolebindings`);
}

export function createProjectRoleBinding(
  project: string,
  binding: RoleBindingResource,
): Promise<RoleBindingResource> {
  return apiSendJson<RoleBindingResource>(
    `/api/v1/projects/${encodeURIComponent(project)}/rolebindings`,
    'POST',
    binding,
  );
}

export function updateProjectRoleBinding(
  project: string,
  binding: RoleBindingResource,
): Promise<RoleBindingResource> {
  return apiSendJson<RoleBindingResource>(
    `/api/v1/projects/${encodeURIComponent(project)}/rolebindings/${encodeURIComponent(binding.metadata.name)}`,
    'PUT',
    binding,
  );
}

export function deleteProjectRoleBinding(project: string, name: string): Promise<void> {
  return apiDelete(
    `/api/v1/projects/${encodeURIComponent(project)}/rolebindings/${encodeURIComponent(name)}`,
  );
}

export async function assignUserGlobalRoles(
  username: string,
  desiredRoles: string[],
  existingBindings?: PersesGlobalRoleBindingResource[],
): Promise<void> {
  const bindings = existingBindings ?? (await fetchPersesGlobalRoleBindings());
  const desiredSet = new Set(desiredRoles);

  // Remove user from bindings whose role is no longer desired
  for (const b of bindings) {
    const hasUser = (b.spec.subjects ?? []).some((s) => s.kind === 'User' && s.name === username);
    if (hasUser && !desiredSet.has(b.spec.role)) {
      const nextSubjects = (b.spec.subjects ?? []).filter((s) => !(s.kind === 'User' && s.name === username));
      if (nextSubjects.length === 0) {
        await deletePersesGlobalRoleBinding(b.metadata.name);
      } else {
        await updatePersesGlobalRoleBinding({
          ...b,
          spec: { ...b.spec, subjects: nextSubjects },
        });
      }
    }
  }

  // Ensure user is present on each desired role's binding
  for (const roleName of desiredSet) {
    const matching = bindings.filter((b) => b.spec.role === roleName);
    const alreadyAssigned = matching.some((b) =>
      (b.spec.subjects ?? []).some((s) => s.kind === 'User' && s.name === username),
    );
    if (alreadyAssigned) continue;

    if (matching.length > 0) {
      const target = matching[0];
      await updatePersesGlobalRoleBinding({
        ...target,
        spec: {
          ...target.spec,
          subjects: [...(target.spec.subjects ?? []), { kind: 'User', name: username }],
        },
      });
    } else {
      const baseName = roleName.toLowerCase().replace(/[^a-z0-9-_]/g, '-') || 'role';
      const candidateName = bindings.some((b) => b.metadata.name === baseName)
        ? `${baseName}-${Date.now()}`
        : baseName;
      await createPersesGlobalRoleBinding({
        kind: 'GlobalRoleBinding',
        metadata: { name: candidateName },
        spec: {
          role: roleName,
          subjects: [{ kind: 'User', name: username }],
        },
      });
    }
  }
}

export async function assignUserProjectRoles(
  project: string,
  username: string,
  desiredRoles: string[],
  existingBindings?: RoleBindingResource[],
): Promise<void> {
  const bindings = existingBindings ?? (await fetchProjectRoleBindings(project));
  const desiredSet = new Set(desiredRoles);

  for (const b of bindings) {
    const hasUser = (b.spec.subjects ?? []).some((s) => s.kind === 'User' && s.name === username);
    if (hasUser && !desiredSet.has(b.spec.role)) {
      const nextSubjects = (b.spec.subjects ?? []).filter((s) => !(s.kind === 'User' && s.name === username));
      if (nextSubjects.length === 0) {
        await deleteProjectRoleBinding(project, b.metadata.name);
      } else {
        await updateProjectRoleBinding(project, {
          ...b,
          spec: { ...b.spec, subjects: nextSubjects },
        });
      }
    }
  }

  for (const roleName of desiredSet) {
    const matching = bindings.filter((b) => b.spec.role === roleName);
    const alreadyAssigned = matching.some((b) =>
      (b.spec.subjects ?? []).some((s) => s.kind === 'User' && s.name === username),
    );
    if (alreadyAssigned) continue;

    if (matching.length > 0) {
      const target = matching[0];
      await updateProjectRoleBinding(project, {
        ...target,
        spec: {
          ...target.spec,
          subjects: [...(target.spec.subjects ?? []), { kind: 'User', name: username }],
        },
      });
    } else {
      const baseName = roleName.toLowerCase().replace(/[^a-z0-9-_]/g, '-') || 'role';
      const candidateName = bindings.some((b) => b.metadata.name === baseName)
        ? `${baseName}-${Date.now()}`
        : baseName;
      await createProjectRoleBinding(project, {
        kind: 'RoleBinding',
        metadata: { name: candidateName, project },
        spec: {
          role: roleName,
          subjects: [{ kind: 'User', name: username }],
        },
      });
    }
  }
}

export function fetchPersesPlugins(): Promise<PersesPluginModuleResource[]> {
  return apiGetJson<PersesPluginModuleResource[]>('/api/v1/plugins');
}

// -----------------------------------------------------------------------------
// Prometheus / VictoriaMetrics Instant & Cluster Host Telemetry Queries
// -----------------------------------------------------------------------------

export interface PrometheusVectorSample {
  metric: Record<string, string>;
  value: [number, string];
}

interface PrometheusQueryResponse {
  status: 'success' | 'error';
  error?: string;
  data?: {
    resultType?: string;
    result?: PrometheusVectorSample[];
  };
}

function toProxyBasePath(target: DatasourceTarget | string): string {
  if (typeof target === 'string') {
    return `/proxy/globaldatasources/${encodeURIComponent(target)}`;
  }
  return buildProxyBasePath(target);
}

export async function queryPrometheusInstant(
  expr: string,
  target: DatasourceTarget | string,
): Promise<PrometheusVectorSample[]> {
  const params = new URLSearchParams({ query: expr });
  const basePath = toProxyBasePath(target);
  const url = `${basePath}/api/v1/query?${params.toString()}`;
  const res = await globalThis.fetch(url, {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  if (res.status === 401) {
    throw new UnauthorizedError('Session expired while querying metrics datasource');
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Metrics datasource HTTP ${res.status}: ${body || res.statusText}`);
  }
  const payload = (await res.json()) as PrometheusQueryResponse;
  if (payload.status !== 'success') {
    throw new Error(payload.error || 'Metrics query failed');
  }
  return payload.data?.result ?? [];
}

export interface LiveHostGpuInfo {
  model: string;
  utilizationPct: number | null;
  temperatureC: number | null;
}

export interface LiveHostRecord {
  hostname: string;
  ip: string;
  os: string;
  arch: string;
  cores: number;
  online: boolean;
  kubeletVersion: string;
  kernelVersion: string;
  osImage: string;
  memoryPct: number | null;
  memoryTotalBytes: number | null;
  cpuPct: number | null;
  uptimeSeconds: number | null;
  roles: string[];
  gpus: LiveHostGpuInfo[];
  tags: string[];
  groups: string[];
}

function parseNumericSample(sample: PrometheusVectorSample | undefined): number | null {
  if (!sample) return null;
  const val = Number(sample.value?.[1]);
  return Number.isFinite(val) ? val : null;
}

function resolveSampleNode(metric: Record<string, string>): string {
  return metric.node || metric.nodename || metric.Hostname || metric.instance?.split(':')[0] || '';
}

export async function fetchLiveClusterHosts(target: DatasourceTarget | string): Promise<LiveHostRecord[]> {
  const [
    kubeNodeInfo,
    kubeNodeRoles,
    unameInfo,
    cpuCores,
    cpuUsage,
    memUsage,
    memTotal,
    uptimeSamples,
    nodeUp,
    gpuUtil,
    gpuTemp,
  ] = await Promise.all([
    queryPrometheusInstant('kube_node_info', target),
    queryPrometheusInstant('kube_node_role', target),
    queryPrometheusInstant('node_uname_info', target),
    queryPrometheusInstant('count by (node, instance) (node_cpu_seconds_total{mode="idle"})', target),
    queryPrometheusInstant(
      '100 - (avg by (node, instance) (rate(node_cpu_seconds_total{mode="idle"}[2m])) * 100)',
      target,
    ),
    queryPrometheusInstant('100 * (1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes))', target),
    queryPrometheusInstant('node_memory_MemTotal_bytes', target),
    queryPrometheusInstant('time() - node_boot_time_seconds', target),
    queryPrometheusInstant('up{job="node-exporter"}', target),
    queryPrometheusInstant('DCGM_FI_DEV_GPU_UTIL', target),
    queryPrometheusInstant('DCGM_FI_DEV_GPU_TEMP', target),
  ]);

  const map = new Map<string, LiveHostRecord>();

  const ensureHost = (name: string): LiveHostRecord => {
    const existing = map.get(name);
    if (existing) return existing;
    const created: LiveHostRecord = {
      hostname: name,
      ip: '-',
      os: 'linux',
      arch: '-',
      cores: 0,
      online: false,
      kubeletVersion: '-',
      kernelVersion: '-',
      osImage: '-',
      memoryPct: null,
      memoryTotalBytes: null,
      cpuPct: null,
      uptimeSeconds: null,
      roles: [],
      gpus: [],
      tags: [],
      groups: ['Kubernetes Cluster - Core Infrastructure'],
    };
    map.set(name, created);
    return created;
  };

  for (const s of kubeNodeInfo) {
    const name = s.metric.node;
    if (!name) continue;
    const host = ensureHost(name);
    host.ip = s.metric.internal_ip || host.ip;
    host.kubeletVersion = s.metric.kubelet_version || host.kubeletVersion;
    host.kernelVersion = s.metric.kernel_version || host.kernelVersion;
    host.osImage = s.metric.os_image || host.osImage;
    host.online = true;
  }

  for (const s of kubeNodeRoles) {
    const name = s.metric.node;
    const role = s.metric.role;
    if (!name || !role) continue;
    const host = ensureHost(name);
    if (!host.roles.includes(role)) {
      host.roles.push(role);
    }
  }

  for (const s of unameInfo) {
    const name = resolveSampleNode(s.metric);
    if (!name) continue;
    const host = ensureHost(name);
    host.os = (s.metric.sysname || 'linux').toLowerCase();
    host.arch = s.metric.machine || host.arch;
    if (host.kernelVersion === '-' && s.metric.release) {
      host.kernelVersion = s.metric.release;
    }
  }

  for (const s of cpuCores) {
    const name = resolveSampleNode(s.metric);
    const val = parseNumericSample(s);
    if (!name || val === null) continue;
    ensureHost(name).cores = Math.round(val);
  }

  for (const s of cpuUsage) {
    const name = resolveSampleNode(s.metric);
    const val = parseNumericSample(s);
    if (!name || val === null) continue;
    ensureHost(name).cpuPct = Math.max(0, Math.min(100, val));
  }

  for (const s of memUsage) {
    const name = resolveSampleNode(s.metric);
    const val = parseNumericSample(s);
    if (!name || val === null) continue;
    ensureHost(name).memoryPct = Math.max(0, Math.min(100, val));
  }

  for (const s of memTotal) {
    const name = resolveSampleNode(s.metric);
    const val = parseNumericSample(s);
    if (!name || val === null) continue;
    ensureHost(name).memoryTotalBytes = val;
  }

  for (const s of uptimeSamples) {
    const name = resolveSampleNode(s.metric);
    const val = parseNumericSample(s);
    if (!name || val === null) continue;
    ensureHost(name).uptimeSeconds = val;
  }

  for (const s of nodeUp) {
    const name = resolveSampleNode(s.metric);
    const val = parseNumericSample(s);
    if (!name || val === null) continue;
    ensureHost(name).online = val === 1;
  }

  const tempByKey = new Map<string, number>();
  for (const s of gpuTemp) {
    const name = resolveSampleNode(s.metric);
    const val = parseNumericSample(s);
    if (!name || val === null) continue;
    const key = `${name}::${s.metric.gpu || s.metric.UUID || '0'}`;
    tempByKey.set(key, val);
  }

  for (const s of gpuUtil) {
    const name = resolveSampleNode(s.metric);
    if (!name) continue;
    const host = ensureHost(name);
    const key = `${name}::${s.metric.gpu || s.metric.UUID || '0'}`;
    host.gpus.push({
      model: s.metric.modelName || 'NVIDIA GPU',
      utilizationPct: parseNumericSample(s),
      temperatureC: tempByKey.get(key) ?? null,
    });
  }

  for (const host of map.values()) {
    const tags: string[] = [];
    if (host.roles.length > 0) {
      tags.push(`role=${host.roles.join(',')}`);
    }
    if (host.osImage !== '-') {
      tags.push(`os=${host.osImage}`);
    }
    if (host.gpus.length > 0) {
      const models = Array.from(new Set(host.gpus.map((g) => g.model))).join(',');
      tags.push(`gpu=${host.gpus.length}x ${models}`);
      host.groups.push('Kubernetes Cluster - GPU Compute');
    }
    if (host.roles.some((r) => r.includes('control-plane') || r.includes('master'))) {
      host.groups.push('Kubernetes Cluster - Control Plane');
    } else {
      host.groups.push('Kubernetes Cluster - Worker Nodes');
    }
    host.tags = tags;
  }

  return Array.from(map.values()).sort((a, b) => a.hostname.localeCompare(b.hostname));
}

// -----------------------------------------------------------------------------
// VictoriaLogs Query, Level Filtering, Stacked Histogram & Hits Helpers
// -----------------------------------------------------------------------------

export type LogLevel = 'error' | 'warning' | 'info' | 'debug' | 'other';

export const ALL_LOG_LEVELS: LogLevel[] = ['error', 'warning', 'info', 'debug', 'other'];

export interface VictoriaLogEntry {
  _time: string;
  _msg: string;
  _stream: string;
  [field: string]: string;
}

export interface VictoriaLogsQueryResult {
  entries: VictoriaLogEntry[];
  durationMs: number;
}

export interface VictoriaLogHitBucket {
  timestamp: string;
  endTimestamp: string;
  label: string;
  count: number;
  counts: Record<LogLevel, number>;
}

const ERR_LOGSQL =
  '(level:~"(?i)(err|fatal|crit|panic)" OR severity:~"(?i)(err|fatal|crit|panic)" OR lvl:~"(?i)(err|fatal|crit|panic)" OR log.level:~"(?i)(err|fatal|crit|panic)" OR type:~"(?i)(err|fatal|crit|panic)" OR _msg:~"(?i)\\\\b(error|err|fatal|critical|panic|oomkilled|exception)\\\\b")';
const WARN_LOGSQL =
  '(level:~"(?i)(warn|warning)" OR severity:~"(?i)(warn|warning)" OR lvl:~"(?i)(warn|warning)" OR log.level:~"(?i)(warn|warning)" OR type:~"(?i)(warn|warning)" OR _msg:~"(?i)\\\\b(warn|warning)\\\\b")';
const DEBUG_LOGSQL =
  '(level:~"(?i)(debug|trace)" OR severity:~"(?i)(debug|trace)" OR lvl:~"(?i)(debug|trace)" OR log.level:~"(?i)(debug|trace)" OR type:~"(?i)(debug|trace)" OR _msg:~"(?i)\\\\b(debug|trace)\\\\b")';
const INFO_LOGSQL =
  '(level:~"(?i)(info|information|notice|normal)" OR severity:~"(?i)(info|information|notice|normal)" OR lvl:~"(?i)(info|information|notice|normal)" OR log.level:~"(?i)(info|information|notice|normal)" OR type:~"(?i)(info|normal)" OR _msg:~"(?i)\\\\b(info|information)\\\\b")';

export function classifyLogLevel(entry: VictoriaLogEntry): LogLevel {
  const structured = [entry.level, entry.severity, entry.lvl, entry['log.level'], entry.type]
    .filter((v) => typeof v === 'string' && v.trim().length > 0)
    .join(' ')
    .toLowerCase();

  if (structured) {
    if (/(err|fatal|crit|panic)/.test(structured)) return 'error';
    if (/(warn)/.test(structured)) return 'warning';
    if (/(debug|trace)/.test(structured)) return 'debug';
    if (/(info|notice|normal)/.test(structured)) return 'info';
  }

  const msg = String(entry._msg ?? '');
  if (/\b(error|err|fatal|critical|panic|oomkilled|exception)\b/i.test(msg)) return 'error';
  if (/\b(warn|warning)\b/i.test(msg)) return 'warning';
  if (/\b(debug|trace)\b/i.test(msg)) return 'debug';
  if (/\b(info|information)\b/i.test(msg)) return 'info';

  return 'other';
}

export function buildLogsQLLevelFilter(selectedLevels: LogLevel[]): string | null {
  const unique = Array.from(new Set(selectedLevels));
  if (unique.length === 0 || unique.length >= ALL_LOG_LEVELS.length) {
    return null;
  }

  const exprMap: Record<LogLevel, string> = {
    error: ERR_LOGSQL,
    warning: `(${WARN_LOGSQL} AND NOT ${ERR_LOGSQL})`,
    debug: `(${DEBUG_LOGSQL} AND NOT (${ERR_LOGSQL} OR ${WARN_LOGSQL}))`,
    info: `(${INFO_LOGSQL} AND NOT (${ERR_LOGSQL} OR ${WARN_LOGSQL} OR ${DEBUG_LOGSQL}))`,
    other: `NOT (${ERR_LOGSQL} OR ${WARN_LOGSQL} OR ${DEBUG_LOGSQL} OR ${INFO_LOGSQL})`,
  };

  if (unique.length === 1) {
    return exprMap[unique[0]];
  }
  return `(${unique.map((lvl) => exprMap[lvl]).join(' OR ')})`;
}

function splitFirstUnquotedPipe(query: string): { filterPart: string; pipePart: string } {
  let inSingle = false;
  let inDouble = false;
  let escaped = false;
  for (let i = 0; i < query.length; i++) {
    const ch = query[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (ch === '|' && !inSingle && !inDouble) {
      return {
        filterPart: query.slice(0, i).trim(),
        pipePart: query.slice(i).trim(),
      };
    }
  }
  return { filterPart: query.trim(), pipePart: '' };
}

export function injectLogsQLFilter(baseQuery: string, filterExpr: string | null): string {
  const trimmed = baseQuery.trim() || '*';
  if (!filterExpr) return trimmed;
  const { filterPart, pipePart } = splitFirstUnquotedPipe(trimmed);
  const nextFilter =
    !filterPart || filterPart === '*' ? filterExpr : `(${filterPart}) AND (${filterExpr})`;
  return pipePart ? `${nextFilter} ${pipePart}` : nextFilter;
}

export async function queryVictoriaLogs(
  query: string,
  limit = 100,
  startIso?: string,
  endIso?: string,
  target: DatasourceTarget | string = '',
): Promise<VictoriaLogsQueryResult> {
  if (!target) {
    throw new Error('No VictoriaLogs datasource configured.');
  }
  const params = new URLSearchParams({
    query: query.trim() || '*',
    limit: String(limit),
  });
  if (startIso) params.set('start', startIso);
  if (endIso) params.set('end', endIso);

  const started = performance.now();
  const basePath = toProxyBasePath(target);
  const url = `${basePath}/select/logsql/query?${params.toString()}`;
  const res = await globalThis.fetch(url, {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/stream+json, application/json, text/plain' },
  });
  const durationMs = Math.round(performance.now() - started);

  if (res.status === 401) {
    throw new UnauthorizedError('Session expired while querying VictoriaLogs');
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`VictoriaLogs HTTP ${res.status}: ${body || res.statusText}`);
  }

  const text = await res.text();
  const entries: VictoriaLogEntry[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parsed = JSON.parse(trimmed) as VictoriaLogEntry;
    entries.push(parsed);
  }
  return { entries, durationMs };
}

export async function queryVictoriaLogsHits(
  query: string,
  startIso: string,
  endIso: string,
  stepSeconds: number,
  target: DatasourceTarget | string,
): Promise<VictoriaLogHitBucket[]> {
  const params = new URLSearchParams({
    query: query.trim() || '*',
    start: startIso,
    end: endIso,
    step: `${stepSeconds}s`,
  });
  const basePath = toProxyBasePath(target);
  const url = `${basePath}/select/logsql/hits?${params.toString()}`;
  const res = await globalThis.fetch(url, {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  if (res.status === 401) {
    throw new UnauthorizedError('Session expired while fetching VictoriaLogs hits');
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`VictoriaLogs hits HTTP ${res.status}: ${body || res.statusText}`);
  }
  const payload = (await res.json()) as {
    hits?: Array<{ timestamps?: string[]; values?: number[] }>;
  };

  const bucketsByTs = new Map<string, number>();
  for (const series of payload.hits ?? []) {
    const tsList = series.timestamps ?? [];
    const valList = series.values ?? [];
    for (let i = 0; i < tsList.length; i++) {
      const ts = tsList[i];
      bucketsByTs.set(ts, (bucketsByTs.get(ts) ?? 0) + (valList[i] ?? 0));
    }
  }

  const sorted = Array.from(bucketsByTs.entries()).sort(([a], [b]) => a.localeCompare(b));
  return sorted.map(([timestamp, count], idx) => {
    const d = new Date(timestamp);
    const nextTs = sorted[idx + 1]?.[0];
    const endDate =
      nextTs && !Number.isNaN(new Date(nextTs).getTime())
        ? new Date(nextTs)
        : new Date(d.getTime() + stepSeconds * 1000);
    const label = Number.isNaN(d.getTime())
      ? timestamp
      : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    return {
      timestamp,
      endTimestamp: Number.isNaN(endDate.getTime()) ? timestamp : endDate.toISOString(),
      label,
      count,
      counts: { error: 0, warning: 0, info: 0, debug: 0, other: count },
    };
  });
}

function hasUnsupportedHistogramPipe(pipePart: string): boolean {
  if (!pipePart) return false;
  return /\|\s*(stats|limit|top|uniq|count_uniq|histogram|fields|drop|rename|extract|unpack_json|unpack_syslog)\b/i.test(
    pipePart,
  );
}

function stripTrailingSortPipes(pipePart: string): string {
  if (!pipePart) return '';
  return pipePart.replace(/\|\s*sort\b[^|]*/gi, '').trim();
}

export async function queryVictoriaLogsLevelHistogram(
  query: string,
  startIso: string,
  endIso: string,
  stepSeconds: number,
  target: DatasourceTarget | string,
): Promise<{ buckets: VictoriaLogHitBucket[]; stacked: boolean }> {
  const safeStep = Math.max(1, stepSeconds);
  const startMs = new Date(startIso).getTime();
  const endMs = new Date(endIso).getTime();

  const { filterPart, pipePart } = splitFirstUnquotedPipe(query.trim() || '*');

  // If the user wrote a stats/limit/top/uniq/transform pipe, keep `/hits` safely without breaking their pipe.
  if (!hasUnsupportedHistogramPipe(pipePart)) {
    const baseFilter = filterPart || '*';
    const extraPipes = stripTrailingSortPipes(pipePart);
    const prefix = extraPipes ? `${baseFilter} ${extraPipes}` : baseFilter;
    const statsQuery =
      `${prefix} | stats by (_time:${safeStep}s) ` +
      `count() if (${ERR_LOGSQL}) as error, ` +
      `count() if (${WARN_LOGSQL} AND NOT ${ERR_LOGSQL}) as warning, ` +
      `count() if (${DEBUG_LOGSQL} AND NOT (${ERR_LOGSQL} OR ${WARN_LOGSQL})) as debug, ` +
      `count() if (${INFO_LOGSQL} AND NOT (${ERR_LOGSQL} OR ${WARN_LOGSQL} OR ${DEBUG_LOGSQL})) as info, ` +
      `count() as total`;

    try {
      const params = new URLSearchParams({
        query: statsQuery,
        start: startIso,
        end: endIso,
        limit: '500',
      });
      const basePath = toProxyBasePath(target);
      const url = `${basePath}/select/logsql/query?${params.toString()}`;
      const res = await globalThis.fetch(url, {
        method: 'GET',
        credentials: 'include',
        headers: { Accept: 'application/stream+json, application/json, text/plain' },
      });
      if (res.status === 401) {
        throw new UnauthorizedError('Session expired while fetching VictoriaLogs level histogram');
      }
      if (res.ok) {
        const text = await res.text();
        const rowsBySlot = new Map<number, Record<LogLevel, number>>();
        const stepMs = safeStep * 1000;
        const alignedStart = Math.floor(startMs / stepMs) * stepMs;

        for (const line of text.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          const row = JSON.parse(trimmed) as Record<string, string | number>;
          const tsRaw = String(row._time ?? '');
          const tsMs = new Date(tsRaw).getTime();
          if (!Number.isFinite(tsMs)) continue;
          const slot = Math.floor(tsMs / stepMs) * stepMs;
          const error = Math.max(0, Number(row.error ?? 0) || 0);
          const warning = Math.max(0, Number(row.warning ?? 0) || 0);
          const debug = Math.max(0, Number(row.debug ?? 0) || 0);
          const info = Math.max(0, Number(row.info ?? 0) || 0);
          const total = Math.max(error + warning + debug + info, Number(row.total ?? 0) || 0);
          const other = Math.max(0, total - error - warning - debug - info);

          const prev = rowsBySlot.get(slot) ?? { error: 0, warning: 0, info: 0, debug: 0, other: 0 };
          rowsBySlot.set(slot, {
            error: prev.error + error,
            warning: prev.warning + warning,
            info: prev.info + info,
            debug: prev.debug + debug,
            other: prev.other + other,
          });
        }

        const buckets: VictoriaLogHitBucket[] = [];
        for (let slot = alignedStart; slot <= endMs; slot += stepMs) {
          const d = new Date(slot);
          const dEnd = new Date(Math.min(endMs, slot + stepMs));
          const counts = rowsBySlot.get(slot) ?? { error: 0, warning: 0, info: 0, debug: 0, other: 0 };
          const count = counts.error + counts.warning + counts.info + counts.debug + counts.other;
          buckets.push({
            timestamp: new Date(Math.max(startMs, slot)).toISOString(),
            endTimestamp: dEnd.toISOString(),
            label: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
            count,
            counts,
          });
        }

        if (buckets.length > 0) {
          return { buckets, stacked: true };
        }
      }
    } catch (err) {
      if (err instanceof UnauthorizedError) throw err;
      // Fall back cleanly to /select/logsql/hits
    }
  }

  const hits = await queryVictoriaLogsHits(query, startIso, endIso, safeStep, target);
  return { buckets: hits, stacked: false };
}

// -----------------------------------------------------------------------------
// Generic Perses GlobalVariable JSON Persistence + Dynamic Alert Rules & Presets
// -----------------------------------------------------------------------------

interface PersesGlobalTextVariableResource {
  kind: 'GlobalVariable';
  metadata: {
    name: string;
  };
  spec: {
    kind: 'TextVariable';
    spec: {
      name: string;
      value: string;
      constant?: boolean;
      display?: {
        name?: string;
        description?: string;
        hidden?: boolean;
      };
    };
  };
}

async function fetchGlobalJsonConfig<T>(
  varName: string,
  storageKey: string,
  normalize: (raw: unknown) => T,
  fallback: T,
): Promise<T> {
  let localVal = fallback;
  try {
    const rawLocal = window.localStorage.getItem(storageKey);
    if (rawLocal) {
      localVal = normalize(JSON.parse(rawLocal));
    }
  } catch {
    localVal = fallback;
  }

  try {
    const res = await persesFetch(`/api/v1/globalvariables/${encodeURIComponent(varName)}`, {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      return localVal;
    }
    const payload = (await res.json()) as PersesGlobalTextVariableResource;
    const rawValue = payload?.spec?.spec?.value;
    if (!rawValue) return localVal;
    const normalized = normalize(JSON.parse(rawValue));
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(normalized));
    } catch {
      // Ignore storage quota errors
    }
    return normalized;
  } catch {
    return localVal;
  }
}

async function saveGlobalJsonConfig<T>(
  varName: string,
  storageKey: string,
  value: T,
  displayName: string,
  description: string,
): Promise<T> {
  const resource: PersesGlobalTextVariableResource = {
    kind: 'GlobalVariable',
    metadata: { name: varName },
    spec: {
      kind: 'TextVariable',
      spec: {
        name: varName,
        value: JSON.stringify(value),
        constant: true,
        display: {
          name: displayName,
          description,
          hidden: true,
        },
      },
    },
  };

  const putRes = await persesFetch(`/api/v1/globalvariables/${encodeURIComponent(varName)}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(resource),
  });

  if (putRes.status === 404) {
    const postRes = await persesFetch('/api/v1/globalvariables', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(resource),
    });
    if (!postRes.ok) {
      await throwForBadResponse(postRes, '/api/v1/globalvariables');
    }
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      // Ignore storage quota errors
    }
    return value;
  }

  if (!putRes.ok) {
    await throwForBadResponse(putRes, `/api/v1/globalvariables/${varName}`);
  }

  try {
    window.localStorage.setItem(storageKey, JSON.stringify(value));
  } catch {
    // Ignore storage quota errors
  }

  return value;
}

// --- Alert Rules Config & Live Evaluator ---

export type AlertRuleConditionOp = '>' | '>=' | '<' | '<=' | '==' | '!=' | 'nonempty' | 'empty';

export interface AlertRuleDefinition {
  id: string;
  name: string;
  group: string;
  datasourceType: 'prometheus' | 'victorialogs';
  datasourceName?: string;
  query: string;
  conditionOp: AlertRuleConditionOp;
  threshold: number;
  thresholdLabel: string;
  severity: 'critical' | 'warning' | 'info';
  enabled: boolean;
  lookbackMinutes?: number;
  updatedBy?: string;
  updatedAt?: string;
}

export interface LiveAlertRuleEvaluation {
  rule: AlertRuleDefinition;
  id: string;
  name: string;
  group: string;
  datasourceType: 'prometheus' | 'victorialogs';
  resolvedDatasource: string;
  query: string;
  severity: 'critical' | 'warning' | 'info';
  enabled: boolean;
  status: 'normal' | 'firing' | 'error' | 'disabled';
  measuredValue: string;
  thresholdLabel: string;
  evaluatedAt: string;
  updatedBy: string;
  detail: string;
}

export const DEFAULT_ALERT_RULES: AlertRuleDefinition[] = [
  {
    id: 'node-reachability',
    name: 'Node Exporter Targets Unreachable (up == 0)',
    group: 'Core Infrastructure',
    datasourceType: 'prometheus',
    query: 'up{job="node-exporter"} == 0',
    conditionOp: 'nonempty',
    threshold: 0,
    thresholdLabel: 'count == 0',
    severity: 'critical',
    enabled: true,
    updatedBy: 'system',
  },
  {
    id: 'node-memory-pressure',
    name: 'Node Memory Usage > 85%',
    group: 'Core Infrastructure',
    datasourceType: 'prometheus',
    query: '100 * (1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes))',
    conditionOp: '>',
    threshold: 85,
    thresholdLabel: '< 85%',
    severity: 'warning',
    enabled: true,
    updatedBy: 'system',
  },
  {
    id: 'node-cpu-saturation',
    name: 'Node CPU Utilization > 85%',
    group: 'Core Infrastructure',
    datasourceType: 'prometheus',
    query: '100 - (avg by (node) (rate(node_cpu_seconds_total{mode="idle"}[2m])) * 100)',
    conditionOp: '>',
    threshold: 85,
    thresholdLabel: '< 85%',
    severity: 'warning',
    enabled: true,
    updatedBy: 'system',
  },
  {
    id: 'nvidia-gpu-temp',
    name: 'NVIDIA GPU Thermal Threshold (> 85°C)',
    group: 'GPU & AI Compute',
    datasourceType: 'prometheus',
    query: 'max(DCGM_FI_DEV_GPU_TEMP)',
    conditionOp: '>',
    threshold: 85,
    thresholdLabel: '< 85°C',
    severity: 'critical',
    enabled: true,
    updatedBy: 'system',
  },
  {
    id: 'pod-crashloop',
    name: 'Pods in CrashLoopBackOff or ImagePullBackOff',
    group: 'Workloads',
    datasourceType: 'prometheus',
    query: 'sum(kube_pod_container_status_waiting_reason{reason=~"CrashLoopBackOff|ImagePullBackOff|ErrImagePull"}) or vector(0)',
    conditionOp: '>',
    threshold: 0,
    thresholdLabel: '== 0 pods',
    severity: 'critical',
    enabled: true,
    updatedBy: 'system',
  },
  {
    id: 'pvc-storage-saturation',
    name: 'PersistentVolume Usage > 85%',
    group: 'Storage',
    datasourceType: 'prometheus',
    query: '100 * (kubelet_volume_stats_used_bytes / kubelet_volume_stats_capacity_bytes)',
    conditionOp: '>',
    threshold: 85,
    thresholdLabel: '< 85%',
    severity: 'warning',
    enabled: true,
    updatedBy: 'system',
  },
  {
    id: 'vlogs-ingestion',
    name: 'Log Ingestion Rate Stalled (<= 0 rows/s)',
    group: 'Observability',
    datasourceType: 'prometheus',
    query: 'sum(rate(vl_rows_ingested_total[5m]))',
    conditionOp: '<=',
    threshold: 0,
    thresholdLabel: '> 0 rows/s',
    severity: 'warning',
    enabled: true,
    updatedBy: 'system',
  },
  {
    id: 'k8s-warning-events',
    name: 'Kubernetes Warning Events in Last 15m',
    group: 'Workloads',
    datasourceType: 'victorialogs',
    query: 'stream:="k8s_events" AND "Warning"',
    conditionOp: '>',
    threshold: 0,
    thresholdLabel: '== 0 in 15m',
    severity: 'warning',
    enabled: true,
    lookbackMinutes: 15,
    updatedBy: 'system',
  },
];

const ALERT_RULES_VAR_NAME = 'alert_rules_config';
const ALERT_RULES_STORAGE_KEY = 'perses-alert-rules-config';

function normalizeAlertRules(raw: unknown): AlertRuleDefinition[] {
  if (!Array.isArray(raw)) return DEFAULT_ALERT_RULES;
  return raw
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    .map((item, idx) => ({
      id: typeof item.id === 'string' && item.id.trim() ? item.id.trim() : `rule-${idx + 1}`,
      name: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : `Rule ${idx + 1}`,
      group: typeof item.group === 'string' && item.group.trim() ? item.group.trim() : 'General',
      datasourceType: item.datasourceType === 'victorialogs' ? 'victorialogs' : 'prometheus',
      datasourceName:
        typeof item.datasourceName === 'string' && item.datasourceName.trim() ? item.datasourceName.trim() : undefined,
      query: typeof item.query === 'string' ? item.query : '',
      conditionOp: (['>', '>=', '<', '<=', '==', '!=', 'nonempty', 'empty'].includes(String(item.conditionOp))
        ? item.conditionOp
        : '>') as AlertRuleConditionOp,
      threshold: Number.isFinite(Number(item.threshold)) ? Number(item.threshold) : 0,
      thresholdLabel:
        typeof item.thresholdLabel === 'string' && item.thresholdLabel.trim()
          ? item.thresholdLabel.trim()
          : `${String(item.conditionOp ?? '>')} ${Number(item.threshold ?? 0)}`,
      severity: (['critical', 'warning', 'info'].includes(String(item.severity))
        ? item.severity
        : 'warning') as AlertRuleDefinition['severity'],
      enabled: item.enabled !== false,
      lookbackMinutes: Number.isFinite(Number(item.lookbackMinutes)) ? Number(item.lookbackMinutes) : 15,
      updatedBy: typeof item.updatedBy === 'string' && item.updatedBy.trim() ? item.updatedBy.trim() : 'system',
      updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : undefined,
    }));
}

export function fetchAlertRulesConfig(): Promise<AlertRuleDefinition[]> {
  return fetchGlobalJsonConfig(
    ALERT_RULES_VAR_NAME,
    ALERT_RULES_STORAGE_KEY,
    normalizeAlertRules,
    DEFAULT_ALERT_RULES,
  );
}

export function saveAlertRulesConfig(rules: AlertRuleDefinition[]): Promise<AlertRuleDefinition[]> {
  return saveGlobalJsonConfig(
    ALERT_RULES_VAR_NAME,
    ALERT_RULES_STORAGE_KEY,
    rules,
    'Alert Rules Configuration',
    'Dynamic PromQL & LogsQL live alert rule definitions.',
  );
}

function compareThreshold(val: number, op: AlertRuleConditionOp, threshold: number): boolean {
  switch (op) {
    case '>':
      return val > threshold;
    case '>=':
      return val >= threshold;
    case '<':
      return val < threshold;
    case '<=':
      return val <= threshold;
    case '==':
      return val === threshold;
    case '!=':
      return val !== threshold;
    default:
      return false;
  }
}

function describeSampleLabel(metric: Record<string, string>): string {
  return (
    metric.node ||
    metric.nodename ||
    (metric.namespace && metric.persistentvolumeclaim
      ? `${metric.namespace}/${metric.persistentvolumeclaim}`
      : '') ||
    (metric.namespace && metric.pod ? `${metric.namespace}/${metric.pod}` : '') ||
    metric.instance ||
    Object.entries(metric)
      .filter(([k]) => k !== '__name__')
      .map(([k, v]) => `${k}=${v}`)
      .slice(0, 2)
      .join(',') ||
    'series'
  );
}

export async function evaluateLiveAlertRules(
  rules: AlertRuleDefinition[],
  availableTargets: DatasourceTarget[],
): Promise<LiveAlertRuleEvaluation[]> {
  const nowStr = new Date().toISOString();

  return Promise.all(
    rules.map(async (rule): Promise<LiveAlertRuleEvaluation> => {
      const updatedBy = rule.updatedBy || 'system';
      if (!rule.enabled) {
        return {
          rule,
          id: rule.id,
          name: rule.name,
          group: rule.group,
          datasourceType: rule.datasourceType,
          resolvedDatasource: rule.datasourceName || 'Disabled',
          query: rule.query,
          severity: rule.severity,
          enabled: false,
          status: 'disabled',
          measuredValue: 'Disabled',
          thresholdLabel: rule.thresholdLabel,
          evaluatedAt: nowStr,
          updatedBy,
          detail: 'Rule evaluation is disabled.',
        };
      }

      const requiredKind =
        rule.datasourceType === 'victorialogs' ? 'VictoriaLogsDatasource' : 'PrometheusDatasource';
      const target = resolveDatasourceTarget(availableTargets, requiredKind, rule.datasourceName);

      if (!target) {
        return {
          rule,
          id: rule.id,
          name: rule.name,
          group: rule.group,
          datasourceType: rule.datasourceType,
          resolvedDatasource: rule.datasourceName || 'Unconfigured',
          query: rule.query,
          severity: rule.severity,
          enabled: true,
          status: 'error',
          measuredValue: 'No Datasource',
          thresholdLabel: rule.thresholdLabel,
          evaluatedAt: nowStr,
          updatedBy,
          detail: `No ${requiredKind} configured. Add one in Integrations -> Data sources.`,
        };
      }

      try {
        if (rule.datasourceType === 'prometheus') {
          const samples = await queryPrometheusInstant(rule.query, target);
          if (rule.conditionOp === 'nonempty') {
            const firing = samples.length > 0;
            return {
              rule,
              id: rule.id,
              name: rule.name,
              group: rule.group,
              datasourceType: rule.datasourceType,
              resolvedDatasource: target.name,
              query: rule.query,
              severity: rule.severity,
              enabled: true,
              status: firing ? 'firing' : 'normal',
              measuredValue: `${samples.length} matching`,
              thresholdLabel: rule.thresholdLabel,
              evaluatedAt: nowStr,
              updatedBy,
              detail: firing
                ? samples.map((s) => describeSampleLabel(s.metric)).slice(0, 6).join(', ')
                : '0 matching series.',
            };
          }

          if (rule.conditionOp === 'empty') {
            const firing = samples.length === 0;
            return {
              rule,
              id: rule.id,
              name: rule.name,
              group: rule.group,
              datasourceType: rule.datasourceType,
              resolvedDatasource: target.name,
              query: rule.query,
              severity: rule.severity,
              enabled: true,
              status: firing ? 'firing' : 'normal',
              measuredValue: `${samples.length} series`,
              thresholdLabel: rule.thresholdLabel,
              evaluatedAt: nowStr,
              updatedBy,
              detail: firing ? 'Query returned 0 series.' : `${samples.length} series present.`,
            };
          }

          if (samples.length === 0) {
            return {
              rule,
              id: rule.id,
              name: rule.name,
              group: rule.group,
              datasourceType: rule.datasourceType,
              resolvedDatasource: target.name,
              query: rule.query,
              severity: rule.severity,
              enabled: true,
              status: 'normal',
              measuredValue: 'No data',
              thresholdLabel: rule.thresholdLabel,
              evaluatedAt: nowStr,
              updatedBy,
              detail: 'Query returned 0 samples from datasource.',
            };
          }

          let peak = -Infinity;
          let minVal = Infinity;
          const breached: string[] = [];
          for (const s of samples) {
            const val = parseNumericSample(s);
            if (val === null) continue;
            if (val > peak) peak = val;
            if (val < minVal) minVal = val;
            if (compareThreshold(val, rule.conditionOp, rule.threshold)) {
              breached.push(`${describeSampleLabel(s.metric)} (${val.toFixed(2)})`);
            }
          }

          const hasNumeric = Number.isFinite(peak);
          const displayVal = !hasNumeric
            ? 'No numeric value'
            : rule.conditionOp === '<' || rule.conditionOp === '<='
              ? minVal.toFixed(2)
              : peak.toFixed(2);
          const firing = breached.length > 0;

          return {
            rule,
            id: rule.id,
            name: rule.name,
            group: rule.group,
            datasourceType: rule.datasourceType,
            resolvedDatasource: target.name,
            query: rule.query,
            severity: rule.severity,
            enabled: true,
            status: firing ? 'firing' : 'normal',
            measuredValue: samples.length > 1 && hasNumeric ? `Peak ${displayVal}` : displayVal,
            thresholdLabel: rule.thresholdLabel,
            evaluatedAt: nowStr,
            updatedBy,
            detail: firing
              ? `Breached on: ${breached.slice(0, 6).join(', ')}`
              : `Within threshold across ${samples.length} series.`,
          };
        }

        // VictoriaLogs live rule evaluation
        const lookback = rule.lookbackMinutes ?? 15;
        const endIso = new Date().toISOString();
        const startIso = new Date(Date.now() - lookback * 60 * 1000).toISOString();
        const { entries } = await queryVictoriaLogs(rule.query, 200, startIso, endIso, target);
        const count = entries.length;
        const firing =
          rule.conditionOp === 'nonempty'
            ? count > 0
            : rule.conditionOp === 'empty'
              ? count === 0
              : compareThreshold(count, rule.conditionOp, rule.threshold);

        return {
          rule,
          id: rule.id,
          name: rule.name,
          group: rule.group,
          datasourceType: rule.datasourceType,
          resolvedDatasource: target.name,
          query: rule.query,
          severity: rule.severity,
          enabled: true,
          status: firing ? 'firing' : 'normal',
          measuredValue: `${count} log(s)`,
          thresholdLabel: rule.thresholdLabel,
          evaluatedAt: nowStr,
          updatedBy,
          detail:
            count > 0
              ? `Latest: ${entries[0]._msg || entries[0].reason || 'Matched record'}`
              : `0 matched records in last ${lookback}m.`,
        };
      } catch (err) {
        if (err instanceof UnauthorizedError) throw err;
        return {
          rule,
          id: rule.id,
          name: rule.name,
          group: rule.group,
          datasourceType: rule.datasourceType,
          resolvedDatasource: target.name,
          query: rule.query,
          severity: rule.severity,
          enabled: true,
          status: 'error',
          measuredValue: 'Query Error',
          thresholdLabel: rule.thresholdLabel,
          evaluatedAt: nowStr,
          updatedBy,
          detail: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );
}

// --- Shared Log Presets Config ---

export interface LogPresetItem {
  id: string;
  label: string;
  query: string;
  description?: string;
}

export const DEFAULT_LOG_PRESETS: LogPresetItem[] = [
  { id: 'all-logs', label: 'All logs (*)', query: '*' },
  { id: 'k8s-events', label: 'K8s Events', query: 'stream:="k8s_events"' },
  { id: 'errors-warnings', label: 'Errors / Warnings', query: 'error OR warn OR OOMKilled' },
  { id: 'pod-restarts', label: 'Pod BackOff / OOM', query: 'CrashLoopBackOff OR ImagePullBackOff OR OOMKilled' },
];

const LOG_PRESETS_VAR_NAME = 'log_presets_config';
const LOG_PRESETS_STORAGE_KEY = 'perses-log-presets-config';

function normalizeLogPresets(raw: unknown): LogPresetItem[] {
  if (!Array.isArray(raw)) return DEFAULT_LOG_PRESETS;
  const items = raw
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    .map((item, idx) => ({
      id: typeof item.id === 'string' && item.id.trim() ? item.id.trim() : `preset-${idx + 1}`,
      label: typeof item.label === 'string' && item.label.trim() ? item.label.trim() : `Preset ${idx + 1}`,
      query: typeof item.query === 'string' && item.query.trim() ? item.query : '*',
      description: typeof item.description === 'string' ? item.description : undefined,
    }));
  return items.length > 0 ? items : DEFAULT_LOG_PRESETS;
}

export function fetchLogPresetsConfig(): Promise<LogPresetItem[]> {
  return fetchGlobalJsonConfig(
    LOG_PRESETS_VAR_NAME,
    LOG_PRESETS_STORAGE_KEY,
    normalizeLogPresets,
    DEFAULT_LOG_PRESETS,
  );
}

export function setLocalLogPresets(presets: LogPresetItem[]): void {
  try {
    window.localStorage.setItem(LOG_PRESETS_STORAGE_KEY, JSON.stringify(presets));
  } catch {
    // Ignore storage quota errors
  }
}

export function saveLogPresetsConfig(presets: LogPresetItem[]): Promise<LogPresetItem[]> {
  return saveGlobalJsonConfig(
    LOG_PRESETS_VAR_NAME,
    LOG_PRESETS_STORAGE_KEY,
    presets,
    'Log Explorer Presets',
    'Cluster-wide shared VictoriaLogs LogsQL query presets.',
  );
}

// -----------------------------------------------------------------------------
// Perses Embedded Plugin DatasourceApi Hook
// -----------------------------------------------------------------------------

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
    queryKey: ['perses', 'globaldatasources'],
    queryFn: safeFetchGlobalDatasources,
  });

  const { data: projectDatasources } = useQuery<DatasourceResource[]>({
    queryKey: ['perses', 'datasources', projectName],
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

// -----------------------------------------------------------------------------
// Dynamic Site Branding Store (Perses GlobalVariable + localStorage)
// -----------------------------------------------------------------------------

export interface SiteBrandingConfig {
  appName: string;
  appSubtitle: string;
  orgName: string;
  logoUrl: string;
  logoText: string;
}

export const DEFAULT_SITE_BRANDING: SiteBrandingConfig = {
  appName: 'Perses',
  appSubtitle: 'Observability · Metrics, Traces & Logs',
  orgName: 'Observability',
  logoUrl: '',
  logoText: 'P',
};

const SITE_BRANDING_STORAGE_KEY = 'perses-site-branding';
const SITE_BRANDING_VAR_NAME = 'site_branding_config';

function normalizeBranding(raw: Partial<SiteBrandingConfig> | null | undefined): SiteBrandingConfig {
  return {
    appName: (raw?.appName ?? '').trim() || DEFAULT_SITE_BRANDING.appName,
    appSubtitle: (raw?.appSubtitle ?? '').trim() || DEFAULT_SITE_BRANDING.appSubtitle,
    orgName: (raw?.orgName ?? '').trim() || DEFAULT_SITE_BRANDING.orgName,
    logoUrl: (raw?.logoUrl ?? '').trim(),
    logoText: ((raw?.logoText ?? '').trim() || DEFAULT_SITE_BRANDING.logoText).slice(0, 2),
  };
}

export function applySiteBrandingToDocument(cfg: SiteBrandingConfig): void {
  if (typeof document === 'undefined') return;
  document.title = cfg.appSubtitle ? `${cfg.appName} — ${cfg.appSubtitle}` : cfg.appName;
  if (cfg.logoUrl) {
    let iconLink = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!iconLink) {
      iconLink = document.createElement('link');
      iconLink.rel = 'icon';
      document.head.appendChild(iconLink);
    }
    iconLink.href = cfg.logoUrl;
  }
}

export function getLocalSiteBranding(): SiteBrandingConfig {
  try {
    const raw = window.localStorage.getItem(SITE_BRANDING_STORAGE_KEY);
    if (!raw) return DEFAULT_SITE_BRANDING;
    const parsed = JSON.parse(raw) as Partial<SiteBrandingConfig>;
    return normalizeBranding(parsed);
  } catch {
    return DEFAULT_SITE_BRANDING;
  }
}

export function setLocalSiteBranding(cfg: SiteBrandingConfig): SiteBrandingConfig {
  const normalized = normalizeBranding(cfg);
  try {
    window.localStorage.setItem(SITE_BRANDING_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Ignore storage quota errors cleanly
  }
  applySiteBrandingToDocument(normalized);
  return normalized;
}

export async function fetchClusterSiteBranding(): Promise<SiteBrandingConfig> {
  const local = getLocalSiteBranding();
  return fetchGlobalJsonConfig(
    SITE_BRANDING_VAR_NAME,
    SITE_BRANDING_STORAGE_KEY,
    (raw) => {
      const normalized = normalizeBranding(raw as Partial<SiteBrandingConfig>);
      applySiteBrandingToDocument(normalized);
      return normalized;
    },
    local,
  );
}

export async function saveClusterSiteBranding(cfg: SiteBrandingConfig): Promise<SiteBrandingConfig> {
  const normalized = normalizeBranding(cfg);
  await saveGlobalJsonConfig(
    SITE_BRANDING_VAR_NAME,
    SITE_BRANDING_STORAGE_KEY,
    normalized,
    'Site Branding Configuration',
    'Dynamic application name, subtitle, organization label, and logo.',
  );
  return setLocalSiteBranding(normalized);
}
