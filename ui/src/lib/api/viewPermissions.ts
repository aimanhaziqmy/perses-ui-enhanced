import type { GlobalRoleBindingResource } from '@perses-dev/client';

import { fetchGlobalJsonConfig, saveGlobalJsonConfig } from '@/lib/api/http';

export type AppViewKey =
  | 'dashboards'
  | 'metrics'
  | 'logs'
  | 'traces'
  | 'alerts'
  | 'events'
  | 'hosts'
  | 'datasources'
  | 'users'
  | 'roles'
  | 'settings'
  | 'about';

export interface AppViewMeta {
  key: AppViewKey;
  label: string;
  path: string;
  section: string;
}

export const APP_VIEWS: AppViewMeta[] = [
  { key: 'dashboards', label: 'Dashboards (Overview)', path: '/dashboards', section: 'Explorer' },
  { key: 'metrics', label: 'Metrics Explorer', path: '/explore/metrics', section: 'Explorer' },
  { key: 'logs', label: 'Logs Explorer', path: '/explore/logs', section: 'Explorer' },
  { key: 'traces', label: 'Traces Explorer', path: '/explore/traces', section: 'Explorer' },
  { key: 'alerts', label: 'Alert Rules', path: '/alerts', section: 'Alerts & Notifications' },
  { key: 'events', label: 'Kubernetes Events', path: '/events', section: 'Alerts & Notifications' },
  { key: 'hosts', label: 'Hosts', path: '/hosts', section: 'Infrastructure' },
  { key: 'datasources', label: 'Data Sources', path: '/datasources', section: 'Integrations' },
  { key: 'users', label: 'Users', path: '/users', section: 'Organization' },
  { key: 'roles', label: 'Roles & Permissions', path: '/roles', section: 'Organization' },
  { key: 'settings', label: 'Site Settings', path: '/settings', section: 'System' },
  { key: 'about', label: 'System About', path: '/about', section: 'System' },
];

export const ALL_APP_VIEW_KEYS: AppViewKey[] = APP_VIEWS.map((v) => v.key);
const VALID_VIEW_KEY_SET = new Set<string>(ALL_APP_VIEW_KEYS);

export interface RoleViewPermissionsConfig {
  roles: Record<string, AppViewKey[]>;
}

export const DEFAULT_ROLE_VIEW_PERMISSIONS: RoleViewPermissionsConfig = {
  roles: {
    admin: [...ALL_APP_VIEW_KEYS],
    editor: ['dashboards', 'metrics', 'logs', 'traces', 'alerts', 'events', 'hosts', 'datasources', 'about'],
    operator: ['dashboards', 'metrics', 'logs', 'traces', 'alerts', 'events', 'hosts', 'datasources', 'about'],
    viewer: ['dashboards', 'metrics', 'logs', 'traces', 'alerts', 'events', 'about'],
  },
};

const ROLE_VIEW_PERMISSIONS_STORAGE_KEY = 'perses-role-view-permissions';
const ROLE_VIEW_PERMISSIONS_VAR_NAME = 'role_view_permissions_config';

function sanitizeViewList(views: unknown): AppViewKey[] {
  if (!Array.isArray(views)) return [];
  const deduped = new Set<AppViewKey>();
  for (const item of views) {
    if (typeof item === 'string' && VALID_VIEW_KEY_SET.has(item)) {
      deduped.add(item as AppViewKey);
    }
  }
  return Array.from(deduped);
}

export function normalizeRoleViewPermissions(
  raw: Partial<RoleViewPermissionsConfig> | null | undefined,
): RoleViewPermissionsConfig {
  const nextRoles: Record<string, AppViewKey[]> = {};

  if (raw?.roles && typeof raw.roles === 'object') {
    for (const [roleName, viewList] of Object.entries(raw.roles)) {
      const trimmed = roleName.trim();
      if (!trimmed) continue;
      nextRoles[trimmed] = sanitizeViewList(viewList);
    }
  }

  for (const [defaultRole, defaultViews] of Object.entries(DEFAULT_ROLE_VIEW_PERMISSIONS.roles)) {
    if (!(defaultRole in nextRoles)) {
      nextRoles[defaultRole] = [...defaultViews];
    }
  }

  // Enforce: admin always retains Site Settings to prevent lockout
  const adminViews = new Set<AppViewKey>(nextRoles.admin ?? ALL_APP_VIEW_KEYS);
  adminViews.add('settings');
  nextRoles.admin = Array.from(adminViews);

  return { roles: nextRoles };
}

export function getLocalRoleViewPermissions(): RoleViewPermissionsConfig {
  try {
    const raw = window.localStorage.getItem(ROLE_VIEW_PERMISSIONS_STORAGE_KEY);
    if (!raw) return DEFAULT_ROLE_VIEW_PERMISSIONS;
    const parsed = JSON.parse(raw) as Partial<RoleViewPermissionsConfig>;
    return normalizeRoleViewPermissions(parsed);
  } catch {
    return DEFAULT_ROLE_VIEW_PERMISSIONS;
  }
}

export function setLocalRoleViewPermissions(cfg: RoleViewPermissionsConfig): RoleViewPermissionsConfig {
  const normalized = normalizeRoleViewPermissions(cfg);
  try {
    window.localStorage.setItem(ROLE_VIEW_PERMISSIONS_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Ignore storage quota errors
  }
  return normalized;
}

export async function fetchRoleViewPermissions(): Promise<RoleViewPermissionsConfig> {
  const local = getLocalRoleViewPermissions();
  return fetchGlobalJsonConfig(
    ROLE_VIEW_PERMISSIONS_VAR_NAME,
    ROLE_VIEW_PERMISSIONS_STORAGE_KEY,
    (raw) => normalizeRoleViewPermissions(raw as Partial<RoleViewPermissionsConfig>),
    local,
  );
}

export async function saveRoleViewPermissions(
  cfg: RoleViewPermissionsConfig,
): Promise<RoleViewPermissionsConfig> {
  const normalized = normalizeRoleViewPermissions(cfg);
  await saveGlobalJsonConfig(
    ROLE_VIEW_PERMISSIONS_VAR_NAME,
    ROLE_VIEW_PERMISSIONS_STORAGE_KEY,
    normalized,
    'Role View Permissions Configuration',
    'Maps GlobalRoles / OIDC roles to permitted UI sidebar views and routes.',
  );
  return setLocalRoleViewPermissions(normalized);
}

export function resolveUserRolesFromBindings(
  username: string,
  sub: string,
  bindings: GlobalRoleBindingResource[] | undefined,
  isSiteAdmin: boolean,
): string[] {
  const roles = new Set<string>();
  const lowerUser = username.trim().toLowerCase();
  const lowerSub = sub.trim().toLowerCase();

  for (const b of bindings ?? []) {
    const matches = (b.spec.subjects ?? []).some((s) => {
      if (s.kind !== 'User') return false;
      const subjectName = s.name.trim().toLowerCase();
      return (lowerUser && subjectName === lowerUser) || (lowerSub && subjectName === lowerSub);
    });
    if (matches && b.spec.role) {
      roles.add(b.spec.role);
    }
  }

  if (isSiteAdmin) {
    roles.add('admin');
  }

  if (roles.size === 0) {
    roles.add('viewer');
  }

  return Array.from(roles);
}

export function getAllowedViewsForUser(
  config: RoleViewPermissionsConfig,
  userRoles: string[],
  isSiteAdmin: boolean,
): Set<AppViewKey> {
  const allowed = new Set<AppViewKey>();

  const roleEntries = Object.entries(config.roles);
  let matchedAnyConfiguredRole = false;

  for (const role of userRoles) {
    const exact = config.roles[role];
    if (exact) {
      matchedAnyConfiguredRole = true;
      for (const v of exact) allowed.add(v);
      continue;
    }
    const lower = role.toLowerCase();
    const caseInsensitive = roleEntries.find(([k]) => k.toLowerCase() === lower);
    if (caseInsensitive) {
      matchedAnyConfiguredRole = true;
      for (const v of caseInsensitive[1]) allowed.add(v);
    }
  }

  if (!matchedAnyConfiguredRole) {
    const fallback = isSiteAdmin ? ALL_APP_VIEW_KEYS : (config.roles.viewer ?? DEFAULT_ROLE_VIEW_PERMISSIONS.roles.viewer);
    for (const v of fallback) allowed.add(v);
  }

  if (isSiteAdmin || userRoles.some((r) => r.toLowerCase() === 'admin')) {
    allowed.add('settings');
  }

  return allowed;
}

const DEFAULT_ROUTE_PRIORITY: AppViewKey[] = [
  'dashboards',
  'logs',
  'metrics',
  'traces',
  'alerts',
  'events',
  'hosts',
  'datasources',
  'users',
  'roles',
  'settings',
  'about',
];

export function getDefaultRouteForAllowedViews(allowed: Set<AppViewKey>): string {
  for (const key of DEFAULT_ROUTE_PRIORITY) {
    if (allowed.has(key)) {
      const meta = APP_VIEWS.find((v) => v.key === key);
      if (meta) return meta.path;
    }
  }
  return '/about';
}
