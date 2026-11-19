import {
  Alert,
  Box,
  Button,
  Card,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
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
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import type {
  Action,
  GlobalRoleResource,
  Permission,
  ProjectResource,
  RoleResource,
  Scope,
} from '@perses-dev/client';
import { ACTIONS, GLOBAL_SCOPES, PROJECT_SCOPES } from '@perses-dev/client';
import { getResourceDisplayName } from '@perses-dev/components';
import DeleteOutline from 'mdi-material-ui/DeleteOutline';
import PencilOutline from 'mdi-material-ui/PencilOutline';
import Plus from 'mdi-material-ui/Plus';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useEffect, useState } from 'react';

import { ForbiddenError } from '@/lib/api/http';
import { fetchProjects } from '@/lib/api/projects';
import { queryKeys } from '@/lib/api/queryKeys';
import {
  createPersesGlobalRole,
  createProjectRole,
  deletePersesGlobalRole,
  deleteProjectRole,
  fetchPersesGlobalRoles,
  fetchProjectRoles,
  updatePersesGlobalRole,
  updateProjectRole,
} from '@/lib/api/rbac';
import { ViewLoadingState } from '@/components/ui/ViewStates';

const AVAILABLE_ACTIONS = Array.from(new Set(['*', ...ACTIONS])) as Action[];
const AVAILABLE_PROJECT_SCOPES = Array.from(new Set(['*', ...PROJECT_SCOPES])) as Scope[];
const AVAILABLE_GLOBAL_SCOPES = Array.from(new Set(['*', ...GLOBAL_SCOPES])) as Scope[];

function formatIso(ts?: string): string {
  if (!ts) return '-';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

interface RoleFormState {
  mode: 'create' | 'edit';
  scope: 'global' | 'project';
  project: string;
  name: string;
  permissions: Permission[];
}

export function RolesView() {
  const theme = useTheme();
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
  } = useQuery<GlobalRoleResource[], Error>({
    queryKey: queryKeys.globalRoles,
    queryFn: fetchPersesGlobalRoles,
  });

  const { data: projects = [] } = useQuery<ProjectResource[], Error>({
    queryKey: queryKeys.projects,
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
    queryKey: queryKeys.projectRoles(selectedProject),
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

  const openEditRole = (scope: 'global' | 'project', role: GlobalRoleResource | RoleResource) => {
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
        const payload: GlobalRoleResource = {
          kind: 'GlobalRole',
          metadata: { name },
          spec: { permissions: form.permissions },
        };
        if (form.mode === 'create') {
          await createPersesGlobalRole(payload);
        } else {
          await updatePersesGlobalRole(payload);
        }
        await queryClient.invalidateQueries({ queryKey: queryKeys.globalRoles });
      } else {
        const payload: RoleResource = {
          kind: 'Role',
          metadata: { name, project: form.project },
          spec: { permissions: form.permissions },
        };
        if (form.mode === 'create') {
          await createProjectRole(form.project, payload);
        } else {
          await updateProjectRole(form.project, payload);
        }
        await queryClient.invalidateQueries({ queryKey: queryKeys.projectRoles(form.project) });
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
        await queryClient.invalidateQueries({ queryKey: queryKeys.globalRoles });
      } else {
        await deleteProjectRole(deleteTarget.project!, deleteTarget.name);
        await queryClient.invalidateQueries({ queryKey: queryKeys.projectRoles(deleteTarget.project!) });
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
  const availableScopes = form.scope === 'global' ? AVAILABLE_GLOBAL_SCOPES : AVAILABLE_PROJECT_SCOPES;

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
            borderBottom: `1px solid ${theme.palette.surface.borderSubtle}`,
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
          <ViewLoadingState message="Loading roles..." />
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

      <Dialog open={formOpen} onClose={() => setFormOpen(false)} maxWidth="md" fullWidth>
        <Box component="form" onSubmit={handleSaveRole}>
          <DialogTitle>
            {form.mode === 'create' ? 'Create' : 'Edit'}{' '}
            {form.scope === 'global' ? 'GlobalRole' : `Project Role (${form.project})`}
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
                        const val = (
                          typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value
                        ) as Action[];
                        setForm((prev) => ({
                          ...prev,
                          permissions: prev.permissions.map((p, i) => (i === idx ? { ...p, actions: val } : p)),
                        }));
                      }}
                      input={<OutlinedInput label="Actions" />}
                      renderValue={(s) => s.join(', ')}
                    >
                      {AVAILABLE_ACTIONS.map((a) => (
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
                        const val = (
                          typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value
                        ) as Scope[];
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
