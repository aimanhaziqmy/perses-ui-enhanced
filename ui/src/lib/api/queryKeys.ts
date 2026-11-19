import { getNamespaceScopeKey } from '@/lib/api/workspace';

export const queryKeys = {
  persesConfig: ['perses', 'config'] as const,
  persesHealth: ['perses', 'health'] as const,
  userPermissions: (username: string) => ['perses', 'user-permissions', username] as const,
  persesUser: (username: string) => ['perses', 'user', username] as const,
  projects: ['perses', 'projects'] as const,
  allDashboards: (projectNamesKey?: string) =>
    projectNamesKey !== undefined
      ? (['perses', 'all-dashboards', projectNamesKey] as const)
      : (['perses', 'all-dashboards'] as const),
  dashboards: (project: string) => ['perses', 'dashboards', project] as const,
  dashboard: (project: string, name: string) => ['perses', 'dashboard', project, name] as const,
  globalDatasources: ['perses', 'globaldatasources'] as const,
  projectDatasources: (project: string) => ['perses', 'datasources', project] as const,
  allProjectDatasources: (projectNamesKey?: string) =>
    projectNamesKey !== undefined
      ? (['perses', 'all-project-datasources', projectNamesKey] as const)
      : (['perses', 'all-project-datasources'] as const),
  allDatasourceTargets: ['perses', 'all-datasource-targets'] as const,
  users: ['perses', 'users'] as const,
  globalRoles: ['perses', 'globalroles'] as const,
  globalRoleBindings: ['perses', 'globalrolebindings'] as const,
  projectRoles: (project: string) => ['perses', 'roles', project] as const,
  allProjectRbac: (projectNamesKey?: string) =>
    projectNamesKey !== undefined
      ? (['perses', 'all-project-rbac', projectNamesKey] as const)
      : (['perses', 'all-project-rbac'] as const),
  plugins: ['perses', 'plugins'] as const,
  alertRulesConfig: ['perses', 'alert-rules-config'] as const,
  logPresetsConfig: ['perses', 'log-presets-config'] as const,
  workspaceMap: ['perses', 'workspace-map'] as const,
  roleViewPermissions: ['perses', 'role-view-permissions'] as const,
  publicShares: ['perses', 'public-shares'] as const,

  // Proxy-backed queries: prefixed with 'proxy' and scoped by active namespace(s)
  proxyPrefix: ['proxy'] as const,
  clusterHosts: (targetKey: string, nsScope = getNamespaceScopeKey()) =>
    ['proxy', 'cluster-hosts', nsScope, targetKey] as const,
  backendAlertRules: (targetKey: string, nsScope = getNamespaceScopeKey()) =>
    ['proxy', 'backend-alert-rules', nsScope, targetKey] as const,
  backendAlerts: (targetKey: string, nsScope = getNamespaceScopeKey()) =>
    ['proxy', 'backend-alerts', nsScope, targetKey] as const,
  liveAlertRules: (rulesHash: string, targetsKey: string, nsScope = getNamespaceScopeKey()) =>
    ['proxy', 'live-alert-rules', nsScope, rulesHash, targetsKey] as const,
  k8sEventsTab: (targetKey: string, eventsQuery: string, nsScope = getNamespaceScopeKey()) =>
    ['proxy', 'k8s-events-tab', nsScope, targetKey, eventsQuery] as const,
  logsQuery: (
    targetKey: string,
    tabId: string,
    query: string,
    rangeMinutes: number,
    customStartIso: string,
    customEndIso: string,
    cursorEndIso: string,
    executedNonce: number,
    nsScope = getNamespaceScopeKey(),
  ) =>
    [
      'proxy',
      'logs-query',
      nsScope,
      targetKey,
      tabId,
      query,
      rangeMinutes,
      customStartIso,
      customEndIso,
      cursorEndIso,
      executedNonce,
    ] as const,
  logsGroupHistogram: (
    groupBy: string,
    targetKey: string,
    tabId: string,
    query: string,
    rangeMinutes: number,
    customStartIso: string,
    customEndIso: string,
    executedNonce: number,
    nsScope = getNamespaceScopeKey(),
  ) =>
    [
      'proxy',
      'logs-group-histogram',
      nsScope,
      groupBy,
      targetKey,
      tabId,
      query,
      rangeMinutes,
      customStartIso,
      customEndIso,
      executedNonce,
    ] as const,
  logsLevelHistogram: (
    targetKey: string,
    tabId: string,
    query: string,
    rangeMinutes: number,
    customStartIso: string,
    customEndIso: string,
    selectedLevelsKey: string,
    executedNonce: number,
    nsScope = getNamespaceScopeKey(),
  ) =>
    [
      'proxy',
      'logs-level-histogram',
      nsScope,
      targetKey,
      tabId,
      query,
      rangeMinutes,
      customStartIso,
      customEndIso,
      selectedLevelsKey,
      executedNonce,
    ] as const,
  traceServices: (targetKey: string, nsScope = getNamespaceScopeKey()) =>
    ['proxy', 'trace-services', nsScope, targetKey] as const,
  traceOperations: (targetKey: string, service: string, nsScope = getNamespaceScopeKey()) =>
    ['proxy', 'trace-operations', nsScope, targetKey, service] as const,
  traceSearch: (
    targetKey: string,
    service: string,
    operation: string,
    minDuration: string,
    maxDuration: string,
    tags: string,
    rangeMinutes: number,
    limit: number,
    searchNonce: number,
    nsScope = getNamespaceScopeKey(),
  ) =>
    [
      'proxy',
      'trace-search',
      nsScope,
      targetKey,
      service,
      operation,
      minDuration,
      maxDuration,
      tags,
      rangeMinutes,
      limit,
      searchNonce,
    ] as const,
  traceDetail: (targetKey: string, traceId: string, nsScope = getNamespaceScopeKey()) =>
    ['proxy', 'trace-detail', nsScope, targetKey, traceId] as const,
};
