import type { AppViewKey } from '@/lib/api/viewPermissions';

export type NavKey = AppViewKey;

export const ROUTE_TITLES: Record<AppViewKey, string> = {
  metrics: 'Metrics explorer',
  logs: 'Log explorer',
  traces: 'Traces explorer',
  dashboards: 'Dashboards',
  alerts: 'Alert rules',
  events: 'Kubernetes Events',
  hosts: 'Hosts',
  datasources: 'Data sources',
  users: 'User management',
  roles: 'Roles & Permissions',
  settings: 'System · Site settings',
  about: 'System · About',
};

export function navKeyFromPath(pathname: string): AppViewKey {
  if (pathname.startsWith('/explore/logs')) return 'logs';
  if (pathname.startsWith('/explore/traces')) return 'traces';
  if (pathname.startsWith('/explore')) return 'metrics';
  if (pathname.startsWith('/alerts')) return 'alerts';
  if (pathname.startsWith('/events')) return 'events';
  if (pathname.startsWith('/hosts')) return 'hosts';
  if (pathname.startsWith('/datasources')) return 'datasources';
  if (pathname.startsWith('/users')) return 'users';
  if (pathname.startsWith('/roles')) return 'roles';
  if (pathname.startsWith('/settings')) return 'settings';
  if (pathname.startsWith('/about')) return 'about';
  return 'dashboards';
}
