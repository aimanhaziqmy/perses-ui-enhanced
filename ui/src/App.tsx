import {
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  Divider,
  Drawer,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import Logout from 'mdi-material-ui/Logout';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import {
  type SiteBrandingConfig,
  ForbiddenError,
  UnauthorizedError,
  applySiteBrandingToDocument,
  fetchClusterSiteBranding,
  fetchPersesConfig,
  fetchPersesHealth,
  fetchProjects,
  getCurrentPersesUsername,
  getLocalSiteBranding,
  logoutPerses,
  refreshAuthSession,
  saveClusterSiteBranding,
} from './api/persesClient';
import { AlertRulesView } from './components/AlertRulesView';
import {
  MoonIcon,
  NavAlertsIcon,
  NavExplorerIcon,
  NavInfraIcon,
  NavIntegrationsIcon,
  NavOrgIcon,
  NavSystemIcon,
  PersesLogoMark,
  SidebarCollapseIcon,
  SunIcon,
} from './components/BrandIcons';
import { DashboardsView } from './components/DashboardsView';
import { DatasourcesView } from './components/DatasourcesView';
import { ExploreView } from './components/ExploreView';
import { HostsView } from './components/HostsView';
import { LoginView } from './components/LoginView';
import { LogsExplorerView } from './components/LogsExplorerView';
import { RolesView, SiteSettingsView, SystemAboutView, UsersView } from './components/UsersView';
import type { ThemeMode } from './theme/persesTheme';
import { PALETTE_TOKENS } from './theme/persesTheme';

type NavKey =
  | 'metrics'
  | 'logs'
  | 'dashboards'
  | 'alerts'
  | 'events'
  | 'hosts'
  | 'datasources'
  | 'users'
  | 'roles'
  | 'settings'
  | 'about';

interface NavSection {
  id: string;
  label: string;
  icon: React.ReactNode;
  items: Array<{
    key: NavKey;
    label: string;
    path: string;
  }>;
}

const NAV_SECTIONS: NavSection[] = [
  {
    id: 'explorer',
    label: 'Explorer',
    icon: <NavExplorerIcon sx={{ fontSize: 18 }} />,
    items: [
      { key: 'metrics', label: 'Metrics', path: '/explore/metrics' },
      { key: 'logs', label: 'Logs', path: '/explore/logs' },
      { key: 'dashboards', label: 'Dashboards', path: '/dashboards' },
    ],
  },
  {
    id: 'alerts',
    label: 'Alerts & Notifications',
    icon: <NavAlertsIcon sx={{ fontSize: 18 }} />,
    items: [
      { key: 'alerts', label: 'Alert rules', path: '/alerts' },
      { key: 'events', label: 'Events', path: '/events' },
    ],
  },
  {
    id: 'infrastructure',
    label: 'Infrastructure',
    icon: <NavInfraIcon sx={{ fontSize: 18 }} />,
    items: [{ key: 'hosts', label: 'Hosts', path: '/hosts' }],
  },
  {
    id: 'integrations',
    label: 'Integrations',
    icon: <NavIntegrationsIcon sx={{ fontSize: 18 }} />,
    items: [{ key: 'datasources', label: 'Data sources', path: '/datasources' }],
  },
  {
    id: 'organization',
    label: 'Organization',
    icon: <NavOrgIcon sx={{ fontSize: 18 }} />,
    items: [
      { key: 'users', label: 'Users', path: '/users' },
      { key: 'roles', label: 'Roles', path: '/roles' },
    ],
  },
  {
    id: 'system',
    label: 'System',
    icon: <NavSystemIcon sx={{ fontSize: 18 }} />,
    items: [
      { key: 'settings', label: 'Site settings', path: '/settings' },
      { key: 'about', label: 'About', path: '/about' },
    ],
  },
];

const ROUTE_TITLES: Record<NavKey, string> = {
  metrics: 'Metrics explorer',
  logs: 'Log explorer',
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

export function App({ themeMode, onToggleTheme }: { themeMode: ThemeMode; onToggleTheme: () => void }) {
  const muiTheme = useTheme();
  const tokens = PALETTE_TOKENS[muiTheme.palette.mode];
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
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    explorer: true,
    alerts: true,
    infrastructure: true,
    integrations: true,
    organization: true,
    system: true,
  });

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

  const toggleFullscreen = async () => {
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
  };

  const { data: config } = useQuery({
    queryKey: ['perses', 'config'],
    queryFn: fetchPersesConfig,
    retry: false,
  });

  const { data: health } = useQuery({
    queryKey: ['perses', 'health'],
    queryFn: fetchPersesHealth,
    refetchInterval: 30000,
    retry: false,
  });

  const verifySession = async () => {
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
        return;
      }
      if (err instanceof UnauthorizedError) {
        const refreshed = await refreshAuthSession();
        if (refreshed) {
          try {
            await fetchProjects();
            setCurrentUsername(getCurrentPersesUsername());
            setSessionState('authenticated');
            void fetchClusterSiteBranding().then((remote) => {
              setBranding(remote);
            });
            return;
          } catch (refreshErr) {
            if (refreshErr instanceof ForbiddenError) {
              setCurrentUsername(getCurrentPersesUsername());
              setSessionState('authenticated');
              return;
            }
            // Fall through to unauthenticated login view
          }
        }
        setSessionState('unauthenticated');
        return;
      }
      setAuthError(err instanceof Error ? err.message : String(err));
      setSessionState('unauthenticated');
    }
  };

  useEffect(() => {
    void verifySession();
  }, []);

  const handleSaveBranding = async (next: SiteBrandingConfig) => {
    const saved = await saveClusterSiteBranding(next);
    setBranding(saved);
  };

  const handleLogout = async () => {
    await logoutPerses();
    queryClient.clear();
    setCurrentUsername('guest');
    setSessionState('unauthenticated');
  };

  if (sessionState === 'checking') {
    return (
      <Stack
        alignItems="center"
        justifyContent="center"
        spacing={2}
        sx={{ minHeight: '100vh', bgcolor: tokens.bgCanvas }}
      >
        <CircularProgress />
        <Typography variant="body2" color="text.secondary">
          Connecting to {branding.appName} Backend...
        </Typography>
      </Stack>
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

  const renderSidebarContent = (isMobileDrawer: boolean) => {
    const collapsed = isMobileDrawer ? false : sidebarCollapsed;
    return (
      <Box
        sx={{
          width: collapsed ? 64 : 218,
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          bgcolor: tokens.bgSidebar,
          borderRight: `1px solid ${tokens.borderSubtle}`,
          transition: 'width 0.18s ease',
        }}
      >
        {/* Top-Left Perses Brand Header */}
        <Box
          sx={{
            px: collapsed ? 1.25 : 1.75,
            height: 52,
            display: 'flex',
            alignItems: 'center',
            justifyContent: collapsed ? 'center' : 'space-between',
            borderBottom: `1px solid ${tokens.borderSubtle}`,
          }}
        >
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            onClick={() => {
              navigate('/dashboards');
              if (isMobileDrawer) setMobileMenuOpen(false);
            }}
            sx={{ cursor: 'pointer', minWidth: 0 }}
          >
            <PersesLogoMark size={26} logoUrl={branding.logoUrl} logoText={branding.logoText} />
            {!collapsed && (
              <Typography variant="subtitle1" fontWeight={800} letterSpacing="-0.02em" noWrap>
                {branding.appName}
              </Typography>
            )}
          </Stack>

          {!isMobileDrawer && !collapsed && (
            <Tooltip title="Collapse navigation">
              <IconButton size="small" onClick={() => setSidebarCollapsed(true)} sx={{ color: 'text.secondary' }}>
                <SidebarCollapseIcon collapsed={false} />
              </IconButton>
            </Tooltip>
          )}
        </Box>

        {!isMobileDrawer && collapsed && (
          <Stack alignItems="center" sx={{ py: 0.75, borderBottom: `1px solid ${tokens.borderSubtle}` }}>
            <Tooltip title="Expand navigation">
              <IconButton size="small" onClick={() => setSidebarCollapsed(false)} sx={{ color: 'text.secondary' }}>
                <SidebarCollapseIcon collapsed={true} />
              </IconButton>
            </Tooltip>
          </Stack>
        )}

        {/* Navigation Sections */}
        <Box sx={{ flex: 1, overflowY: 'auto', px: 1, py: 1.25 }}>
          {NAV_SECTIONS.map((section) => {
            const isOpen = openSections[section.id] ?? true;
            return (
              <Box key={section.id} sx={{ mb: 0.75 }}>
                <Box
                  onClick={() => {
                    if (collapsed) {
                      navigate(section.items[0].path);
                      return;
                    }
                    setOpenSections((prev) => ({ ...prev, [section.id]: !isOpen }));
                  }}
                  sx={{
                    px: 1,
                    py: 0.75,
                    borderRadius: 1.25,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: collapsed ? 'center' : 'space-between',
                    cursor: 'pointer',
                    color: 'text.secondary',
                    '&:hover': { bgcolor: tokens.bgHover, color: 'text.primary' },
                  }}
                >
                  <Stack direction="row" spacing={1.25} alignItems="center" sx={{ minWidth: 0 }}>
                    {section.icon}
                    {!collapsed && (
                      <Typography variant="caption" fontSize={12.5} fontWeight={600} noWrap>
                        {section.label}
                      </Typography>
                    )}
                  </Stack>
                  {!collapsed && (
                    <Typography variant="caption" fontSize={10} color="text.secondary">
                      {isOpen ? '⌄' : '›'}
                    </Typography>
                  )}
                </Box>

                {!collapsed && (
                  <Collapse in={isOpen}>
                    <Stack spacing={0.25} sx={{ mt: 0.25 }}>
                      {section.items.map((item) => {
                        const selected = activeKey === item.key;
                        return (
                          <Box
                            key={item.key}
                            onClick={() => {
                              navigate(item.path);
                              if (isMobileDrawer) setMobileMenuOpen(false);
                            }}
                            sx={{
                              pl: 4,
                              pr: 1.25,
                              py: 0.7,
                              borderRadius: 1.25,
                              cursor: 'pointer',
                              position: 'relative',
                              fontSize: 13,
                              fontWeight: selected ? 600 : 400,
                              bgcolor: selected ? tokens.bgActiveNav : 'transparent',
                              color: selected ? 'primary.main' : 'text.secondary',
                              '&:hover': { bgcolor: selected ? tokens.bgActiveNav : tokens.bgHover },
                              '&::before': selected
                                ? {
                                  content: '""',
                                  position: 'absolute',
                                  left: 12,
                                  top: 7,
                                  bottom: 7,
                                  width: 2.5,
                                  borderRadius: 2,
                                  bgcolor: 'primary.main',
                                }
                                : undefined,
                            }}
                          >
                            {item.label}
                          </Box>
                        );
                      })}
                    </Stack>
                  </Collapse>
                )}
              </Box>
            );
          })}
        </Box>

        <Divider />

        {/* Bottom User Profile & Theme Toggle */}
        <Box
          sx={{
            p: collapsed ? 1 : 1.5,
            display: 'flex',
            alignItems: 'center',
            justifyContent: collapsed ? 'center' : 'space-between',
            gap: 1,
          }}
        >
          <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
            <Avatar
              sx={{
                width: 28,
                height: 28,
                fontSize: 13,
                fontWeight: 700,
                bgcolor: 'primary.main',
                color: '#FFFFFF',
              }}
            >
              {(currentUsername.trim()[0] || '?').toUpperCase()}
            </Avatar>
            {!collapsed && (
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="caption" fontWeight={700} display="block" noWrap>
                  {currentUsername}
                </Typography>
                <Typography variant="caption" fontSize={10.5} color="text.secondary" display="block" noWrap>
                  {branding.orgName}
                </Typography>
              </Box>
            )}
          </Stack>

          {!collapsed && (
            <Stack direction="row" spacing={0.25} alignItems="center">
              <Tooltip title="Site settings (Logo, Name, Description)">
                <IconButton
                  size="small"
                  onClick={() => {
                    navigate('/settings');
                    if (isMobileDrawer) setMobileMenuOpen(false);
                  }}
                  color={activeKey === 'settings' ? 'primary' : 'inherit'}
                >
                  <NavSystemIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title={`Switch to ${themeMode === 'light' ? 'Dark' : 'Light'} theme`}>
                <IconButton size="small" onClick={onToggleTheme} color="inherit">
                  {themeMode === 'light' ? <MoonIcon fontSize="small" /> : <SunIcon fontSize="small" />}
                </IconButton>
              </Tooltip>
            </Stack>
          )}
        </Box>
      </Box>
    );
  };

  const hideChrome = isEmbedRoute || isFullscreen;

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', bgcolor: tokens.bgCanvas }}>
      {/* Desktop Left Sidebar */}
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
          {renderSidebarContent(false)}
        </Box>
      )}

      {/* Mobile Drawer */}
      {!hideChrome && (
        <Drawer open={mobileMenuOpen} onClose={() => setMobileMenuOpen(false)}>
          {renderSidebarContent(true)}
        </Drawer>
      )}

      {/* Main Column */}
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {/* Top Bar (Nightingale compact white/dark header) */}
        {!hideChrome && (
          <Box
            component="header"
            sx={{
              height: 52,
              px: { xs: 1.5, md: 2.5 },
              bgcolor: tokens.bgHeader,
              borderBottom: `1px solid ${tokens.borderSubtle}`,
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

        {/* Active View Workspace */}
        <Box component="main" sx={{ flex: 1, p: isEmbedRoute ? 1 : isFullscreen ? 1.5 : { xs: 1.5, md: 2 }, minHeight: 0 }}>
          {(activeKey === 'dashboards' || isEmbedRoute) && (
            <DashboardsView
              isEmbed={isEmbedRoute}
              isFullscreen={isFullscreen}
              onToggleFullscreen={toggleFullscreen}
            />
          )}
          {activeKey === 'metrics' && <ExploreView />}
          {activeKey === 'logs' && <LogsExplorerView />}
          {activeKey === 'hosts' && <HostsView />}
          {activeKey === 'alerts' && <AlertRulesView defaultSubTab="rules" />}
          {activeKey === 'events' && <AlertRulesView defaultSubTab="events" />}
          {activeKey === 'datasources' && <DatasourcesView />}
          {activeKey === 'users' && <UsersView />}
          {activeKey === 'roles' && <RolesView />}
          {activeKey === 'settings' && <SiteSettingsView branding={branding} onSaveBranding={handleSaveBranding} />}
          {activeKey === 'about' && <SystemAboutView health={health} config={config} />}
        </Box>
      </Box>
    </Box>
  );
}
