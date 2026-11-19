import { Alert, Box, Drawer } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';

import { ViewForbiddenState, ViewLoadingState } from '@/components/ui/ViewStates';
import { LoginView } from '@/features/auth/LoginView';
import { useSession } from '@/features/auth/hooks/useSession';
import { useWorkspaceScope } from '@/features/workspace/hooks/useWorkspaceScope';
import { fetchPersesConfig, fetchPersesHealth, getCurrentPersesUserClaims } from '@/lib/api/auth';
import {
  type SiteBrandingConfig,
  applySiteBrandingToDocument,
  getLocalSiteBranding,
  saveClusterSiteBranding,
} from '@/lib/api/branding';
import { queryKeys } from '@/lib/api/queryKeys';
import { fetchPersesGlobalRoleBindings, fetchUserPermissions, getUiCapabilities } from '@/lib/api/rbac';
import {
  type AppViewKey,
  type RoleViewPermissionsConfig,
  ALL_APP_VIEW_KEYS,
  DEFAULT_ROLE_VIEW_PERMISSIONS,
  fetchRoleViewPermissions,
  getAllowedViewsForUser,
  getDefaultRouteForAllowedViews,
  resolveUserRolesFromBindings,
  saveRoleViewPermissions,
} from '@/lib/api/viewPermissions';
import type { ThemeMode } from '@/theme/persesTheme';
import { AppHeader } from './layout/Header';
import { Sidebar } from './layout/Sidebar';
import { navKeyFromPath } from './layout/nav';
import { AppRoutes, EmbedDashboardRoute } from './router/routes';

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
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);
  const [branding, setBranding] = useState<SiteBrandingConfig>(() => getLocalSiteBranding());

  const { sessionState, authError, currentUsername, handleLogout, handleAuthenticated } = useSession(setBranding);

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
    retry: false,
    refetchInterval: 30000,
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

  const userClaims = useMemo(() => {
    if (sessionState !== 'authenticated') {
      return { username: currentUsername, sub: '' };
    }
    return getCurrentPersesUserClaims();
  }, [currentUsername, sessionState]);

  const userRoles = useMemo(
    () => resolveUserRolesFromBindings(currentUsername, userClaims.sub, globalRoleBindings, isSiteAdmin),
    [currentUsername, userClaims.sub, globalRoleBindings, isSiteAdmin],
  );
  const allowedViews = useMemo<Set<AppViewKey>>(() => {
    if (!authEnabled) return new Set<AppViewKey>(ALL_APP_VIEW_KEYS);
    return getAllowedViewsForUser(roleViewPermissions, userRoles, isSiteAdmin);
  }, [authEnabled, roleViewPermissions, userRoles, isSiteAdmin]);
  const defaultAllowedPath = useMemo(() => getDefaultRouteForAllowedViews(allowedViews), [allowedViews]);

  const {
    loadingWorkspaceMap,
    userWorkspaces,
    isNamespaceScoped,
    selectedWorkspaceNs,
    setSelectedWorkspaceNs,
    workspaceContext,
  } = useWorkspaceScope({
    sessionAuthenticated: sessionState === 'authenticated',
    authEnabled,
    isSiteAdmin,
    currentUsername,
    userSub: userClaims.sub,
    searchParams,
  });

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
        onAuthenticated={handleAuthenticated}
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
          <AppHeader
            activeKey={activeKey}
            themeMode={themeMode}
            health={health}
            isNamespaceScoped={isNamespaceScoped}
            userWorkspaces={userWorkspaces}
            selectedWorkspaceNs={selectedWorkspaceNs}
            onSelectWorkspaceNs={setSelectedWorkspaceNs}
            onOpenMobileMenu={() => setMobileMenuOpen(true)}
            onToggleTheme={onToggleTheme}
            onLogout={handleLogout}
          />
        )}

        <Box component="main" sx={{ flex: 1, p: isEmbedRoute ? 1 : isFullscreen ? 1.5 : { xs: 1.5, md: 2 }, minHeight: 0 }}>
          {isNamespaceScoped && !loadingWorkspaceMap && userWorkspaces.length === 0 && (
            <Alert severity="warning" sx={{ mb: 1.5 }}>
              No Kubernetes workspace namespace is assigned to account <strong>{currentUsername}</strong> yet. Metrics and
              logs are restricted until a workspace membership is granted.
            </Alert>
          )}
          {isEmbedRoute ? (
            <EmbedDashboardRoute isFullscreen={isFullscreen} onToggleFullscreen={toggleFullscreen} />
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
            <AppRoutes
              isFullscreen={isFullscreen}
              onToggleFullscreen={toggleFullscreen}
              workspaceContext={workspaceContext}
              logsInitialQuery={logsInitialQuery}
              isNamespaceScoped={isNamespaceScoped}
              isSiteAdmin={isSiteAdmin}
              loadingPermissions={loadingPermissions}
              capabilities={capabilities}
              branding={branding}
              onSaveBranding={handleSaveBranding}
              roleViewPermissions={roleViewPermissions}
              onSaveRolePermissions={handleSaveRolePermissions}
              health={health}
              config={config}
              defaultAllowedPath={defaultAllowedPath}
              onNavigate={navigate}
            />
          )}
        </Box>
      </Box>
    </Box>
  );
}
