import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import type { DashboardResource, ProjectResource } from '@perses-dev/client';
import { ErrorAlert, ErrorBoundary, getResourceDisplayName } from '@perses-dev/components';
import { ViewDashboard } from '@perses-dev/dashboards';
import { PluginRegistry, ValidationProvider, remotePluginLoader } from '@perses-dev/plugin-system';
import DeleteOutline from 'mdi-material-ui/DeleteOutline';
import FolderPlusOutline from 'mdi-material-ui/FolderPlusOutline';
import Plus from 'mdi-material-ui/Plus';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  ForbiddenError,
  createDashboard,
  createProject,
  datasourceTargetKey,
  deleteDashboard,
  deleteProject,
  fetchDashboard,
  fetchDashboards,
  fetchProjects,
  updateDashboard,
  useDatasourceTargets,
  usePersesDatasourceApi,
} from '../api/persesClient';
import { PALETTE_TOKENS } from '../theme/persesTheme';

export function DashboardsView() {
  const muiTheme = useTheme();
  const tokens = PALETTE_TOKENS[muiTheme.palette.mode];
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const pluginLoader = useMemo(() => remotePluginLoader({ baseURL: '', apiPrefix: '' }), []);
  const [selectedProject, setSelectedProject] = useState<string>('');
  const [selectedDashboardName, setSelectedDashboardName] = useState<string>('');
  const [startInEditMode, setStartInEditMode] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  // Project create/delete dialogs
  const [createProjOpen, setCreateProjOpen] = useState(false);
  const [projName, setProjName] = useState('');
  const [projDisplayName, setProjDisplayName] = useState('');
  const [projError, setProjError] = useState<string | null>(null);
  const [projSaving, setProjSaving] = useState(false);
  const [deleteProjOpen, setDeleteProjOpen] = useState(false);

  // Dashboard create/delete dialogs
  const [createDashOpen, setCreateDashOpen] = useState(false);
  const [createMode, setCreateMode] = useState<'blank' | 'clone' | 'import'>('blank');
  const [dashName, setDashName] = useState('');
  const [dashDisplayName, setDashDisplayName] = useState('');
  const [cloneSourceProject, setCloneSourceProject] = useState('');
  const [cloneSourceDashboard, setCloneSourceDashboard] = useState('');
  const [importJsonText, setImportJsonText] = useState('');
  const [dashError, setDashError] = useState<string | null>(null);
  const [dashSaving, setDashSaving] = useState(false);
  const [deleteDashOpen, setDeleteDashOpen] = useState(false);

  const {
    data: projects,
    isLoading: loadingProjects,
    error: projectsError,
  } = useQuery<ProjectResource[], Error>({
    queryKey: ['perses', 'projects'],
    queryFn: fetchProjects,
  });

  const { targets: availableDatasources } = useDatasourceTargets();

  useEffect(() => {
    if (!projects || projects.length === 0) {
      setSelectedProject('');
      return;
    }
    if (!selectedProject || !projects.some((p) => p.metadata.name === selectedProject)) {
      setSelectedProject(projects[0].metadata.name);
    }
  }, [projects, selectedProject]);

  const {
    data: dashboards,
    isInitialLoading: loadingDashboards,
    error: dashboardsError,
  } = useQuery<DashboardResource[], Error>({
    queryKey: ['perses', 'dashboards', selectedProject],
    queryFn: () => fetchDashboards(selectedProject),
    enabled: Boolean(selectedProject),
  });

  const { data: cloneProjectDashboards = [] } = useQuery<DashboardResource[], Error>({
    queryKey: ['perses', 'dashboards', cloneSourceProject],
    queryFn: () => fetchDashboards(cloneSourceProject),
    enabled: createDashOpen && createMode === 'clone' && Boolean(cloneSourceProject),
  });

  useEffect(() => {
    if (!dashboards || dashboards.length === 0) {
      setSelectedDashboardName('');
      return;
    }
    if (!selectedDashboardName || !dashboards.some((d) => d.metadata.name === selectedDashboardName)) {
      setSelectedDashboardName(dashboards[0].metadata.name);
    }
  }, [dashboards, selectedDashboardName]);

  const {
    data: activeDashboard,
    isInitialLoading: loadingActiveDashboard,
    error: activeDashboardError,
  } = useQuery<DashboardResource, Error>({
    queryKey: ['perses', 'dashboard', selectedProject, selectedDashboardName],
    queryFn: () => fetchDashboard(selectedProject, selectedDashboardName),
    enabled: Boolean(selectedProject && selectedDashboardName),
  });

  const datasourceApi = usePersesDatasourceApi(selectedProject || undefined);

  const scopedDatasourceChips = useMemo(() => {
    return availableDatasources
      .filter((t) => t.scope === 'global' || t.project === selectedProject)
      .slice(0, 4);
  }, [availableDatasources, selectedProject]);

  const handleSaveDashboard = async (updated: DashboardResource) => {
    setFeedback(null);
    const payload: DashboardResource = {
      ...updated,
      metadata: {
        ...updated.metadata,
        project: selectedProject,
      },
    };
    try {
      const saved = await updateDashboard(selectedProject, payload);
      queryClient.setQueryData(
        ['perses', 'dashboard', selectedProject, saved.metadata.name],
        saved,
      );
      await queryClient.invalidateQueries({ queryKey: ['perses', 'dashboards', selectedProject] });
      setStartInEditMode(false);
      setFeedback({
        kind: 'success',
        text: `Dashboard "${getResourceDisplayName(saved)}" saved to Perses.`,
      });
      return saved;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setFeedback({ kind: 'error', text: msg });
      throw err;
    }
  };

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    const slug = projName.trim();
    if (!slug) {
      setProjError('Project ID is required.');
      return;
    }
    if (!/^[a-zA-Z0-9._-]+$/.test(slug)) {
      setProjError('Project ID can only contain letters, numbers, ".", "_", and "-".');
      return;
    }
    setProjSaving(true);
    setProjError(null);
    setFeedback(null);
    try {
      const created = await createProject({
        kind: 'Project',
        metadata: { name: slug },
        spec: {
          display: {
            name: projDisplayName.trim() || slug,
          },
        },
      });
      await queryClient.invalidateQueries({ queryKey: ['perses', 'projects'] });
      setSelectedProject(created.metadata.name);
      setSelectedDashboardName('');
      setCreateProjOpen(false);
      setProjName('');
      setProjDisplayName('');
      setFeedback({ kind: 'success', text: `Created project "${created.metadata.name}".` });
    } catch (err) {
      setProjError(err instanceof Error ? err.message : String(err));
    } finally {
      setProjSaving(false);
    }
  };

  const handleDeleteProject = async () => {
    if (!selectedProject) return;
    setProjSaving(true);
    setFeedback(null);
    try {
      const deleted = selectedProject;
      await deleteProject(deleted);
      await queryClient.invalidateQueries({ queryKey: ['perses', 'projects'] });
      setDeleteProjOpen(false);
      setSelectedProject('');
      setSelectedDashboardName('');
      setFeedback({ kind: 'success', text: `Deleted project "${deleted}".` });
    } catch (err) {
      setFeedback({ kind: 'error', text: err instanceof Error ? err.message : String(err) });
      setDeleteProjOpen(false);
    } finally {
      setProjSaving(false);
    }
  };

  const openCreateDashboardModal = () => {
    setDashError(null);
    setCreateMode('blank');
    setDashName('');
    setDashDisplayName('');
    setCloneSourceProject(selectedProject);
    setCloneSourceDashboard(selectedDashboardName);
    setImportJsonText('');
    setCreateDashOpen(true);
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setImportJsonText(reader.result);
      }
    };
    reader.readAsText(file);
  };

  const handleCreateDashboard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProject) return;
    setDashError(null);
    setFeedback(null);

    let payload: DashboardResource;

    if (createMode === 'blank') {
      const slug = dashName.trim();
      if (!slug) {
        setDashError('Dashboard ID is required.');
        return;
      }
      if (!/^[a-zA-Z0-9._-]+$/.test(slug)) {
        setDashError('Dashboard ID can only contain letters, numbers, ".", "_", and "-".');
        return;
      }
      payload = {
        kind: 'Dashboard',
        metadata: { name: slug, project: selectedProject },
        spec: {
          display: { name: dashDisplayName.trim() || slug },
          duration: '1h',
          refreshInterval: '0s',
          variables: [],
          panels: {},
          layouts: [],
        },
      };
    } else if (createMode === 'clone') {
      const slug = dashName.trim();
      if (!slug) {
        setDashError('New dashboard ID is required.');
        return;
      }
      if (!/^[a-zA-Z0-9._-]+$/.test(slug)) {
        setDashError('Dashboard ID can only contain letters, numbers, ".", "_", and "-".');
        return;
      }
      if (!cloneSourceProject || !cloneSourceDashboard) {
        setDashError('Select a source project and dashboard to clone.');
        return;
      }
      setDashSaving(true);
      try {
        const source = await fetchDashboard(cloneSourceProject, cloneSourceDashboard);
        payload = {
          kind: 'Dashboard',
          metadata: { name: slug, project: selectedProject },
          spec: {
            ...JSON.parse(JSON.stringify(source.spec)),
            display: {
              ...source.spec.display,
              name: dashDisplayName.trim() || `${getResourceDisplayName(source)} (Copy)`,
            },
          },
        };
      } catch (err) {
        setDashSaving(false);
        setDashError(err instanceof Error ? err.message : String(err));
        return;
      }
    } else {
      // Import Perses JSON
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(importJsonText) as Record<string, unknown>;
      } catch {
        setDashError('Invalid JSON payload. Paste a valid Perses Dashboard JSON object.');
        return;
      }
      const rawSpec = (parsed.spec && typeof parsed.spec === 'object' ? parsed.spec : parsed) as DashboardResource['spec'];
      const rawMeta = (parsed.metadata && typeof parsed.metadata === 'object'
        ? parsed.metadata
        : {}) as Partial<DashboardResource['metadata']>;
      const slug = dashName.trim() || String(rawMeta.name ?? '').trim();
      if (!slug) {
        setDashError('Dashboard ID is required (enter an ID above or include metadata.name in JSON).');
        return;
      }
      if (!/^[a-zA-Z0-9._-]+$/.test(slug)) {
        setDashError('Dashboard ID can only contain letters, numbers, ".", "_", and "-".');
        return;
      }
      if (!rawSpec || typeof rawSpec !== 'object' || !rawSpec.panels || !rawSpec.layouts) {
        setDashError('JSON must contain a Perses dashboard spec with "panels" and "layouts".');
        return;
      }
      payload = {
        kind: 'Dashboard',
        metadata: { name: slug, project: selectedProject },
        spec: {
          ...rawSpec,
          duration: rawSpec.duration || '1h',
          variables: Array.isArray(rawSpec.variables) ? rawSpec.variables : [],
          display: dashDisplayName.trim()
            ? { ...rawSpec.display, name: dashDisplayName.trim() }
            : rawSpec.display ?? { name: slug },
        },
      };
    }

    setDashSaving(true);
    try {
      const created = await createDashboard(selectedProject, payload);
      await queryClient.invalidateQueries({ queryKey: ['perses', 'dashboards', selectedProject] });
      setSelectedDashboardName(created.metadata.name);
      setStartInEditMode(createMode === 'blank');
      setCreateDashOpen(false);
      setFeedback({
        kind: 'success',
        text: `Created dashboard "${getResourceDisplayName(created)}" in project "${selectedProject}".`,
      });
    } catch (err) {
      setDashError(err instanceof Error ? err.message : String(err));
    } finally {
      setDashSaving(false);
    }
  };

  const handleDeleteDashboard = async () => {
    if (!selectedProject || !selectedDashboardName) return;
    setDashSaving(true);
    setFeedback(null);
    try {
      const deleted = selectedDashboardName;
      await deleteDashboard(selectedProject, deleted);
      await queryClient.invalidateQueries({ queryKey: ['perses', 'dashboards', selectedProject] });
      setSelectedDashboardName('');
      setDeleteDashOpen(false);
      setFeedback({ kind: 'success', text: `Deleted dashboard "${deleted}".` });
    } catch (err) {
      setFeedback({ kind: 'error', text: err instanceof Error ? err.message : String(err) });
      setDeleteDashOpen(false);
    } finally {
      setDashSaving(false);
    }
  };

  if (loadingProjects) {
    return (
      <Stack alignItems="center" justifyContent="center" sx={{ py: 8 }}>
        <CircularProgress />
      </Stack>
    );
  }

  if (projectsError) {
    return (
      <Alert severity={projectsError instanceof ForbiddenError ? 'warning' : 'error'}>
        {projectsError instanceof ForbiddenError
          ? projectsError.message
          : `Failed to load Perses projects: ${projectsError.message}`}
      </Alert>
    );
  }

  return (
    <Stack spacing={1.75} sx={{ height: '100%' }}>
      {feedback && (
        <Alert severity={feedback.kind} onClose={() => setFeedback(null)}>
          {feedback.text}
        </Alert>
      )}

      {/* Project & Dashboard Selector + Management Toolbar */}
      <Box
        sx={{
          px: 2,
          py: 1.5,
          borderRadius: 2,
          bgcolor: tokens.bgSurface,
          border: `1px solid ${tokens.borderSubtle}`,
          display: 'flex',
          flexDirection: { xs: 'column', lg: 'row' },
          gap: 1.5,
          alignItems: { xs: 'stretch', lg: 'center' },
          justifyContent: 'space-between',
        }}
      >
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <Typography variant="body2" color="text.secondary" fontWeight={600}>
            Dashboards
          </Typography>
          <Typography variant="body2" color="text.secondary">
            /
          </Typography>
          <FormControl size="small" sx={{ minWidth: 180 }} disabled={!projects || projects.length === 0}>
            <InputLabel id="project-select-label">Project</InputLabel>
            <Select
              labelId="project-select-label"
              label="Project"
              value={selectedProject}
              onChange={(e) => {
                setSelectedProject(e.target.value);
                setSelectedDashboardName('');
                setStartInEditMode(false);
              }}
            >
              {(projects ?? []).map((p) => (
                <MenuItem key={p.metadata.name} value={p.metadata.name}>
                  {getResourceDisplayName(p)}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <Tooltip title="New project">
            <IconButton
              size="small"
              color="primary"
              onClick={() => {
                setProjError(null);
                setCreateProjOpen(true);
              }}
              sx={{ border: `1px solid ${tokens.borderSubtle}`, borderRadius: 1 }}
            >
              <FolderPlusOutline fontSize="small" />
            </IconButton>
          </Tooltip>

          {selectedProject && (
            <Tooltip title={`Delete project "${selectedProject}"`}>
              <IconButton
                size="small"
                color="error"
                onClick={() => setDeleteProjOpen(true)}
                sx={{ border: `1px solid ${tokens.borderSubtle}`, borderRadius: 1 }}
              >
                <DeleteOutline fontSize="small" />
              </IconButton>
            </Tooltip>
          )}

          <Typography variant="body2" color="text.secondary">
            /
          </Typography>
          <FormControl size="small" sx={{ minWidth: 230 }} disabled={!dashboards || dashboards.length === 0}>
            <InputLabel id="dashboard-select-label">Dashboard</InputLabel>
            <Select
              labelId="dashboard-select-label"
              label="Dashboard"
              value={selectedDashboardName}
              onChange={(e) => {
                setSelectedDashboardName(e.target.value);
                setStartInEditMode(false);
              }}
            >
              {(dashboards ?? []).map((d) => (
                <MenuItem key={d.metadata.name} value={d.metadata.name}>
                  {getResourceDisplayName(d)}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <Button
            size="small"
            variant="contained"
            startIcon={<Plus />}
            disabled={!selectedProject}
            onClick={openCreateDashboardModal}
          >
            New dashboard
          </Button>

          {selectedDashboardName && (
            <Tooltip title={`Delete dashboard "${selectedDashboardName}"`}>
              <IconButton
                size="small"
                color="error"
                onClick={() => setDeleteDashOpen(true)}
                sx={{ border: `1px solid ${tokens.borderSubtle}`, borderRadius: 1 }}
              >
                <DeleteOutline fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </Stack>

        <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
          {scopedDatasourceChips.length === 0 ? (
            <Chip
              size="small"
              variant="outlined"
              color="warning"
              label="No data sources · Add one"
              onClick={() => navigate('/datasources')}
              sx={{ fontSize: 11.5, cursor: 'pointer' }}
            />
          ) : (
            scopedDatasourceChips.map((ds) => (
              <Chip
                key={datasourceTargetKey(ds)}
                size="small"
                variant="outlined"
                label={`${ds.pluginKind.replace('Datasource', '')} | ${ds.name}`}
                sx={{ fontFamily: 'monospace', fontSize: 11.5 }}
              />
            ))
          )}
        </Stack>
      </Box>

      {(!projects || projects.length === 0) && (
        <Card>
          <CardContent sx={{ py: 6, textAlign: 'center' }}>
            <Stack spacing={1.5} alignItems="center">
              <Typography variant="subtitle1" fontWeight={700}>
                No Perses projects exist yet
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Create a project to organize dashboards, project datasources, and project-scoped RBAC roles.
              </Typography>
              <Button
                variant="contained"
                startIcon={<FolderPlusOutline />}
                onClick={() => {
                  setProjError(null);
                  setCreateProjOpen(true);
                }}
              >
                Create first project
              </Button>
            </Stack>
          </CardContent>
        </Card>
      )}

      {dashboardsError && (
        <Alert severity={dashboardsError instanceof ForbiddenError ? 'warning' : 'error'}>
          {dashboardsError instanceof ForbiddenError
            ? dashboardsError.message
            : `Failed to load dashboards: ${dashboardsError.message}`}
        </Alert>
      )}
      {activeDashboardError && (
        <Alert severity="error">Failed to load dashboard payload: {activeDashboardError.message}</Alert>
      )}

      {(loadingDashboards || loadingActiveDashboard) && selectedProject && (
        <Stack alignItems="center" justifyContent="center" sx={{ py: 8 }}>
          <CircularProgress />
        </Stack>
      )}

      {selectedProject && !loadingDashboards && dashboards && dashboards.length === 0 && (
        <Card>
          <CardContent sx={{ py: 6, textAlign: 'center' }}>
            <Stack spacing={1.5} alignItems="center">
              <Typography variant="subtitle1" fontWeight={700}>
                Project &ldquo;{selectedProject}&rdquo; has no dashboards yet
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Create a blank dashboard, clone an existing one, or import Perses dashboard JSON.
              </Typography>
              <Button variant="contained" startIcon={<Plus />} onClick={openCreateDashboardModal}>
                Create dashboard
              </Button>
            </Stack>
          </CardContent>
        </Card>
      )}

      {activeDashboard && (
        <Box sx={{ flex: 1, minHeight: 0 }}>
          <ErrorBoundary FallbackComponent={ErrorAlert}>
            <PluginRegistry
              pluginLoader={pluginLoader}
              defaultPluginKinds={{
                Panel: 'TimeSeriesChart',
                TimeSeriesQuery: 'PrometheusTimeSeriesQuery',
              }}
            >
              <ValidationProvider>
                <ErrorBoundary FallbackComponent={ErrorAlert}>
                  <ViewDashboard
                    key={`${activeDashboard.metadata.project}/${activeDashboard.metadata.name}`}
                    dashboardResource={activeDashboard}
                    datasourceApi={datasourceApi}
                    isInitialVariableSticky={true}
                    isAnnotationEnabled={true}
                    isReadonly={false}
                    isEditing={startInEditMode}
                    isVariableEnabled={true}
                    isDatasourceEnabled={true}
                    onSave={handleSaveDashboard}
                  />
                </ErrorBoundary>
              </ValidationProvider>
            </PluginRegistry>
          </ErrorBoundary>
        </Box>
      )}

      {/* Create Project Dialog */}
      <Dialog open={createProjOpen} onClose={() => setCreateProjOpen(false)} maxWidth="xs" fullWidth>
        <Box component="form" onSubmit={handleCreateProject}>
          <DialogTitle>Create Project</DialogTitle>
          <DialogContent dividers>
            <Stack spacing={2}>
              {projError && <Alert severity="error">{projError}</Alert>}
              <TextField
                label="Project ID (metadata.name)"
                placeholder="e.g. platform-team"
                value={projName}
                onChange={(e) => setProjName(e.target.value)}
                required
                fullWidth
                size="small"
              />
              <TextField
                label="Display Name (optional)"
                placeholder="e.g. Platform Engineering"
                value={projDisplayName}
                onChange={(e) => setProjDisplayName(e.target.value)}
                fullWidth
                size="small"
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setCreateProjOpen(false)} disabled={projSaving}>
              Cancel
            </Button>
            <Button type="submit" variant="contained" disabled={projSaving}>
              {projSaving ? 'Creating...' : 'Create Project'}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>

      {/* Delete Project Confirmation */}
      <Dialog open={deleteProjOpen} onClose={() => setDeleteProjOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete Project</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2">
            Are you sure you want to delete project <strong>{selectedProject}</strong> and all dashboards inside it?
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteProjOpen(false)} disabled={projSaving}>
            Cancel
          </Button>
          <Button color="error" variant="contained" onClick={handleDeleteProject} disabled={projSaving}>
            {projSaving ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Create Dashboard Dialog (Blank / Clone / Import JSON) */}
      <Dialog open={createDashOpen} onClose={() => setCreateDashOpen(false)} maxWidth="sm" fullWidth>
        <Box component="form" onSubmit={handleCreateDashboard}>
          <DialogTitle>New Dashboard in &ldquo;{selectedProject}&rdquo;</DialogTitle>
          <DialogContent dividers>
            <Stack spacing={2}>
              <Tabs
                value={createMode}
                onChange={(_, v: 'blank' | 'clone' | 'import') => {
                  setCreateMode(v);
                  setDashError(null);
                }}
                sx={{ borderBottom: `1px solid ${tokens.borderSubtle}` }}
              >
                <Tab value="blank" label="Blank" />
                <Tab value="clone" label="Clone Existing" />
                <Tab value="import" label="Import JSON" />
              </Tabs>

              {dashError && <Alert severity="error">{dashError}</Alert>}

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  label="Dashboard ID (metadata.name)"
                  placeholder="e.g. service-latency"
                  value={dashName}
                  onChange={(e) => setDashName(e.target.value)}
                  required={createMode !== 'import'}
                  fullWidth
                  size="small"
                  helperText={createMode === 'import' ? 'Optional if metadata.name is inside JSON' : undefined}
                />
                <TextField
                  label="Display Name"
                  placeholder="e.g. Service Latency & Errors"
                  value={dashDisplayName}
                  onChange={(e) => setDashDisplayName(e.target.value)}
                  fullWidth
                  size="small"
                />
              </Stack>

              {createMode === 'clone' && (
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                  <FormControl size="small" fullWidth>
                    <InputLabel>Source Project</InputLabel>
                    <Select
                      label="Source Project"
                      value={cloneSourceProject}
                      onChange={(e) => {
                        setCloneSourceProject(e.target.value);
                        setCloneSourceDashboard('');
                      }}
                    >
                      {(projects ?? []).map((p) => (
                        <MenuItem key={p.metadata.name} value={p.metadata.name}>
                          {getResourceDisplayName(p)}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>

                  <FormControl size="small" fullWidth>
                    <InputLabel>Source Dashboard</InputLabel>
                    <Select
                      label="Source Dashboard"
                      value={cloneSourceDashboard}
                      onChange={(e) => setCloneSourceDashboard(e.target.value)}
                    >
                      {cloneProjectDashboards.map((d) => (
                        <MenuItem key={d.metadata.name} value={d.metadata.name}>
                          {getResourceDisplayName(d)}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Stack>
              )}

              {createMode === 'import' && (
                <Stack spacing={1.25}>
                  <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Typography variant="caption" color="text.secondary">
                      Paste a Perses Dashboard JSON document or upload a <code>.json</code> file.
                    </Typography>
                    <Button size="small" variant="outlined" component="label">
                      Upload .json
                      <input type="file" hidden accept="application/json,.json" onChange={handleImportFile} />
                    </Button>
                  </Stack>
                  <TextField
                    multiline
                    minRows={6}
                    maxRows={12}
                    placeholder='{"kind": "Dashboard", "metadata": {"name": "my-dash"}, "spec": { ... }}'
                    value={importJsonText}
                    onChange={(e) => setImportJsonText(e.target.value)}
                    fullWidth
                    InputProps={{ sx: { fontFamily: 'monospace', fontSize: 12 } }}
                  />
                </Stack>
              )}
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setCreateDashOpen(false)} disabled={dashSaving}>
              Cancel
            </Button>
            <Button type="submit" variant="contained" disabled={dashSaving}>
              {dashSaving ? 'Creating...' : 'Create Dashboard'}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>

      {/* Delete Dashboard Confirmation */}
      <Dialog open={deleteDashOpen} onClose={() => setDeleteDashOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete Dashboard</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2">
            Are you sure you want to delete dashboard <strong>{selectedDashboardName}</strong> from project{' '}
            <strong>{selectedProject}</strong>?
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDashOpen(false)} disabled={dashSaving}>
            Cancel
          </Button>
          <Button color="error" variant="contained" onClick={handleDeleteDashboard} disabled={dashSaving}>
            {dashSaving ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
