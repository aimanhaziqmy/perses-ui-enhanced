import {
  Avatar,
  Box,
  Collapse,
  Divider,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import ChevronDown from 'mdi-material-ui/ChevronDown';
import ChevronRight from 'mdi-material-ui/ChevronRight';
import React, { useState } from 'react';

import type { AppViewKey, SiteBrandingConfig } from '../api/persesClient';
import type { ThemeMode } from '../theme/persesTheme';
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
} from '@/components/ui/BrandIcons';

export type NavKey =
  | 'metrics'
  | 'logs'
  | 'traces'
  | 'dashboards'
  | 'alerts'
  | 'events'
  | 'hosts'
  | 'datasources'
  | 'users'
  | 'roles'
  | 'settings'
  | 'about';

export interface NavSection {
  id: string;
  label: string;
  icon: React.ReactNode;
  items: Array<{
    key: NavKey;
    label: string;
    path: string;
  }>;
}

export const NAV_SECTIONS: NavSection[] = [
  {
    id: 'explorer',
    label: 'Explorer',
    icon: <NavExplorerIcon sx={{ fontSize: 18 }} />,
    items: [
      { key: 'metrics', label: 'Metrics', path: '/explore/metrics' },
      { key: 'logs', label: 'Logs', path: '/explore/logs' },
      { key: 'traces', label: 'Traces', path: '/explore/traces' },
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

export interface SidebarProps {
  activeKey: NavKey;
  collapsed: boolean;
  isMobileDrawer: boolean;
  branding: SiteBrandingConfig;
  currentUsername: string;
  isSiteAdmin: boolean;
  canManageUsers?: boolean;
  hideClusterInfra?: boolean;
  allowedViews?: Set<AppViewKey>;
  themeMode: ThemeMode;
  onNavigate: (path: string) => void;
  onToggleCollapse: (collapsed: boolean) => void;
  onToggleTheme: () => void;
}

export const Sidebar = React.memo(function Sidebar({
  activeKey,
  collapsed: desktopCollapsed,
  isMobileDrawer,
  branding,
  currentUsername,
  isSiteAdmin,
  canManageUsers = false,
  hideClusterInfra = false,
  allowedViews,
  themeMode,
  onNavigate,
  onToggleCollapse,
  onToggleTheme,
}: SidebarProps) {
  const theme = useTheme();
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    explorer: true,
    alerts: true,
    infrastructure: true,
    integrations: true,
    organization: true,
    system: true,
  });

  const collapsed = isMobileDrawer ? false : desktopCollapsed;

  return (
    <Box
      sx={{
        width: collapsed ? 64 : 218,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        bgcolor: theme.palette.surface.bgSidebar,
        borderRight: `1px solid ${theme.palette.surface.borderSubtle}`,
        transition: 'width 0.18s ease',
      }}
    >
      <Box
        sx={{
          px: collapsed ? 1.25 : 1.75,
          height: 52,
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'space-between',
          borderBottom: `1px solid ${theme.palette.surface.borderSubtle}`,
        }}
      >
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          onClick={() => onNavigate('/dashboards')}
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
            <IconButton size="small" onClick={() => onToggleCollapse(true)} sx={{ color: 'text.secondary' }}>
              <SidebarCollapseIcon collapsed={false} />
            </IconButton>
          </Tooltip>
        )}
      </Box>

      {!isMobileDrawer && collapsed && (
        <Stack
          alignItems="center"
          sx={{ py: 0.75, borderBottom: `1px solid ${theme.palette.surface.borderSubtle}` }}
        >
          <Tooltip title="Expand navigation">
            <IconButton size="small" onClick={() => onToggleCollapse(false)} sx={{ color: 'text.secondary' }}>
              <SidebarCollapseIcon collapsed={true} />
            </IconButton>
          </Tooltip>
        </Stack>
      )}

      <Box sx={{ flex: 1, overflowY: 'auto', px: 1, py: 1.25 }}>
        {NAV_SECTIONS.map((section) => {
          if (section.id === 'organization' && !canManageUsers) return null;
          if (hideClusterInfra && (section.id === 'infrastructure' || section.id === 'integrations')) return null;
          const visibleItems = section.items.filter((item) => {
            if (item.key === 'settings' && !isSiteAdmin) return false;
            if (allowedViews && !allowedViews.has(item.key)) return false;
            return true;
          });
          if (visibleItems.length === 0) return null;
          const isOpen = openSections[section.id] ?? true;
          return (
            <Box key={section.id} sx={{ mb: 0.75 }}>
              <Box
                onClick={() => {
                  if (collapsed) {
                    onNavigate(visibleItems[0].path);
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
                  '&:hover': { bgcolor: theme.palette.surface.bgHover, color: 'text.primary' },
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
                  <Box component="span" sx={{ display: 'inline-flex', color: 'text.secondary' }}>
                    {isOpen ? <ChevronDown sx={{ fontSize: 16 }} /> : <ChevronRight sx={{ fontSize: 16 }} />}
                  </Box>
                )}
              </Box>

              {!collapsed && (
                <Collapse in={isOpen}>
                  <Stack spacing={0.25} sx={{ mt: 0.25 }}>
                    {visibleItems.map((item) => {
                        const selected = activeKey === item.key;
                        return (
                          <Box
                            key={item.key}
                            onClick={() => onNavigate(item.path)}
                            sx={{
                              pl: 4,
                              pr: 1.25,
                              py: 0.7,
                              borderRadius: 1.25,
                              cursor: 'pointer',
                              position: 'relative',
                              fontSize: 13,
                              fontWeight: selected ? 600 : 400,
                              bgcolor: selected ? theme.palette.surface.bgActiveNav : 'transparent',
                              color: selected ? 'primary.main' : 'text.secondary',
                              '&:hover': {
                                bgcolor: selected
                                  ? theme.palette.surface.bgActiveNav
                                  : theme.palette.surface.bgHover,
                              },
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
              color: 'primary.contrastText',
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
            {isSiteAdmin && (
              <Tooltip title="Site settings (Logo, Name, Description)">
                <IconButton
                  size="small"
                  onClick={() => onNavigate('/settings')}
                  color={activeKey === 'settings' ? 'primary' : 'inherit'}
                >
                  <NavSystemIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
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
});
