import {
  Box,
  Button,
  Chip,
  FormControl,
  IconButton,
  MenuItem,
  Select,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import Logout from 'mdi-material-ui/Logout';

import { MoonIcon, SidebarCollapseIcon, SunIcon } from '@/components/ui/BrandIcons';
import type { PersesHealthResponse } from '@/lib/api/auth';
import type { AppViewKey } from '@/lib/api/viewPermissions';
import type { UserWorkspaceScope } from '@/lib/api/workspace';
import type { ThemeMode } from '@/theme/persesTheme';
import { ROUTE_TITLES } from './nav';

export interface AppHeaderProps {
  activeKey: AppViewKey;
  themeMode: ThemeMode;
  health: PersesHealthResponse | undefined;
  isNamespaceScoped: boolean;
  userWorkspaces: UserWorkspaceScope[];
  selectedWorkspaceNs: string;
  onSelectWorkspaceNs: (ns: string) => void;
  onOpenMobileMenu: () => void;
  onToggleTheme: () => void;
  onLogout: () => void;
}

export function AppHeader({
  activeKey,
  themeMode,
  health,
  isNamespaceScoped,
  userWorkspaces,
  selectedWorkspaceNs,
  onSelectWorkspaceNs,
  onOpenMobileMenu,
  onToggleTheme,
  onLogout,
}: AppHeaderProps) {
  const theme = useTheme();

  return (
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
          onClick={onOpenMobileMenu}
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
              onChange={(e) => onSelectWorkspaceNs(e.target.value)}
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
          onClick={onLogout}
          sx={{ height: 28, fontSize: 12 }}
        >
          Sign out
        </Button>
      </Stack>
    </Box>
  );
}
