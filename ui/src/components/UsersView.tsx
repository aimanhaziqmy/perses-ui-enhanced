import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  IconButton,
  InputLabel,
  ListItemText,
  MenuItem,
  OutlinedInput,
  Select,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import type { ProjectResource, RoleBindingResource, RoleResource } from '@perses-dev/client';
import { getResourceDisplayName } from '@perses-dev/components';
import DeleteOutline from 'mdi-material-ui/DeleteOutline';
import PencilOutline from 'mdi-material-ui/PencilOutline';
import Plus from 'mdi-material-ui/Plus';
import ShieldAccount from 'mdi-material-ui/ShieldAccount';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useEffect, useMemo, useState } from 'react';

import { SsoSettingsCard } from './SsoSettingsCard';
import type {
  PersesFrontendConfig,
  PersesGlobalRoleBindingResource,
  PersesGlobalRoleResource,
  PersesHealthResponse,
  PersesPermission,
  PersesPluginModuleResource,
  PersesUserResource,
  SiteBrandingConfig,
} from '../api/persesClient';
import {
  DEFAULT_SITE_BRANDING,
  ForbiddenError,
  assignUserGlobalRoles,
  assignUserProjectRoles,
  createPersesGlobalRole,
  createPersesUser,
  createProjectRole,
  deletePersesGlobalRole,
  deletePersesUser,
  deleteProjectRole,
  fetchPersesGlobalRoleBindings,
  fetchPersesGlobalRoles,
  fetchPersesPlugins,
  fetchPersesUsers,
  fetchProjectRoleBindings,
  fetchProjectRoles,
  fetchProjects,
  getCurrentPersesUsername,
  updatePersesGlobalRole,
  updatePersesUser,
  updateProjectRole,
} from '../api/persesClient';
import { PALETTE_TOKENS } from '../theme/persesTheme';
import { PersesLogoMark } from './BrandIcons';

const ALL_ACTIONS = ['*', 'create', 'read', 'update', 'delete'];
const ALL_PROJECT_SCOPES = [
  '*',
  'Dashboard',
  'Datasource',
  'EphemeralDashboard',
  'Folder',
  'Project',
  'Role',
  'RoleBinding',
  'Secret',
  'Variable',
];
const ALL_GLOBAL_SCOPES = [
  '*',
  ...ALL_PROJECT_SCOPES.filter((s) => s !== '*'),
  'GlobalDatasource',
  'GlobalRole',
  'GlobalRoleBinding',
  'GlobalSecret',
  'GlobalVariable',
  'User',
];

function formatIso(ts?: string): string {
  if (!ts) return '-';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

interface UserFormState {
  mode: 'create' | 'edit';
  username: string;
  firstName: string;
  lastName: string;
  password: string;
  isOAuth: boolean;
  globalRoles: string[];
  projectRoles: Record<string, string[]>;
}

export function UsersView() {
  const muiTheme = useTheme();
  const mode = muiTheme.palette.mode;
  const tokens = PALETTE_TOKENS[mode];
  const queryClient = useQueryClient();
  const currentUsername = getCurrentPersesUsername();

  const [search, setSearch] = useState('');
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<UserFormState>({
    mode: 'create',
    username: '',
    firstName: '',
    lastName: '',
    password: '',
    isOAuth: false,
    globalRoles: ['viewer'],
    projectRoles: {},
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PersesUserResource | null>(null);
  const [deleting, setDeleting] = useState(false);

  const { data: users = [], isLoading, error } = useQuery<PersesUserResource[], Error>({
    queryKey: ['perses', 'users'],
    queryFn: fetchPersesUsers,
  });

  const { data: globalRoles = [] } = useQuery<PersesGlobalRoleResource[], Error>({
    queryKey: ['perses', 'globalroles'],
    queryFn: fetchPersesGlobalRoles,
  });

  const { data: globalBindings = [] } = useQuery<PersesGlobalRoleBindingResource[], Error>({
    queryKey: ['perses', 'globalrolebindings'],
    queryFn: fetchPersesGlobalRoleBindings,
  });

  const { data: projects = [] } = useQuery<ProjectResource[], Error>({
    queryKey: ['perses', 'projects'],
    queryFn: fetchProjects,
  });

  const { data: projectRbac = [] } = useQuery<
    Array<{ project: string; roles: RoleResource[]; bindings: RoleBindingResource[] }>,
    Error
  >({
    queryKey: ['perses', 'all-project-rbac', projects.map((p) => p.metadata.name).join(',')],
    queryFn: async () =>
      Promise.all(
        projects.map(async (p) => {
          const [roles, bindings] = await Promise.all([
            fetchProjectRoles(p.metadata.name).catch(() => []),
            fetchProjectRoleBindings(p.metadata.name).catch(() => []),
          ]);
          return { project: p.metadata.name, roles, bindings };
        }),
      ),
    enabled: projects.length > 0,
  });

  const globalRoleMap = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const b of globalBindings) {
      for (const s of b.spec.subjects ?? []) {
        if (s.kind === 'User') {
          const list = m.get(s.name) ?? [];
          if (!list.includes(b.spec.role)) list.push(b.spec.role);
          m.set(s.name, list);
        }
      }
    }
    return m;
  }, [globalBindings]);

  // user -> project -> role[]
  const projectRoleMap = useMemo(() => {
    const m = new Map<string, Record<string, string[]>>();
    for (const entry of projectRbac) {
      for (const b of entry.bindings) {
        for (const s of b.spec.subjects ?? []) {
          if (s.kind === 'User') {
            const byProj = m.get(s.name) ?? {};
            const list = byProj[entry.project] ?? [];
            if (!list.includes(b.spec.role)) list.push(b.spec.role);
            byProj[entry.project] = list;
            m.set(s.name, byProj);
          }
        }
      }
    }
    return m;
  }, [projectRbac]);

  const invalidateRbac = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['perses', 'users'] }),
      queryClient.invalidateQueries({ queryKey: ['perses', 'globalroles'] }),
      queryClient.invalidateQueries({ queryKey: ['perses', 'globalrolebindings'] }),
      queryClient.invalidateQueries({ queryKey: ['perses', 'all-project-rbac'] }),
    ]);
  };

  const openCreateUser = () => {
    setFormError(null);
    const defaultRole = globalRoles.some((r) => r.metadata.name === 'viewer')
      ? ['viewer']
      : globalRoles[0]
        ? [globalRoles[0].metadata.name]
        : [];
    setForm({
      mode: 'create',
      username: '',
      firstName: '',
      lastName: '',
      password: '',
      isOAuth: false,
      globalRoles: defaultRole,
      projectRoles: {},
    });
    setFormOpen(true);
  };

  const openEditUser = (user: PersesUserResource) => {
    setFormError(null);
    const isOAuth = Boolean(user.spec?.oauthProviders && user.spec.oauthProviders.length > 0);
    const existingGlobal = globalRoleMap.get(user.metadata.name) ?? [];
    const existingProj = projectRoleMap.get(user.metadata.name) ?? {};
    setForm({
      mode: 'edit',
      username: user.metadata.name,
      firstName: user.spec?.firstName ?? '',
      lastName: user.spec?.lastName ?? '',
      password: '',
      isOAuth,
      globalRoles: [...existingGlobal],
      projectRoles: Object.fromEntries(Object.entries(existingProj).map(([p, roles]) => [p, [...roles]])),
    });
    setFormOpen(true);
  };

  const handleSeedProjectRoles = async (project: string) => {
    setFormError(null);
    try {
      const defaults: Array<{ name: string; permissions: PersesPermission[] }> = [
        { name: 'admin', permissions: [{ actions: ['*'], scopes: ['*'] }] },
        {
          name: 'editor',
          permissions: [
            { actions: ['*'], scopes: ['Dashboard', 'Datasource', 'EphemeralDashboard', 'Folder', 'Variable'] },
            { actions: ['read'], scopes: ['Project', 'Role', 'RoleBinding'] },
          ],
        },
        {
          name: 'viewer',
          permissions: [{ actions: ['read'], scopes: ['Dashboard', 'Datasource', 'EphemeralDashboard', 'Folder', 'Project', 'Variable'] }],
        },
      ];
      for (const def of defaults) {
        try {
          await createProjectRole(project, {
            kind: 'Role',
            metadata: { name: def.name, project },
            spec: { permissions: def.permissions as RoleResource['spec']['permissions'] },
          });
        } catch (roleErr) {
          if (roleErr instanceof Error && roleErr.message.includes('HTTP 409')) {
            continue;
          }
          throw roleErr;
        }
      }
      await invalidateRbac();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    const username = form.username.trim();
    if (!username) {
      setFormError('Username is required.');
      return;
    }
    if (!/^[a-zA-Z0-9._@-]+$/.test(username)) {
      setFormError('Username can only contain letters, numbers, ".", "_", "@", and "-".');
      return;
    }
    if (form.mode === 'create' && !form.password) {
      setFormError('Password is required when creating a local native user.');
      return;
    }

    setSaving(true);
    setFormError(null);
    setFeedback(null);

    try {
      if (form.mode === 'create') {
        await createPersesUser({
          kind: 'User',
          metadata: { name: username },
          spec: {
            firstName: form.firstName.trim() || undefined,
            lastName: form.lastName.trim() || undefined,
            nativeProvider: { password: form.password },
          },
        });
        setForm((prev) => ({ ...prev, mode: 'edit', password: '' }));
        await queryClient.invalidateQueries({ queryKey: ['perses', 'users'] });
      } else {
        const existingUser = users.find((u) => u.metadata.name === username);
        const nextSpec: PersesUserResource['spec'] = {
          ...(existingUser?.spec ?? {}),
          firstName: form.firstName.trim() || undefined,
          lastName: form.lastName.trim() || undefined,
        };
        if (form.password) {
          nextSpec.nativeProvider = { password: form.password };
        }
        await updatePersesUser({
          kind: 'User',
          metadata: { name: username },
          spec: nextSpec,
        });
      }

      // Sync GlobalRoleBindings using fresh backend bindings
      await assignUserGlobalRoles(username, form.globalRoles);

      // Sync Per-Project RoleBindings using fresh backend bindings
      for (const entry of projectRbac) {
        const desired = form.projectRoles[entry.project] ?? [];
        const current = projectRoleMap.get(username)?.[entry.project] ?? [];
        const changed =
          desired.length !== current.length || desired.some((r) => !current.includes(r));
        if (changed) {
          await assignUserProjectRoles(entry.project, username, desired);
        }
      }

      await invalidateRbac();
      setFormOpen(false);
      setFeedback({
        kind: 'success',
        text: `${form.mode === 'create' ? 'Created' : 'Updated'} user "${username}" and synced role bindings.`,
      });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteUser = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setFeedback(null);
    try {
      const targetName = deleteTarget.metadata.name;
      await assignUserGlobalRoles(targetName, [], globalBindings);
      for (const entry of projectRbac) {
        await assignUserProjectRoles(entry.project, targetName, [], entry.bindings);
      }
      await deletePersesUser(targetName);
      await invalidateRbac();
      setFeedback({ kind: 'success', text: `Deleted user "${targetName}".` });
      setDeleteTarget(null);
    } catch (err) {
      setFeedback({ kind: 'error', text: err instanceof Error ? err.message : String(err) });
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => {
      const alias = `${u.spec?.firstName ?? ''} ${u.spec?.lastName ?? ''}`.trim();
      return `${u.metadata.name} ${alias}`.toLowerCase().includes(q);
    });
  }, [users, search]);

  if (isLoading) {
    return (
      <Stack alignItems="center" justifyContent="center" sx={{ py: 8 }}>
        <CircularProgress />
      </Stack>
    );
  }

  if (error) {
    return (
      <Alert severity={error instanceof ForbiddenError ? 'warning' : 'error'}>
        {error instanceof ForbiddenError ? error.message : `Failed to load Perses users: ${error.message}`}
      </Alert>
    );
  }

  return (
    <Stack spacing={1.5}>
      {feedback && (
        <Alert severity={feedback.kind} onClose={() => setFeedback(null)}>
          {feedback.text}
        </Alert>
      )}

      <Card>
        <Box
          sx={{
            p: 1.75,
            borderBottom: `1px solid ${tokens.borderSubtle}`,
            display: 'flex',
            flexWrap: 'wrap',
            gap: 1.5,
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <Stack direction="row" spacing={1.5} alignItems="center">
            <TextField
              size="small"
              placeholder="Username, first name or last name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              sx={{ width: { xs: '100%', sm: 290 }, '& .MuiInputBase-input': { fontSize: 13, py: 0.75 } }}
            />
            <Chip size="small" variant="outlined" label={`Total ${filtered.length} users`} />
          </Stack>

          <Button size="small" variant="contained" startIcon={<Plus />} onClick={openCreateUser}>
            Add local user
          </Button>
        </Box>

        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Username</TableCell>
                <TableCell>Display Name</TableCell>
                <TableCell>Global Roles</TableCell>
                <TableCell>Project Roles</TableCell>
                <TableCell>Account source</TableCell>
                <TableCell>Created</TableCell>
                <TableCell align="right" width={120}>
                  Operations
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filtered.map((user) => {
                const gRoles = globalRoleMap.get(user.metadata.name) ?? [];
                const pRoles = projectRoleMap.get(user.metadata.name) ?? {};
                const projectBadges = Object.entries(pRoles).flatMap(([proj, rList]) =>
                  rList.map((r) => `${proj}:${r}`),
                );
                const alias = `${user.spec?.firstName ?? ''} ${user.spec?.lastName ?? ''}`.trim() || '-';
                const isOAuth = Boolean(user.spec?.oauthProviders && user.spec.oauthProviders.length > 0);
                const isSelf = user.metadata.name === currentUsername;

                return (
                  <TableRow key={user.metadata.name} hover>
                    <TableCell sx={{ fontWeight: 600 }}>
                      <Stack direction="row" spacing={0.75} alignItems="center">
                        <span>{user.metadata.name}</span>
                        {isSelf && <Chip size="small" label="You" color="primary" sx={{ height: 18, fontSize: 10 }} />}
                      </Stack>
                    </TableCell>
                    <TableCell>{alias}</TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                        {gRoles.length === 0 ? (
                          <Typography variant="caption" color="text.secondary">
                            None
                          </Typography>
                        ) : (
                          gRoles.map((r) => (
                            <Chip
                              key={r}
                              size="small"
                              color={r === 'admin' ? 'primary' : 'default'}
                              variant="outlined"
                              label={r}
                              sx={{ height: 21, fontSize: 11 }}
                            />
                          ))
                        )}
                      </Stack>
                    </TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                        {projectBadges.length === 0 ? (
                          <Typography variant="caption" color="text.secondary">
                            Inherited / None
                          </Typography>
                        ) : (
                          projectBadges.map((b) => (
                            <Chip key={b} size="small" variant="outlined" label={b} sx={{ height: 21, fontSize: 11 }} />
                          ))
                        )}
                      </Stack>
                    </TableCell>
                    <TableCell>{isOAuth ? 'OAuth / OIDC' : 'Local Native'}</TableCell>
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: 12, color: 'text.secondary' }}>
                      {formatIso(user.metadata.createdAt)}
                    </TableCell>
                    <TableCell align="right">
                      <Tooltip title="Edit user & roles">
                        <IconButton size="small" onClick={() => openEditUser(user)}>
                          <PencilOutline fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title={isSelf ? 'Cannot delete active signed-in user' : 'Delete user'}>
                        <span>
                          <IconButton
                            size="small"
                            color="error"
                            disabled={isSelf}
                            onClick={() => setDeleteTarget(user)}
                          >
                            <DeleteOutline fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      {/* Create / Edit Local User & Role Assignment Dialog */}
      <Dialog open={formOpen} onClose={() => setFormOpen(false)} maxWidth="sm" fullWidth>
        <Box component="form" onSubmit={handleSaveUser}>
          <DialogTitle>{form.mode === 'create' ? 'Add Local User' : `Edit User: ${form.username}`}</DialogTitle>
          <DialogContent dividers>
            <Stack spacing={2}>
              {formError && <Alert severity="error">{formError}</Alert>}

              <TextField
                label="Username"
                placeholder="e.g. alice"
                value={form.username}
                onChange={(e) => setForm((prev) => ({ ...prev, username: e.target.value }))}
                disabled={form.mode === 'edit'}
                required
                fullWidth
                size="small"
              />

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  label="First Name"
                  value={form.firstName}
                  onChange={(e) => setForm((prev) => ({ ...prev, firstName: e.target.value }))}
                  fullWidth
                  size="small"
                />
                <TextField
                  label="Last Name"
                  value={form.lastName}
                  onChange={(e) => setForm((prev) => ({ ...prev, lastName: e.target.value }))}
                  fullWidth
                  size="small"
                />
              </Stack>

              {!form.isOAuth && (
                <TextField
                  label={form.mode === 'create' ? 'Password' : 'New Password (leave blank to keep unchanged)'}
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))}
                  required={form.mode === 'create'}
                  fullWidth
                  size="small"
                  autoComplete="new-password"
                />
              )}

              <Divider />

              <FormControl size="small" fullWidth>
                <InputLabel id="user-global-roles-label">Global Roles</InputLabel>
                <Select
                  labelId="user-global-roles-label"
                  multiple
                  value={form.globalRoles}
                  onChange={(e) => {
                    const val = e.target.value;
                    setForm((prev) => ({
                      ...prev,
                      globalRoles: typeof val === 'string' ? val.split(',') : val,
                    }));
                  }}
                  input={<OutlinedInput label="Global Roles" />}
                  renderValue={(selected) => (selected.length > 0 ? selected.join(', ') : 'None')}
                >
                  {globalRoles.map((r) => (
                    <MenuItem key={r.metadata.name} value={r.metadata.name}>
                      <Checkbox checked={form.globalRoles.includes(r.metadata.name)} size="small" />
                      <ListItemText primary={r.metadata.name} />
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <Box>
                <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
                  Per-Project Roles
                </Typography>
                {projects.length === 0 ? (
                  <Typography variant="caption" color="text.secondary">
                    No projects exist yet. Create a project in Dashboards to assign project-scoped roles.
                  </Typography>
                ) : (
                  <Stack spacing={1.25}>
                    {projectRbac.map((entry) => {
                      const selectedRoles = form.projectRoles[entry.project] ?? [];
                      return (
                        <Stack
                          key={entry.project}
                          direction={{ xs: 'column', sm: 'row' }}
                          spacing={1}
                          alignItems={{ xs: 'stretch', sm: 'center' }}
                        >
                          <Typography variant="body2" fontWeight={600} sx={{ minWidth: 140 }}>
                            {entry.project}
                          </Typography>
                          {entry.roles.length === 0 ? (
                            <Button
                              size="small"
                              variant="outlined"
                              startIcon={<ShieldAccount />}
                              onClick={() => void handleSeedProjectRoles(entry.project)}
                            >
                              Initialize starter roles (admin/editor/viewer)
                            </Button>
                          ) : (
                            <FormControl size="small" fullWidth>
                              <Select
                                multiple
                                displayEmpty
                                value={selectedRoles}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  const next = typeof val === 'string' ? val.split(',') : val;
                                  setForm((prev) => ({
                                    ...prev,
                                    projectRoles: { ...prev.projectRoles, [entry.project]: next },
                                  }));
                                }}
                                renderValue={(sel) => (sel.length > 0 ? sel.join(', ') : 'No project role')}
                              >
                                {entry.roles.map((r) => (
                                  <MenuItem key={r.metadata.name} value={r.metadata.name}>
                                    <Checkbox checked={selectedRoles.includes(r.metadata.name)} size="small" />
                                    <ListItemText primary={r.metadata.name} />
                                  </MenuItem>
                                ))}
                              </Select>
                            </FormControl>
                          )}
                        </Stack>
                      );
                    })}
                  </Stack>
                )}
              </Box>
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setFormOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" variant="contained" disabled={saving}>
              {saving ? 'Saving...' : form.mode === 'create' ? 'Create User' : 'Save Changes'}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>

      {/* Delete User Confirmation Dialog */}
      <Dialog open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete User</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2">
            Are you sure you want to delete user <strong>{deleteTarget?.metadata.name}</strong> and remove their role
            bindings?
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)} disabled={deleting}>
            Cancel
          </Button>
          <Button color="error" variant="contained" onClick={handleDeleteUser} disabled={deleting}>
            {deleting ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

interface RoleFormState {
  mode: 'create' | 'edit';
  scope: 'global' | 'project';
  project: string;
  name: string;
  permissions: PersesPermission[];
}

export function RolesView() {
  const muiTheme = useTheme();
  const tokens = PALETTE_TOKENS[muiTheme.palette.mode];
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<'global' | 'project'>('global');
  const [selectedProject, setSelectedProject] = useState<string>('');
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<RoleFormState>({
    mode: 'create',
    scope: 'global',
    project: '',
    name: '',
    permissions: [{ actions: ['read'], scopes: ['Dashboard'] }],
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ scope: 'global' | 'project'; project?: string; name: string } | null>(
    null,
  );
  const [deleting, setDeleting] = useState(false);

  const {
    data: globalRoles = [],
    isLoading: loadingGlobal,
    error: globalError,
  } = useQuery<PersesGlobalRoleResource[], Error>({
    queryKey: ['perses', 'globalroles'],
    queryFn: fetchPersesGlobalRoles,
  });

  const { data: projects = [] } = useQuery<ProjectResource[], Error>({
    queryKey: ['perses', 'projects'],
    queryFn: fetchProjects,
  });

  useEffect(() => {
    if (projects.length > 0 && (!selectedProject || !projects.some((p) => p.metadata.name === selectedProject))) {
      setSelectedProject(projects[0].metadata.name);
    }
  }, [projects, selectedProject]);

  const {
    data: projectRoles = [],
    isInitialLoading: loadingProject,
    error: projectError,
  } = useQuery<RoleResource[], Error>({
    queryKey: ['perses', 'projectroles', selectedProject],
    queryFn: () => fetchProjectRoles(selectedProject),
    enabled: Boolean(selectedProject) && tab === 'project',
  });

  const openCreateRole = () => {
    setFormError(null);
    setForm({
      mode: 'create',
      scope: tab,
      project: selectedProject || projects[0]?.metadata.name || '',
      name: '',
      permissions: [{ actions: ['read'], scopes: ['Dashboard'] }],
    });
    setFormOpen(true);
  };

  const openEditRole = (scope: 'global' | 'project', role: PersesGlobalRoleResource | RoleResource) => {
    setFormError(null);
    setForm({
      mode: 'edit',
      scope,
      project: scope === 'project' ? (role as RoleResource).metadata.project : '',
      name: role.metadata.name,
      permissions: role.spec.permissions.map((p) => ({
        actions: [...p.actions],
        scopes: [...p.scopes],
      })),
    });
    setFormOpen(true);
  };

  const handleSaveRole = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = form.name.trim();
    if (!name) {
      setFormError('Role name is required.');
      return;
    }
    if (form.permissions.length === 0) {
      setFormError('At least one permission rule is required.');
      return;
    }

    setSaving(true);
    setFormError(null);
    setFeedback(null);

    try {
      if (form.scope === 'global') {
        const payload: PersesGlobalRoleResource = {
          kind: 'GlobalRole',
          metadata: { name },
          spec: { permissions: form.permissions },
        };
        if (form.mode === 'create') {
          await createPersesGlobalRole(payload);
        } else {
          await updatePersesGlobalRole(payload);
        }
        await queryClient.invalidateQueries({ queryKey: ['perses', 'globalroles'] });
      } else {
        const payload: RoleResource = {
          kind: 'Role',
          metadata: { name, project: form.project },
          spec: { permissions: form.permissions as RoleResource['spec']['permissions'] },
        };
        if (form.mode === 'create') {
          await createProjectRole(form.project, payload);
        } else {
          await updateProjectRole(form.project, payload);
        }
        await queryClient.invalidateQueries({ queryKey: ['perses', 'projectroles', form.project] });
        await queryClient.invalidateQueries({ queryKey: ['perses', 'all-project-rbac'] });
      }
      setFormOpen(false);
      setFeedback({
        kind: 'success',
        text: `${form.mode === 'create' ? 'Created' : 'Updated'} ${form.scope === 'global' ? 'GlobalRole' : 'Role'} "${name}".`,
      });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteRole = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setFeedback(null);
    try {
      if (deleteTarget.scope === 'global') {
        await deletePersesGlobalRole(deleteTarget.name);
        await queryClient.invalidateQueries({ queryKey: ['perses', 'globalroles'] });
      } else {
        await deleteProjectRole(deleteTarget.project!, deleteTarget.name);
        await queryClient.invalidateQueries({ queryKey: ['perses', 'projectroles', deleteTarget.project] });
        await queryClient.invalidateQueries({ queryKey: ['perses', 'all-project-rbac'] });
      }
      setFeedback({ kind: 'success', text: `Deleted role "${deleteTarget.name}".` });
      setDeleteTarget(null);
    } catch (err) {
      setFeedback({ kind: 'error', text: err instanceof Error ? err.message : String(err) });
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  const activeError = tab === 'global' ? globalError : projectError;
  const activeLoading = tab === 'global' ? loadingGlobal : loadingProject;
  const activeRoles = tab === 'global' ? globalRoles : projectRoles;
  const availableScopes = form.scope === 'global' ? ALL_GLOBAL_SCOPES : ALL_PROJECT_SCOPES;

  return (
    <Stack spacing={1.5}>
      {feedback && (
        <Alert severity={feedback.kind} onClose={() => setFeedback(null)}>
          {feedback.text}
        </Alert>
      )}

      <Card>
        <Box
          sx={{
            px: 2,
            borderBottom: `1px solid ${tokens.borderSubtle}`,
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 1.5,
          }}
        >
          <Tabs
            value={tab}
            onChange={(_, v: 'global' | 'project') => setTab(v)}
            sx={{ minHeight: 42, '& .MuiTab-root': { minHeight: 42, py: 0.75, fontSize: 13 } }}
          >
            <Tab value="global" label={`Global Roles (${globalRoles.length})`} />
            <Tab value="project" label="Project Roles" />
          </Tabs>

          <Stack direction="row" spacing={1.25} alignItems="center" sx={{ py: 0.75 }}>
            {tab === 'project' && (
              <FormControl size="small" sx={{ minWidth: 180 }}>
                <Select
                  value={selectedProject}
                  displayEmpty
                  onChange={(e) => setSelectedProject(e.target.value)}
                >
                  {projects.length === 0 ? (
                    <MenuItem value="" disabled>
                      No projects
                    </MenuItem>
                  ) : (
                    projects.map((p) => (
                      <MenuItem key={p.metadata.name} value={p.metadata.name}>
                        {getResourceDisplayName(p)}
                      </MenuItem>
                    ))
                  )}
                </Select>
              </FormControl>
            )}

            <Button
              size="small"
              variant="contained"
              startIcon={<Plus />}
              disabled={tab === 'project' && !selectedProject}
              onClick={openCreateRole}
            >
              Add {tab === 'global' ? 'GlobalRole' : 'Project Role'}
            </Button>
          </Stack>
        </Box>

        {activeError ? (
          <Box sx={{ p: 2 }}>
            <Alert severity={activeError instanceof ForbiddenError ? 'warning' : 'error'}>
              {activeError instanceof ForbiddenError
                ? activeError.message
                : `Failed to load roles: ${activeError.message}`}
            </Alert>
          </Box>
        ) : activeLoading ? (
          <Stack alignItems="center" justifyContent="center" sx={{ py: 8 }}>
            <CircularProgress />
          </Stack>
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Role Name</TableCell>
                  <TableCell>Permissions (Actions &amp; Scopes)</TableCell>
                  <TableCell>Created</TableCell>
                  <TableCell>Updated</TableCell>
                  <TableCell align="right" width={110}>
                    Operations
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {activeRoles.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} align="center" sx={{ py: 5 }}>
                      <Typography variant="body2" color="text.secondary">
                        No {tab === 'global' ? 'global' : 'project'} roles defined yet.
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  activeRoles.map((role) => (
                    <TableRow key={role.metadata.name} hover>
                      <TableCell sx={{ fontWeight: 600 }}>{role.metadata.name}</TableCell>
                      <TableCell>
                        <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                          {role.spec.permissions.map((perm, idx) => (
                            <Chip
                              key={idx}
                              size="small"
                              variant="outlined"
                              label={`${perm.actions.join(',')} on ${perm.scopes.join(',')}`}
                              sx={{ fontFamily: 'monospace', fontSize: 11.5 }}
                            />
                          ))}
                        </Stack>
                      </TableCell>
                      <TableCell sx={{ fontFamily: 'monospace', fontSize: 12, color: 'text.secondary' }}>
                        {formatIso(role.metadata.createdAt)}
                      </TableCell>
                      <TableCell sx={{ fontFamily: 'monospace', fontSize: 12, color: 'text.secondary' }}>
                        {formatIso(role.metadata.updatedAt)}
                      </TableCell>
                      <TableCell align="right">
                        <IconButton size="small" onClick={() => openEditRole(tab, role)}>
                          <PencilOutline fontSize="small" />
                        </IconButton>
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() =>
                            setDeleteTarget({
                              scope: tab,
                              project: tab === 'project' ? selectedProject : undefined,
                              name: role.metadata.name,
                            })
                          }
                        >
                          <DeleteOutline fontSize="small" />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Card>

      {/* Create / Edit Role Dialog */}
      <Dialog open={formOpen} onClose={() => setFormOpen(false)} maxWidth="md" fullWidth>
        <Box component="form" onSubmit={handleSaveRole}>
          <DialogTitle>
            {form.mode === 'create' ? 'Create' : 'Edit'} {form.scope === 'global' ? 'GlobalRole' : `Project Role (${form.project})`}
          </DialogTitle>
          <DialogContent dividers>
            <Stack spacing={2}>
              {formError && <Alert severity="error">{formError}</Alert>}
              <TextField
                label="Role Name"
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                disabled={form.mode === 'edit'}
                required
                size="small"
                fullWidth
              />

              <Typography variant="subtitle2" fontWeight={700}>
                Permissions
              </Typography>

              {form.permissions.map((perm, idx) => (
                <Stack key={idx} direction={{ xs: 'column', sm: 'row' }} spacing={1.25} alignItems="center">
                  <FormControl size="small" sx={{ minWidth: 200, flex: 1 }}>
                    <InputLabel>Actions</InputLabel>
                    <Select
                      multiple
                      value={perm.actions}
                      onChange={(e) => {
                        const val = typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value;
                        setForm((prev) => ({
                          ...prev,
                          permissions: prev.permissions.map((p, i) => (i === idx ? { ...p, actions: val } : p)),
                        }));
                      }}
                      input={<OutlinedInput label="Actions" />}
                      renderValue={(s) => s.join(', ')}
                    >
                      {ALL_ACTIONS.map((a) => (
                        <MenuItem key={a} value={a}>
                          <Checkbox checked={perm.actions.includes(a)} size="small" />
                          <ListItemText primary={a} />
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>

                  <FormControl size="small" sx={{ minWidth: 260, flex: 1.5 }}>
                    <InputLabel>Scopes</InputLabel>
                    <Select
                      multiple
                      value={perm.scopes}
                      onChange={(e) => {
                        const val = typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value;
                        setForm((prev) => ({
                          ...prev,
                          permissions: prev.permissions.map((p, i) => (i === idx ? { ...p, scopes: val } : p)),
                        }));
                      }}
                      input={<OutlinedInput label="Scopes" />}
                      renderValue={(s) => s.join(', ')}
                    >
                      {availableScopes.map((sc) => (
                        <MenuItem key={sc} value={sc}>
                          <Checkbox checked={perm.scopes.includes(sc)} size="small" />
                          <ListItemText primary={sc} />
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>

                  <IconButton
                    size="small"
                    color="error"
                    disabled={form.permissions.length <= 1}
                    onClick={() =>
                      setForm((prev) => ({
                        ...prev,
                        permissions: prev.permissions.filter((_, i) => i !== idx),
                      }))
                    }
                  >
                    <DeleteOutline fontSize="small" />
                  </IconButton>
                </Stack>
              ))}

              <Box>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<Plus />}
                  onClick={() =>
                    setForm((prev) => ({
                      ...prev,
                      permissions: [...prev.permissions, { actions: ['read'], scopes: ['Dashboard'] }],
                    }))
                  }
                >
                  Add permission rule
                </Button>
              </Box>
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setFormOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" variant="contained" disabled={saving}>
              {saving ? 'Saving...' : 'Save Role'}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>

      {/* Delete Role Dialog */}
      <Dialog open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete Role</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2">
            Are you sure you want to delete role <strong>{deleteTarget?.name}</strong>?
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)} disabled={deleting}>
            Cancel
          </Button>
          <Button color="error" variant="contained" onClick={handleDeleteRole} disabled={deleting}>
            {deleting ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

export function SystemAboutView({
  health,
  config,
}: {
  health: PersesHealthResponse | undefined;
  config: PersesFrontendConfig | undefined;
}) {
  const { data: plugins = [] } = useQuery<PersesPluginModuleResource[], Error>({
    queryKey: ['perses', 'plugins'],
    queryFn: fetchPersesPlugins,
    retry: false,
  });

  return (
    <Stack spacing={2}>
      <Card>
        <CardContent>
          <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1.5 }}>
            Perses Observability Runtime
          </Typography>
          <Table size="small">
            <TableBody>
              <TableRow>
                <TableCell sx={{ fontWeight: 600, width: 220 }}>Perses Backend Version</TableCell>
                <TableCell sx={{ fontFamily: 'monospace' }}>{health?.version ?? '-'}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>Build Time</TableCell>
                <TableCell sx={{ fontFamily: 'monospace' }}>{health?.buildTime ?? '-'}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>Git Commit</TableCell>
                <TableCell sx={{ fontFamily: 'monospace' }}>{health?.commit ?? '-'}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>Database Status</TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    color={health?.database === false ? 'error' : 'success'}
                    label={health?.database === false ? 'Unavailable' : 'Healthy'}
                  />
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>Authentication</TableCell>
                <TableCell>
                  {config?.security?.enable_auth ? 'Enabled (Native + OAuth/OIDC)' : 'Disabled'}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>Platform Banner</TableCell>
                <TableCell>{config?.frontend?.information ?? 'Unified Observability Stack'}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1.5 }}>
            Loaded Perses Backend Plugins ({plugins.length} modules)
          </Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {plugins.map((mod, idx) => (
              <Chip
                key={`${mod.metadata?.name ?? 'mod'}-${idx}`}
                size="small"
                variant="outlined"
                label={`${mod.metadata?.name ?? 'Plugin'} ${mod.metadata?.version ? `v${mod.metadata.version}` : ''}`}
                sx={{ fontFamily: 'monospace' }}
              />
            ))}
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  );
}

export function SiteSettingsView({
  branding,
  onSaveBranding,
  canEdit = false,
}: {
  branding: SiteBrandingConfig;
  onSaveBranding: (next: SiteBrandingConfig) => Promise<void>;
  canEdit?: boolean;
}) {
  const muiTheme = useTheme();
  const tokens = PALETTE_TOKENS[muiTheme.palette.mode];

  const [draft, setDraft] = useState<SiteBrandingConfig>(branding);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    setDraft(branding);
  }, [branding]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 512 * 1024) {
      setSaveMessage({ kind: 'error', text: 'Logo image must be 512 KB or smaller (PNG, SVG, JPG, or WebP).' });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      if (result) {
        setDraft((prev) => ({ ...prev, logoUrl: result }));
        setSaveMessage(null);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) return;
    setSaving(true);
    setSaveMessage(null);
    try {
      await onSaveBranding(draft);
      setSaveMessage({
        kind: 'success',
        text: 'Site branding saved and synced to Perses backend (GlobalVariable: site_branding_config).',
      });
    } catch (err) {
      setSaveMessage({
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
    setSaveMessage(null);
    try {
      setDraft(DEFAULT_SITE_BRANDING);
      await onSaveBranding(DEFAULT_SITE_BRANDING);
      setSaveMessage({ kind: 'success', text: 'Site branding reset to defaults.' });
    } catch (err) {
      setSaveMessage({
        kind: 'error',
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Stack spacing={2}>
      <Card>
        <CardContent>
          <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 0.5 }}>
            Site Branding &amp; Customization
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
            Dynamically customize the logo, product name, description, and organization label across the navigation bar,
            login screen, and browser title. Settings are saved in Perses cluster storage and cached locally.
          </Typography>

          {/* Live Preview Banner */}
          <Box
            sx={{
              p: 2,
              mb: 3,
              borderRadius: 1.5,
              border: `1px solid ${tokens.borderSubtle}`,
              bgcolor: tokens.bgSubtle,
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 2,
            }}
          >
            <Stack direction="row" spacing={1.5} alignItems="center">
              <PersesLogoMark size={38} logoUrl={draft.logoUrl} logoText={draft.logoText} />
              <Box>
                <Typography variant="subtitle1" fontWeight={800} lineHeight={1.2}>
                  {draft.appName || DEFAULT_SITE_BRANDING.appName}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {draft.appSubtitle || DEFAULT_SITE_BRANDING.appSubtitle}
                </Typography>
              </Box>
            </Stack>
            <Chip
              size="small"
              variant="outlined"
              label={`Org label: ${draft.orgName || DEFAULT_SITE_BRANDING.orgName}`}
            />
          </Box>

          {!canEdit && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              <strong>403 — Admin Access Required:</strong> Only users with the <code>admin</code> GlobalRole (or{' '}
              <code>GlobalVariable</code> write permission) can modify Site Settings.
            </Alert>
          )}

          {saveMessage && (
            <Alert severity={saveMessage.kind} sx={{ mb: 2 }}>
              {saveMessage.text}
            </Alert>
          )}

          <Box component="form" onSubmit={handleSave}>
            <Stack spacing={2.25}>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                <TextField
                  label="Application Name"
                  helperText="Displayed in the top-left navbar, login header, and browser tab"
                  value={draft.appName}
                  onChange={(e) => setDraft((prev) => ({ ...prev, appName: e.target.value }))}
                  disabled={!canEdit}
                  fullWidth
                  size="small"
                />
                <TextField
                  label="Organization / Workspace Subtitle"
                  helperText="Displayed under the active user badge at the bottom-left sidebar"
                  value={draft.orgName}
                  onChange={(e) => setDraft((prev) => ({ ...prev, orgName: e.target.value }))}
                  disabled={!canEdit}
                  fullWidth
                  size="small"
                />
              </Stack>

              <TextField
                label="Site Description / Subtitle"
                helperText="Shown on the Login screen beneath the logo and in the browser title"
                value={draft.appSubtitle}
                onChange={(e) => setDraft((prev) => ({ ...prev, appSubtitle: e.target.value }))}
                disabled={!canEdit}
                fullWidth
                size="small"
              />

              <Divider />

              <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems="flex-start">
                <TextField
                  label="Logo Monogram (1–2 chars fallback)"
                  helperText="Used inside the gradient icon when no custom logo image is set"
                  value={draft.logoText}
                  onChange={(e) => setDraft((prev) => ({ ...prev, logoText: e.target.value.slice(0, 2) }))}
                  disabled={!canEdit}
                  sx={{ width: { xs: '100%', md: 240 } }}
                  size="small"
                />
                <TextField
                  label="Custom Logo Image URL or Data URI"
                  helperText="Paste an HTTPS image URL, or upload a PNG/SVG/JPG file using the button on the right"
                  value={draft.logoUrl}
                  onChange={(e) => setDraft((prev) => ({ ...prev, logoUrl: e.target.value }))}
                  disabled={!canEdit}
                  fullWidth
                  size="small"
                />
                <Stack direction="row" spacing={1} sx={{ pt: { md: 0.25 }, flexShrink: 0 }}>
                  <Button variant="outlined" component="label" size="medium" disabled={!canEdit}>
                    Upload Logo
                    <input
                      type="file"
                      hidden
                      disabled={!canEdit}
                      accept="image/png,image/jpeg,image/svg+xml,image/webp"
                      onChange={handleFileUpload}
                    />
                  </Button>
                  {draft.logoUrl && (
                    <Button
                      variant="text"
                      color="secondary"
                      disabled={!canEdit}
                      onClick={() => setDraft((prev) => ({ ...prev, logoUrl: '' }))}
                    >
                      Clear Logo
                    </Button>
                  )}
                </Stack>
              </Stack>

              <Stack direction="row" spacing={1.5} justifyContent="flex-end" sx={{ pt: 1 }}>
                <Button variant="outlined" color="inherit" disabled={!canEdit || saving} onClick={handleReset}>
                  Reset to Default
                </Button>
                <Button type="submit" variant="contained" color="primary" disabled={!canEdit || saving}>
                  {saving ? 'Saving...' : 'Save Site Settings'}
                </Button>
              </Stack>
            </Stack>
          </Box>
        </CardContent>
      </Card>

      <SsoSettingsCard />
    </Stack>
  );
}
