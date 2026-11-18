import {
  Alert,
  Box,
  Button,
  Card,
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
import type {
  GlobalRoleBindingResource,
  GlobalRoleResource,
  Permission,
  ProjectResource,
  RoleBindingResource,
  RoleResource,
  UserResource,
} from '@perses-dev/client';
import DeleteOutline from 'mdi-material-ui/DeleteOutline';
import PencilOutline from 'mdi-material-ui/PencilOutline';
import Plus from 'mdi-material-ui/Plus';
import ShieldAccount from 'mdi-material-ui/ShieldAccount';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useMemo, useState } from 'react';

import {
  ForbiddenError,
  assignUserGlobalRoles,
  assignUserProjectRoles,
  createPersesUser,
  createProjectRole,
  deletePersesUser,
  fetchPersesGlobalRoleBindings,
  fetchPersesGlobalRoles,
  fetchPersesUsers,
  fetchProjectRoleBindings,
  fetchProjectRoles,
  fetchProjects,
  getCurrentPersesUsername,
  updatePersesUser,
} from '@/api/persesClient';

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
  const [deleteTarget, setDeleteTarget] = useState<UserResource | null>(null);
  const [deleting, setDeleting] = useState(false);

  const { data: users = [], isLoading, error } = useQuery<UserResource[], Error>({
    queryKey: ['perses', 'users'],
    queryFn: fetchPersesUsers,
  });

  const { data: globalRoles = [] } = useQuery<GlobalRoleResource[], Error>({
    queryKey: ['perses', 'globalroles'],
    queryFn: fetchPersesGlobalRoles,
  });

  const { data: globalBindings = [] } = useQuery<GlobalRoleBindingResource[], Error>({
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

  const openEditUser = (user: UserResource) => {
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
      const defaults: Array<{ name: string; permissions: Permission[] }> = [
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
        const nextSpec: UserResource['spec'] = {
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
            borderBottom: `1px solid ${muiTheme.palette.surface.borderSubtle}`,
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

