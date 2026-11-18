import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  Divider,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useQuery } from '@tanstack/react-query';
import LockOutline from 'mdi-material-ui/LockOutline';
import Plus from 'mdi-material-ui/Plus';
import React, { useEffect, useMemo, useState } from 'react';

import {
  APP_VIEWS,
  type AppViewKey,
  DEFAULT_ROLE_VIEW_PERMISSIONS,
  type RoleViewPermissionsConfig,
  fetchPersesGlobalRoles,
  normalizeRoleViewPermissions,
  queryKeys,
} from '@/api/persesClient';

export interface RoleViewPermissionsCardProps {
  rolePermissions: RoleViewPermissionsConfig;
  onSaveRolePermissions: (next: RoleViewPermissionsConfig) => Promise<void>;
  canEdit?: boolean;
}

export function RoleViewPermissionsCard({
  rolePermissions,
  onSaveRolePermissions,
  canEdit = false,
}: RoleViewPermissionsCardProps) {
  const theme = useTheme();
  const [draft, setDraft] = useState<RoleViewPermissionsConfig>(() =>
    normalizeRoleViewPermissions(rolePermissions),
  );
  const [newRoleName, setNewRoleName] = useState('');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    setDraft(normalizeRoleViewPermissions(rolePermissions));
  }, [rolePermissions]);

  const { data: globalRoles = [] } = useQuery({
    queryKey: queryKeys.globalRoles,
    queryFn: fetchPersesGlobalRoles,
    retry: false,
  });

  const allRoleNames = useMemo(() => {
    const set = new Set<string>(Object.keys(draft.roles));
    for (const r of globalRoles) {
      if (r.metadata?.name) set.add(r.metadata.name);
    }
    // Keep standard roles first, then alphabetical
    const priority = ['admin', 'editor', 'operator', 'viewer'];
    return Array.from(set).sort((a, b) => {
      const ia = priority.indexOf(a.toLowerCase());
      const ib = priority.indexOf(b.toLowerCase());
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.localeCompare(b);
    });
  }, [draft.roles, globalRoles]);

  const isViewChecked = (role: string, viewKey: AppViewKey): boolean => {
    if (role.toLowerCase() === 'admin' && viewKey === 'settings') return true;
    const configured = draft.roles[role];
    if (configured) return configured.includes(viewKey);
    return (DEFAULT_ROLE_VIEW_PERMISSIONS.roles.viewer ?? []).includes(viewKey);
  };

  const toggleViewForRole = (role: string, viewKey: AppViewKey) => {
    if (!canEdit) return;
    if (role.toLowerCase() === 'admin' && viewKey === 'settings') return;

    setDraft((prev) => {
      const current = prev.roles[role] ?? [...(DEFAULT_ROLE_VIEW_PERMISSIONS.roles.viewer ?? [])];
      const nextSet = new Set<AppViewKey>(current);
      if (nextSet.has(viewKey)) {
        nextSet.delete(viewKey);
      } else {
        nextSet.add(viewKey);
      }
      if (role.toLowerCase() === 'admin') {
        nextSet.add('settings');
      }
      return {
        ...prev,
        roles: {
          ...prev.roles,
          [role]: Array.from(nextSet),
        },
      };
    });
    setFeedback(null);
  };

  const handleAddRole = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newRoleName.trim();
    if (!trimmed) return;
    if (draft.roles[trimmed]) {
      setNewRoleName('');
      return;
    }
    setDraft((prev) => ({
      ...prev,
      roles: {
        ...prev.roles,
        [trimmed]: ['dashboards', 'logs', 'about'],
      },
    }));
    setNewRoleName('');
    setFeedback(null);
  };

  const handleSave = async () => {
    if (!canEdit) return;
    setSaving(true);
    setFeedback(null);
    try {
      await onSaveRolePermissions(normalizeRoleViewPermissions(draft));
      setFeedback({
        kind: 'success',
        text: 'Role & view permissions saved and synced to Perses cluster storage (GlobalVariable: role_view_permissions_config).',
      });
    } catch (err) {
      setFeedback({
        kind: 'error',
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!canEdit) return;
    setSaving(true);
    setFeedback(null);
    try {
      const defaults = normalizeRoleViewPermissions(DEFAULT_ROLE_VIEW_PERMISSIONS);
      setDraft(defaults);
      await onSaveRolePermissions(defaults);
      setFeedback({
        kind: 'success',
        text: 'Role & view permissions reset to defaults.',
      });
    } catch (err) {
      setFeedback({
        kind: 'error',
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardContent>
        <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 0.5 }}>
          Role &amp; View Permissions
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Control which sidebar views and routes are visible to each GlobalRole or OIDC role. Users without access to a
          route are hidden from its navigation item and redirected to their default permitted view.
        </Typography>

        {!canEdit && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            <strong>403 — Admin Access Required:</strong> Only site administrators can modify role view permissions.
          </Alert>
        )}

        {feedback && (
          <Alert severity={feedback.kind} sx={{ mb: 2 }}>
            {feedback.text}
          </Alert>
        )}

        <Box
          component="form"
          onSubmit={handleAddRole}
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 1.25,
            alignItems: 'center',
            mb: 2,
            p: 1.5,
            borderRadius: 1.5,
            bgcolor: theme.palette.surface.bgSubtle,
            border: `1px solid ${theme.palette.surface.borderSubtle}`,
          }}
        >
          <TextField
            size="small"
            label="Add Role / OIDC Group"
            placeholder="e.g. sre-viewer, platform-ops"
            value={newRoleName}
            onChange={(e) => setNewRoleName(e.target.value)}
            disabled={!canEdit}
            sx={{ minWidth: 240, flex: 1, maxWidth: 340 }}
          />
          <Button
            type="submit"
            size="small"
            variant="outlined"
            startIcon={<Plus fontSize="small" />}
            disabled={!canEdit || !newRoleName.trim()}
          >
            Add Role
          </Button>
          <Typography variant="caption" color="text.secondary">
            Detected {globalRoles.length} Perses GlobalRole(s)
          </Typography>
        </Box>

        <TableContainer
          sx={{
            border: `1px solid ${theme.palette.surface.borderSubtle}`,
            borderRadius: 1.5,
            maxHeight: 540,
          }}
        >
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 700, minWidth: 210 }}>Sidebar View / Route</TableCell>
                {allRoleNames.map((role) => (
                  <TableCell key={role} align="center" sx={{ fontWeight: 700, minWidth: 110 }}>
                    <Stack direction="row" spacing={0.5} alignItems="center" justifyContent="center">
                      <Typography variant="caption" fontWeight={700}>
                        {role}
                      </Typography>
                      {role.toLowerCase() === 'admin' && (
                        <Chip size="small" label="Locked" color="primary" variant="outlined" sx={{ height: 18, fontSize: 10 }} />
                      )}
                    </Stack>
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {APP_VIEWS.map((view) => (
                <TableRow key={view.key} hover>
                  <TableCell>
                    <Typography variant="body2" fontWeight={600} fontSize={13}>
                      {view.label}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" fontFamily="monospace" fontSize={11}>
                      {view.section} · {view.path}
                    </Typography>
                  </TableCell>
                  {allRoleNames.map((role) => {
                    const checked = isViewChecked(role, view.key);
                    const isLockedAdminSettings = role.toLowerCase() === 'admin' && view.key === 'settings';
                    return (
                      <TableCell key={role} align="center">
                        {isLockedAdminSettings ? (
                          <Tooltip title="Admin always retains access to Site Settings to prevent lockout">
                            <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25 }}>
                              <Checkbox size="small" checked={true} disabled />
                              <LockOutline sx={{ fontSize: 14, color: 'text.secondary' }} />
                            </Box>
                          </Tooltip>
                        ) : (
                          <Checkbox
                            size="small"
                            checked={checked}
                            disabled={!canEdit}
                            onChange={() => toggleViewForRole(role, view.key)}
                          />
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>

        <Divider sx={{ my: 2 }} />

        <Stack direction="row" spacing={1.5} justifyContent="flex-end">
          <Button variant="outlined" color="inherit" disabled={!canEdit || saving} onClick={handleReset}>
            Reset to Default
          </Button>
          <Button variant="contained" color="primary" disabled={!canEdit || saving} onClick={handleSave}>
            {saving ? 'Saving...' : 'Save Role Permissions'}
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
}
