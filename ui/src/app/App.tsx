import {
  Alert,
  Box,
  Button,
  Chip,
  Drawer,
  FormControl,
  IconButton,
  MenuItem,
  Select,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { ErrorAlert, ErrorBoundary } from '@perses-dev/components';
import Logout from 'mdi-material-ui/Logout';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import React, { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';

import {
  type AppViewKey,
  type RoleViewPermissionsConfig,
  type SiteBrandingConfig,
  ALL_APP_VIEW_KEYS,
  DEFAULT_ROLE_VIEW_PERMISSIONS,
  ForbiddenError,
  NO_WORKSPACE_SENTINEL,
  UnauthorizedError,
  applySiteBrandingToDocument,
  fetchClusterSiteBranding,
  fetchPersesConfig,
  fetchPersesGlobalRoleBindings,
  fetchPersesHealth,
  fetchPersesUser,
  fetchProjects,
  fetchRoleViewPermissions,
  fetchUserPermissions,
  fetchWorkspaceMap,
  getAllowedViewsForUser,
  getCurrentPersesUserClaims,
  getCurrentPersesUsername,
  getDefaultRouteForAllowedViews,
  getUiCapabilities,
  logoutPerses,
  queryKeys,
  resolveUserRolesFromBindings,
  resolveUserWorkspaces,
  saveClusterSiteBranding,
  saveRoleViewPermissions,
  setEnforcedNamespaces,
} from '@/api/persesClient';
import { getLocalSiteBranding } from '@/api/persesClient';
import { MoonIcon, SidebarCollapseIcon, SunIcon } from '@/components/ui/BrandIcons';
import { LoginView } from '@/features/auth/LoginView';
import { type NavKey, Sidebar } from '@/app/layout/Sidebar';
import { ViewForbiddenState, ViewLoadingState } from '@/components/ui/ViewStates';
import type { ThemeMode } from '@/theme/persesTheme';

const DashboardsView = lazy(() =>
  import('@/features/dashboards/DashboardsView').then((m) => ({ default: m.DashboardsView })),
);
const ExploreView = lazy(() =>
  import('@/features/metrics-explore/ExploreView').then((m) => ({ default: m.ExploreView })),
);
const LogsExplorerView = lazy(() =>
  import('@/features/logs/LogsExplorerView').then((m) => ({ default: m.LogsExplorerView })),
);
const TracesExplorerView = lazy(() =>
  import('@/features/traces/TracesExplorerView').then((m) => ({ default: m.TracesExplorerView })),
);
const HostsView = lazy(() =>
  import('@/features/hosts/HostsView').then((m) => ({ default: m.HostsView })),
);
const AlertRulesView = lazy(() =>
  import('@/features/alerts/AlertRulesView').then((m) => ({ default: m.AlertRulesView })),
);
const DatasourcesView = lazy(() =>
  import('@/features/datasources/DatasourcesView').then((m) => ({ default: m.DatasourcesView })),
);
const UsersView = lazy(() =>
  import('@/features/users/UsersView').then((m) => ({ default: m.UsersView })),
);
const RolesView = lazy(() =>
  import('@/features/roles/RolesView').then((m) => ({ default: m.RolesView })),
);
const SiteSettingsView = lazy(() =>
  import('@/features/site-settings/SiteSettingsView').then((m) => ({ default: m.SiteSettingsView })),
);
const SystemAboutView = lazy(() =>
  import('@/features/site-settings/SystemAboutView').then((m) => ({ default: m.SystemAboutView })),
);

const ROUTE_TITLES: Record<NavKey, string> = {
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

function navKeyFromPath(pathname: string): NavKey {
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

function RouteView({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary FallbackComponent={ErrorAlert}>
      <Suspense fallback={<ViewLoadingState message="Loading view..." minHeight={320} />}>
        {children}
      </Suspense>
    </ErrorBoundary>
  );
}

export function App({ themeMode, onToggleTheme }: { themeMode: ThemeMode; onToggleTheme: () => void }) {
  const theme = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const activeKey = navKeyFromPath(location.pathname);
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const isEmbedRoute = location.pathname.startsWith('/embed/') || searchParams.get('embed') === '1';
  const isPublicEmbed = isEmbedRoute && searchParams.get('public') === '1';

  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [sessionState, setSessionState] = useState<'checking' | 'authenticated' | 'unauthenticated'>('checking');
  const [authError, setAuthError] = useState<string | undefined>(undefined);
  const [currentUsername, setCurrentUsername] = useState<string>(() => getCurrentPersesUsername());
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);
  const [branding, setBranding] = useState<SiteBrandingConfig>(() => getLocalSiteBranding());

  useEffect(() => {
    applySiteBrandingToDocument(branding);
  }, [branding]);

  useEffect(() => {
    const onFsChange = () => {
      if (!document.fullscreenElement) {
        setIsFullscreen(false);
      }
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    if (!isFullscreen) {
      setIsFullscreen(true);
      try {
        if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
          await document.documentElement.requestFullscreen();
        }
      } catch {
        // Fallback to CSS kiosk mode if fullscreen API is blocked
      }
    } else {
      setIsFullscreen(false);
      try {
        if (document.fullscreenElement && document.exitFullscreen) {
          await document.exitFullscreen();
        }
      } catch {
        // Ignore exit errors
      }
    }
  }, [isFullscreen]);

  const { data: config } = useQuery({
    queryKey: queryKeys.persesConfig,
    queryFn: fetchPersesConfig,
    retry: false,
  });

  const { data: health } = useQuery({
    queryKey: queryKeys.persesHealth,
    queryFn: fetchPersesHealth,
    refetchInterval: 30000,
    retry: false,
  });

  const { data: userPermissions, isLoading: loadingPermissions } = useQuery({
    queryKey: queryKeys.userPermissions(currentUsername),
    queryFn: () => fetchUserPermissions(currentUsername),
    enabled: sessionState === 'authenticated' && Boolean(currentUsername) && currentUsername !== 'guest',
    retry: false,
  });

  const authEnabled = Boolean(config?.security?.enable_auth ?? true) && currentUsername !== 'guest';
  const capabilities = useMemo(
    () => getUiCapabilities(userPermissions, authEnabled),
    [userPermissions, authEnabled],
  );
  const isSiteAdmin = capabilities.isSiteAdmin;

  const { data: workspaceMap, isLoading: loadingWorkspaceMap } = useQuery({
    queryKey: queryKeys.workspaceMap,
    queryFn: fetchWorkspaceMap,
    enabled: sessionState === 'authenticated',
    refetchInterval: 30000,
    retry: false,
  });

  const { data: roleViewPermissions = DEFAULT_ROLE_VIEW_PERMISSIONS, isLoading: loadingRoleViewPermissions } = useQuery({
    queryKey: queryKeys.roleViewPermissions,
    queryFn: fetchRoleViewPermissions,
    enabled: sessionState === 'authenticated',
    retry: false,
  });

  const { data: globalRoleBindings, isLoading: loadingGlobalRoleBindings } = useQuery({
    queryKey: queryKeys.globalRoleBindings,
    queryFn: fetchPersesGlobalRoleBindings,
    enabled: sessionState === 'authenticated' && authEnabled,
    retry: false,
  });

  const { data: currentUserResource } = useQuery({
    queryKey: queryKeys.persesUser(currentUsername),
    queryFn: () => fetchPersesUser(currentUsername),
    enabled:
      sessionState === 'authenticated' &&
      authEnabled &&
      Boolean(workspaceMap?.enabled) &&
      !isSiteAdmin &&
      Boolean(currentUsername) &&
      currentUsername !== 'guest',
    retry: false,
  });

  const userClaims = useMemo(() => getCurrentPersesUserClaims(), [currentUsername, sessionState]);
  const userRoles = useMemo(
    () => resolveUserRolesFromBindings(currentUsername, userClaims.sub, globalRoleBindings, isSiteAdmin),
    [currentUsername, userClaims.sub, globalRoleBindings, isSiteAdmin],
  );
  const allowedViews = useMemo<Set<AppViewKey>>(() => {
    if (!authEnabled) return new Set<AppViewKey>(ALL_APP_VIEW_KEYS);
    return getAllowedViewsForUser(roleViewPermissions, userRoles, isSiteAdmin);
  }, [authEnabled, roleViewPermissions, userRoles, isSiteAdmin]);
  const defaultAllowedPath = useMemo(() => getDefaultRouteForAllowedViews(allowedViews), [allowedViews]);
  const workspaceSubjects = useMemo(() => {
    const out: string[] = [];
    if (userClaims.sub) out.push(userClaims.sub);
    const oauthList = currentUserResource?.spec?.oauthProviders ?? [];
    for (const p of oauthList) {
      if (p.subject) out.push(p.subject);
      if (p.email) out.push(p.email);
    }
    const fullName = [currentUserResource?.spec?.firstName, currentUserResource?.spec?.lastName]
      .filter(Boolean)
      .join(' ')
      .trim();
    if (fullName) out.push(fullName);
    return out;
  }, [userClaims.sub, currentUserResource]);
  const userWorkspaces = useMemo(
    () => resolveUserWorkspaces(workspaceMap, currentUsername, workspaceSubjects),
    [workspaceMap, currentUsername, workspaceSubjects],
  );
  const isNamespaceScoped = Boolean(workspaceMap?.enabled && authEnabled && !isSiteAdmin);
  const [selectedWorkspaceNs, setSelectedWorkspaceNs] = useState<string>('');

  const activeScopedNamespaces = useMemo<string[] | null>(() => {
    if (!isNamespaceScoped) return null;
    if (userWorkspaces.length === 0) return [NO_WORKSPACE_SENTINEL];
    const allowedSet = new Set(userWorkspaces.map((w) => w.namespace));
    if (selectedWorkspaceNs === '__all__') {
      return userWorkspaces.map((w) => w.namespace);
    }
    if (selectedWorkspaceNs && allowedSet.has(selectedWorkspaceNs)) {
      return [selectedWorkspaceNs];
    }
    return [userWorkspaces[0].namespace];
  }, [isNamespaceScoped, userWorkspaces, selectedWorkspaceNs]);

  useEffect(() => {
    setEnforcedNamespaces(activeScopedNamespaces);
    void queryClient.removeQueries({ queryKey: queryKeys.proxyPrefix });
  }, [activeScopedNamespaces, queryClient]);

  const workspaceContext = useMemo(() => {
    const urlProject = searchParams.get('project')?.trim() || '';
    const urlNamespace = searchParams.get('namespace')?.trim() || '';
    if (urlProject || urlNamespace) {
      const next = { project: urlProject, namespace: urlNamespace };
      try {
        sessionStorage.setItem('perses_workspace_context', JSON.stringify(next));
      } catch {
        // Ignore storage errors
      }
      return next;
    }
    try {
      const raw = sessionStorage.getItem('perses_workspace_context');
      if (raw) {
        const parsed = JSON.parse(raw) as { project?: string; namespace?: string };
        return { project: parsed.project ?? '', namespace: parsed.namespace ?? '' };
      }
    } catch {
      // Ignore storage errors
    }
    return { project: '', namespace: '' };
  }, [searchParams]);

  const verifySession = useCallback(async () => {
    setSessionState('checking');
    setAuthError(undefined);
    try {
      await fetchProjects();
      setCurrentUsername(getCurrentPersesUsername());
      setSessionState('authenticated');
      void fetchClusterSiteBranding().then((remote) => {
        setBranding(remote);
      });
    } catch (err) {
      if (err instanceof ForbiddenError) {
        setCurrentUsername(getCurrentPersesUsername());
        setSessionState('authenticated');
        void fetchClusterSiteBranding().then((remote) => {
          setBranding(remote);
        });
        return;
      }
      if (err instanceof UnauthorizedError) {
        setSessionState('unauthenticated');
        return;
      }
      setAuthError(err instanceof Error ? err.message : String(err));
      setSessionState('unauthenticated');
    }
  }, []);

  useEffect(() => {
    void verifySession();
  }, [verifySession]);

  const handleSaveBranding = useCallback(async (next: SiteBrandingConfig) => {
    const saved = await saveClusterSiteBranding(next);
    setBranding(saved);
  }, []);

  const handleSaveRolePermissions = useCallback(
    async (next: RoleViewPermissionsConfig) => {
      const saved = await saveRoleViewPermissions(next);
      queryClient.setQueryData(queryKeys.roleViewPermissions, saved);
    },
    [queryClient],
  );

  const handleLogout = useCallback(async () => {
    await logoutPerses();
    queryClient.clear();
    setCurrentUsername('guest');
    setSessionState('unauthenticated');
  }, [queryClient]);

  const handleNavigate = useCallback(
    (path: string) => {
      navigate(path);
      setMobileMenuOpen(false);
    },
    [navigate],
  );

  if (sessionState === 'checking') {
    return (
      <Box sx={{ minHeight: '100vh', bgcolor: theme.palette.surface.bgCanvas, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <ViewLoadingState message={`Connecting to ${branding.appName} Backend...`} />
      </Box>
    );
  }

  if (sessionState === 'unauthenticated' && !isPublicEmbed) {
    return (
      <LoginView
        config={config}
        branding={branding}
        initialError={authError}
        themeMode={themeMode}
        onToggleTheme={onToggleTheme}
        onAuthenticated={() => {
          queryClient.clear();
          void verifySession();
        }}
      />
    );
  }

  const sidebarWidth = sidebarCollapsed ? 64 : 218;
  const hideChrome = isEmbedRoute || isFullscreen;
  const logsInitialQuery = searchParams.get('query') || '*';

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', bgcolor: theme.palette.surface.bgCanvas }}>
      {!hideChrome && (
        <Box
          component="nav"
          sx={{
            width: sidebarWidth,
            flexShrink: 0,
            display: { xs: 'none', lg: 'block' },
            position: 'sticky',
            top: 0,
            height: '100vh',
          }}
        >
          <Sidebar
            activeKey={activeKey}
            collapsed={sidebarCollapsed}
            isMobileDrawer={false}
            branding={branding}
            currentUsername={currentUsername}
            isSiteAdmin={isSiteAdmin}
            canManageUsers={capabilities.canManageUsers}
            hideClusterInfra={isNamespaceScoped}
            allowedViews={allowedViews}
            themeMode={themeMode}
            onNavigate={handleNavigate}
            onToggleCollapse={setSidebarCollapsed}
            onToggleTheme={onToggleTheme}
          />
        </Box>
      )}

      {!hideChrome && (
        <Drawer open={mobileMenuOpen} onClose={() => setMobileMenuOpen(false)}>
          <Sidebar
            activeKey={activeKey}
            collapsed={false}
            isMobileDrawer={true}
            branding={branding}
            currentUsername={currentUsername}
            isSiteAdmin={isSiteAdmin}
            canManageUsers={capabilities.canManageUsers}
            hideClusterInfra={isNamespaceScoped}
            allowedViews={allowedViews}
            themeMode={themeMode}
            onNavigate={handleNavigate}
            onToggleCollapse={setSidebarCollapsed}
            onToggleTheme={onToggleTheme}
          />
        </Drawer>
      )}

      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {!hideChrome && (
          <Box
            component="header"
            sx={{
              height: 52,
              px: { xs: 1.5, md: 2.5 },
              bgcolor: theme.palette.surface.bgHeader,
              borderBottom: `1px solid ${theme.palette.surface.borderSubtle}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              position: 'sticky',
              top: 0,
              zIndex: 10,
            }}
          >
            <Stack direction="row" spacing={1.25} alignItems="center">
              <IconButton
                size="small"
                onClick={() => setMobileMenuOpen(true)}
                sx={{ display: { xs: 'inline-flex', lg: 'none' } }}
              >
                <SidebarCollapseIcon collapsed={true} />
              </IconButton>
              <Typography variant="subtitle1" fontWeight={700}>
                {ROUTE_TITLES[activeKey]}
              </Typography>
            </Stack>

            <Stack direction="row" spacing={1} alignItems="center">
              {isNamespaceScoped && userWorkspaces.length === 1 && (
                <Chip
                  size="small"
                  color="primary"
                  variant="outlined"
                  label={`Workspace: ${userWorkspaces[0].workspaceName} (${userWorkspaces[0].namespace})`}
                  sx={{ height: 24, fontSize: 11.5, fontFamily: 'monospace' }}
                />
              )}
              {isNamespaceScoped && userWorkspaces.length > 1 && (
                <FormControl size="small" sx={{ minWidth: 190 }}>
                  <Select
                    displayEmpty
                    value={
                      selectedWorkspaceNs &&
                      (selectedWorkspaceNs === '__all__' ||
                        userWorkspaces.some((w) => w.namespace === selectedWorkspaceNs))
                        ? selectedWorkspaceNs
                        : userWorkspaces[0].namespace
                    }
                    onChange={(e) => setSelectedWorkspaceNs(e.target.value)}
                    sx={{ height: 28, fontSize: 12, fontFamily: 'monospace' }}
                  >
                    {userWorkspaces.map((w) => (
                      <MenuItem key={w.namespace} value={w.namespace} sx={{ fontSize: 12, fontFamily: 'monospace' }}>
                        {w.workspaceName} ({w.namespace})
                      </MenuItem>
                    ))}
                    <MenuItem value="__all__" sx={{ fontSize: 12, fontFamily: 'monospace' }}>
                      All my workspaces ({userWorkspaces.length})
                    </MenuItem>
                  </Select>
                </FormControl>
              )}
              {health && (
                <Tooltip title={`Perses ${health.version ?? 'v0.55.1'} · DB ${health.database ? 'OK' : 'DOWN'}`}>
                  <Chip
                    size="small"
                    variant="outlined"
                    color={health.database === false ? 'error' : 'success'}
                    label={`v${(health.version ?? '0.55.1').replace(/^v/, '')}`}
                    sx={{ height: 24, fontSize: 11.5, fontFamily: 'monospace' }}
                  />
                </Tooltip>
              )}

              <Tooltip title={`Switch to ${themeMode === 'light' ? 'Dark' : 'Light'} mode`}>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={onToggleTheme}
                  startIcon={themeMode === 'light' ? <MoonIcon fontSize="small" /> : <SunIcon fontSize="small" />}
                  sx={{ height: 28, fontSize: 12 }}
                >
                  {themeMode === 'light' ? 'Dark' : 'Light'}
                </Button>
              </Tooltip>

              <Button
                size="small"
                color="inherit"
                startIcon={<Logout fontSize="small" />}
                onClick={handleLogout}
                sx={{ height: 28, fontSize: 12 }}
              >
                Sign out
              </Button>
            </Stack>
          </Box>
        )}

        <Box component="main" sx={{ flex: 1, p: isEmbedRoute ? 1 : isFullscreen ? 1.5 : { xs: 1.5, md: 2 }, minHeight: 0 }}>
          {isNamespaceScoped && !loadingWorkspaceMap && userWorkspaces.length === 0 && (
            <Alert severity="warning" sx={{ mb: 1.5 }}>
              No Kubernetes workspace namespace is assigned to account <strong>{currentUsername}</strong> yet. Metrics and
              logs are restricted until a workspace membership is granted.
            </Alert>
          )}
          {isEmbedRoute ? (
            <RouteView>
              <DashboardsView
                isEmbed={true}
                isFullscreen={isFullscreen}
                onToggleFullscreen={toggleFullscreen}
              />
            </RouteView>
          ) : authEnabled && (loadingPermissions || loadingRoleViewPermissions || loadingGlobalRoleBindings) && !allowedViews.has(activeKey) ? (
            <ViewLoadingState message="Checking view permissions..." />
          ) : authEnabled && allowedViews.size === 0 ? (
            <ViewForbiddenState
              description="No sidebar views are permitted for your role. Contact your site administrator."
              onBack={handleLogout}
            />
          ) : authEnabled && !allowedViews.has(activeKey) ? (
            <Navigate to={defaultAllowedPath} replace />
          ) : (
            <Routes>
              <Route
                path="/dashboards/*"
                element={
                  <RouteView>
                    <DashboardsView
                      isEmbed={false}
                      isFullscreen={isFullscreen}
                      onToggleFullscreen={toggleFullscreen}
                      defaultProject={workspaceContext.project || undefined}
                      canCreateProject={capabilities.canCreateProject}
                      canDeleteProject={capabilities.canDeleteProject}
                      canManageDashboards={capabilities.canManageDashboards}
                    />
                  </RouteView>
                }
              />
              <Route
                path="/explore/metrics/*"
                element={
                  <RouteView>
                    <ExploreView defaultProject={workspaceContext.project || undefined} />
                  </RouteView>
                }
              />
              <Route
                path="/explore/logs/*"
                element={
                  <RouteView>
                    <LogsExplorerView
                      initialQuery={logsInitialQuery}
                      lockedNamespace={workspaceContext.namespace || undefined}
                    />
                  </RouteView>
                }
              />
              <Route
                path="/explore/traces/*"
                element={
                  <RouteView>
                    <TracesExplorerView />
                  </RouteView>
                }
              />
              <Route
                path="/explore/*"
                element={
                  <RouteView>
                    <ExploreView />
                  </RouteView>
                }
              />
              <Route
                path="/hosts/*"
                element={
                  <RouteView>
                    {isNamespaceScoped ? (
                      <ViewForbiddenState
                        description="Cluster-wide host infrastructure is restricted to site administrators."
                        onBack={() => navigate('/dashboards')}
                      />
                    ) : (
                      <HostsView />
                    )}
                  </RouteView>
                }
              />
              <Route
                path="/alerts/*"
                element={
                  <RouteView>
                    <AlertRulesView defaultSubTab="rules" canEdit={capabilities.canManageAlertRules} />
                  </RouteView>
                }
              />
              <Route
                path="/events/*"
                element={
                  <RouteView>
                    <AlertRulesView defaultSubTab="events" canEdit={capabilities.canManageAlertRules} />
                  </RouteView>
                }
              />
              <Route
                path="/datasources/*"
                element={
                  <RouteView>
                    {isNamespaceScoped ? (
                      <ViewForbiddenState
                        description="Cluster data source endpoints are restricted to site administrators."
                        onBack={() => navigate('/dashboards')}
                      />
                    ) : (
                      <DatasourcesView canManage={capabilities.canManageDatasources} />
                    )}
                  </RouteView>
                }
              />
              <Route
                path="/users/*"
                element={
                  <RouteView>
                    {loadingPermissions ? (
                      <ViewLoadingState message="Checking permissions..." />
                    ) : !capabilities.canManageUsers ? (
                      <ViewForbiddenState
                        description="Administrator permissions are required to manage users."
                        onBack={() => navigate('/dashboards')}
                      />
                    ) : (
                      <UsersView />
                    )}
                  </RouteView>
                }
              />
              <Route
                path="/roles/*"
                element={
                  <RouteView>
                    {loadingPermissions ? (
                      <ViewLoadingState message="Checking permissions..." />
                    ) : !capabilities.canManageUsers ? (
                      <ViewForbiddenState
                        description="Administrator permissions are required to manage roles."
                        onBack={() => navigate('/dashboards')}
                      />
                    ) : (
                      <RolesView />
                    )}
                  </RouteView>
                }
              />
              <Route
                path="/settings/*"
                element={
                  <RouteView>
                    {loadingPermissions ? (
                      <ViewLoadingState message="Checking permissions..." />
                    ) : !isSiteAdmin ? (
                      <ViewForbiddenState
                        description="Only site administrators can access Site settings."
                        onBack={() => navigate('/dashboards')}
                      />
                    ) : (
                      <SiteSettingsView
                        branding={branding}
                        onSaveBranding={handleSaveBranding}
                        rolePermissions={roleViewPermissions}
                        onSaveRolePermissions={handleSaveRolePermissions}
                        canEdit={isSiteAdmin}
                      />
                    )}
                  </RouteView>
                }
              />
              <Route
                path="/about/*"
                element={
                  <RouteView>
                    <SystemAboutView health={health} config={config} />
                  </RouteView>
                }
              />
              <Route path="*" element={<Navigate to={defaultAllowedPath} replace />} />
            </Routes>
          )}
        </Box>
      </Box>
    </Box>
  );
}
