import {
  Box,
  Button,
  Chip,
  Drawer,
  IconButton,
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
  type SiteBrandingConfig,
  ForbiddenError,
  UnauthorizedError,
  applySiteBrandingToDocument,
  fetchClusterSiteBranding,
  fetchPersesConfig,
  fetchPersesHealth,
  fetchProjects,
  fetchUserPermissions,
  getCurrentPersesUsername,
  getLocalSiteBranding,
  getUiCapabilities,
  logoutPerses,
  queryKeys,
  saveClusterSiteBranding,
} from './api/persesClient';
import { MoonIcon, SidebarCollapseIcon, SunIcon } from './components/BrandIcons';
import { LoginView } from './components/LoginView';
import { type NavKey, Sidebar } from './components/Sidebar';
import { ViewForbiddenState, ViewLoadingState } from './components/ViewStates';
import type { ThemeMode } from './theme/persesTheme';

const DashboardsView = lazy(() =>
  import('./components/DashboardsView').then((m) => ({ default: m.DashboardsView })),
);
const ExploreView = lazy(() =>
  import('./components/ExploreView').then((m) => ({ default: m.ExploreView })),
);
const LogsExplorerView = lazy(() =>
  import('./components/LogsExplorerView').then((m) => ({ default: m.LogsExplorerView })),
);
const TracesExplorerView = lazy(() =>
  import('./components/TracesExplorerView').then((m) => ({ default: m.TracesExplorerView })),
);
const HostsView = lazy(() =>
  import('./components/HostsView').then((m) => ({ default: m.HostsView })),
);
const AlertRulesView = lazy(() =>
  import('./components/AlertRulesView').then((m) => ({ default: m.AlertRulesView })),
);
const DatasourcesView = lazy(() =>
  import('./components/DatasourcesView').then((m) => ({ default: m.DatasourcesView })),
);
const UsersView = lazy(() =>
  import('./components/UsersView').then((m) => ({ default: m.UsersView })),
);
const RolesView = lazy(() =>
  import('./components/RolesView').then((m) => ({ default: m.RolesView })),
);
const SiteSettingsView = lazy(() =>
  import('./components/SiteSettingsView').then((m) => ({ default: m.SiteSettingsView })),
);
const SystemAboutView = lazy(() =>
  import('./components/SystemAboutView').then((m) => ({ default: m.SystemAboutView })),
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
  const searchParams = new URLSearchParams(location.search);
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
          {isEmbedRoute ? (
            <RouteView>
              <DashboardsView
                isEmbed={true}
                isFullscreen={isFullscreen}
                onToggleFullscreen={toggleFullscreen}
              />
            </RouteView>
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
                    <HostsView />
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
                    <DatasourcesView canManage={capabilities.canManageDatasources} />
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
                      <SiteSettingsView branding={branding} onSaveBranding={handleSaveBranding} canEdit={isSiteAdmin} />
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
              <Route path="*" element={<Navigate to="/dashboards" replace />} />
            </Routes>
          )}
        </Box>
      </Box>
    </Box>
  );
}
