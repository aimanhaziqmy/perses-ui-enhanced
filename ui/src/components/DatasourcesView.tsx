import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import type { DatasourceResource, GlobalDatasourceResource, ProjectResource } from '@perses-dev/client';
import { getResourceDisplayName } from '@perses-dev/components';
import AlertCircle from 'mdi-material-ui/AlertCircle';
import CheckCircle from 'mdi-material-ui/CheckCircle';
import DeleteOutline from 'mdi-material-ui/DeleteOutline';
import PencilOutline from 'mdi-material-ui/PencilOutline';
import Plus from 'mdi-material-ui/Plus';
import Refresh from 'mdi-material-ui/Refresh';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';

import type { DatasourceProbeResult } from '../api/persesClient';
import {
  ForbiddenError,
  createGlobalDatasource,
  createProjectDatasource,
  datasourceTargetKey,
  deleteGlobalDatasource,
  deleteProjectDatasource,
  fetchGlobalDatasources,
  fetchProjectDatasources,
  fetchProjects,
  probeDatasource,
  updateGlobalDatasource,
  updateProjectDatasource,
} from '../api/persesClient';
import { PALETTE_TOKENS } from '../theme/persesTheme';
import { PrometheusBrandIcon, VictoriaLogsBrandIcon } from './BrandIcons';
import { JsonViewer } from './JsonViewer';

type UnifiedDatasourceItem =
  | { scope: 'global'; key: string; resource: GlobalDatasourceResource }
  | { scope: 'project'; project: string; key: string; resource: DatasourceResource };

interface DatasourceFormState {
  mode: 'create' | 'edit';
  scope: 'global' | 'project';
  project: string;
  name: string;
  displayName: string;
  description: string;
  pluginKind: string;
  accessMode: 'proxy' | 'direct';
  url: string;
  secretName: string;
  isDefault: boolean;
}

const DEFAULT_FORM_STATE: DatasourceFormState = {
  mode: 'create',
  scope: 'global',
  project: '',
  name: '',
  displayName: '',
  description: '',
  pluginKind: 'PrometheusDatasource',
  accessMode: 'proxy',
  url: '',
  secretName: '',
  isDefault: true,
};

function extractPluginInfo(ds: GlobalDatasourceResource | DatasourceResource): {
  accessMode: 'proxy' | 'direct';
  url: string;
  secretName: string;
} {
  const spec = ds.spec.plugin.spec as {
    directUrl?: string;
    proxy?: { spec?: { url?: string; secret?: string } };
  };
  if (spec?.directUrl) {
    return { accessMode: 'direct', url: spec.directUrl, secretName: '' };
  }
  return {
    accessMode: 'proxy',
    url: spec?.proxy?.spec?.url ?? '',
    secretName: spec?.proxy?.spec?.secret ?? '',
  };
}

function buildDatasourceSpec(form: DatasourceFormState): GlobalDatasourceResource['spec'] {
  const trimmedUrl = form.url.trim();
  const pluginSpec: Record<string, unknown> =
    form.accessMode === 'direct'
      ? { directUrl: trimmedUrl }
      : {
          proxy: {
            kind: 'HTTPProxy',
            spec: {
              url: trimmedUrl,
              ...(form.secretName.trim() ? { secret: form.secretName.trim() } : {}),
            },
          },
        };

  return {
    default: form.isDefault,
    display: {
      name: form.displayName.trim() || form.name.trim(),
      ...(form.description.trim() ? { description: form.description.trim() } : {}),
    },
    plugin: {
      kind: form.pluginKind,
      spec: pluginSpec,
    },
  };
}

export function DatasourcesView() {
  const muiTheme = useTheme();
  const mode = muiTheme.palette.mode;
  const tokens = PALETTE_TOKENS[mode];
  const queryClient = useQueryClient();

  const {
    data: projects = [],
    error: projectsError,
  } = useQuery<ProjectResource[], Error>({
    queryKey: ['perses', 'projects'],
    queryFn: fetchProjects,
  });

  const {
    data: globalDatasources = [],
    isLoading: loadingGlobals,
    error: globalsError,
    refetch: refetchGlobals,
  } = useQuery<GlobalDatasourceResource[], Error>({
    queryKey: ['perses', 'globaldatasources'],
    queryFn: fetchGlobalDatasources,
  });

  const {
    data: projectDatasourcesList = [],
    isInitialLoading: loadingProjectDs,
    refetch: refetchProjectDs,
  } = useQuery<Array<{ project: string; items: DatasourceResource[] }>, Error>({
    queryKey: ['perses', 'all-project-datasources', projects.map((p) => p.metadata.name).join(',')],
    queryFn: async () => {
      return Promise.all(
        projects.map(async (p) => {
          try {
            const items = await fetchProjectDatasources(p.metadata.name);
            return { project: p.metadata.name, items };
          } catch {
            return { project: p.metadata.name, items: [] };
          }
        }),
      );
    },
    enabled: projects.length > 0,
  });

  const allItems = useMemo<UnifiedDatasourceItem[]>(() => {
    const list: UnifiedDatasourceItem[] = [];
    for (const ds of globalDatasources) {
      list.push({
        scope: 'global',
        key: datasourceTargetKey({ scope: 'global', name: ds.metadata.name }),
        resource: ds,
      });
    }
    for (const group of projectDatasourcesList) {
      for (const ds of group.items) {
        list.push({
          scope: 'project',
          project: group.project,
          key: datasourceTargetKey({ scope: 'project', project: group.project, name: ds.metadata.name }),
          resource: ds,
        });
      }
    }
    return list;
  }, [globalDatasources, projectDatasourcesList]);

  const [scopeFilter, setScopeFilter] = useState<string>('ALL');
  const [searchText, setSearchText] = useState<string>('');
  const [probing, setProbing] = useState(false);
  const [probes, setProbes] = useState<Record<string, DatasourceProbeResult>>({});
  const [inspectedProbe, setInspectedProbe] = useState<DatasourceProbeResult | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<DatasourceFormState>(DEFAULT_FORM_STATE);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UnifiedDatasourceItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);

  const runProbes = useCallback(async (items: UnifiedDatasourceItem[]) => {
    setProbing(true);
    try {
      const results = await Promise.all(items.map((item) => probeDatasource(item.resource)));
      const map: Record<string, DatasourceProbeResult> = {};
      for (const r of results) {
        map[r.key] = r;
      }
      setProbes(map);
    } finally {
      setProbing(false);
    }
  }, []);

  useEffect(() => {
    if (allItems.length > 0) {
      void runProbes(allItems);
    } else {
      setProbes({});
    }
  }, [allItems, runProbes]);

  const invalidateDatasources = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['perses', 'globaldatasources'] }),
      queryClient.invalidateQueries({ queryKey: ['perses', 'all-project-datasources'] }),
      queryClient.invalidateQueries({ queryKey: ['perses', 'datasources'] }),
      queryClient.invalidateQueries({ queryKey: ['perses', 'all-datasource-targets'] }),
    ]);
  };

  const openCreateModal = () => {
    setFormError(null);
    setForm({
      ...DEFAULT_FORM_STATE,
      project: projects[0]?.metadata.name ?? '',
    });
    setFormOpen(true);
  };

  const openEditModal = (item: UnifiedDatasourceItem) => {
    const ds = item.resource;
    const { accessMode, url, secretName } = extractPluginInfo(ds);
    setFormError(null);
    setForm({
      mode: 'edit',
      scope: item.scope,
      project: item.scope === 'project' ? item.project : projects[0]?.metadata.name ?? '',
      name: ds.metadata.name,
      displayName: ds.spec.display?.name ?? '',
      description: ds.spec.display?.description ?? '',
      pluginKind: ds.spec.plugin.kind,
      accessMode,
      url,
      secretName,
      isDefault: Boolean(ds.spec.default),
    });
    setFormOpen(true);
  };

  const handleSaveDatasource = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = form.name.trim();
    if (!trimmedName) {
      setFormError('Datasource name is required.');
      return;
    }
    if (!/^[a-zA-Z0-9._-]+$/.test(trimmedName)) {
      setFormError('Datasource name can only contain letters, numbers, ".", "_", and "-".');
      return;
    }
    if (!form.url.trim()) {
      setFormError('Endpoint URL is required (e.g. http://victoria-metrics:8428).');
      return;
    }
    if (form.scope === 'project' && !form.project) {
      setFormError('Select a target project for a project-scoped datasource.');
      return;
    }

    setSubmitting(true);
    setFormError(null);
    setActionFeedback(null);

    try {
      const spec = buildDatasourceSpec(form);
      if (form.scope === 'global') {
        const resource: GlobalDatasourceResource = {
          kind: 'GlobalDatasource',
          metadata: { name: trimmedName },
          spec,
        };
        if (form.mode === 'create') {
          await createGlobalDatasource(resource);
        } else {
          await updateGlobalDatasource(resource);
        }
      } else {
        const resource: DatasourceResource = {
          kind: 'Datasource',
          metadata: { name: trimmedName, project: form.project },
          spec,
        };
        if (form.mode === 'create') {
          await createProjectDatasource(form.project, resource);
        } else {
          await updateProjectDatasource(form.project, resource);
        }
      }

      await invalidateDatasources();
      setFormOpen(false);
      setActionFeedback({
        kind: 'success',
        text: `${form.mode === 'create' ? 'Created' : 'Updated'} ${
          form.scope === 'global' ? 'GlobalDatasource' : `Project Datasource (${form.project})`
        } "${trimmedName}".`,
      });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setActionFeedback(null);
    try {
      const name = deleteTarget.resource.metadata.name;
      if (deleteTarget.scope === 'global') {
        await deleteGlobalDatasource(name);
      } else {
        await deleteProjectDatasource(deleteTarget.project, name);
      }
      await invalidateDatasources();
      setActionFeedback({ kind: 'success', text: `Deleted datasource "${name}".` });
      setDeleteTarget(null);
    } catch (err) {
      setActionFeedback({
        kind: 'error',
        text: err instanceof Error ? err.message : String(err),
      });
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  const filtered = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return allItems.filter((item) => {
      if (scopeFilter === 'global' && item.scope !== 'global') return false;
      if (scopeFilter.startsWith('project:')) {
        const proj = scopeFilter.slice('project:'.length);
        if (item.scope !== 'project' || item.project !== proj) return false;
      }
      if (!q) return true;
      const ds = item.resource;
      const scopeLabel = item.scope === 'global' ? 'global' : `project ${item.project}`;
      return `${ds.metadata.name} ${getResourceDisplayName(ds)} ${ds.spec.plugin.kind} ${scopeLabel}`
        .toLowerCase()
        .includes(q);
    });
  }, [allItems, scopeFilter, searchText]);

  const paged = useMemo(() => {
    const start = page * rowsPerPage;
    return filtered.slice(start, start + rowsPerPage);
  }, [filtered, page, rowsPerPage]);

  if (loadingGlobals || loadingProjectDs) {
    return (
      <Stack alignItems="center" justifyContent="center" sx={{ py: 8 }}>
        <CircularProgress />
      </Stack>
    );
  }

  return (
    <Stack spacing={1.5}>
      {globalsError && (
        <Alert severity={globalsError instanceof ForbiddenError ? 'warning' : 'error'}>
          {globalsError instanceof ForbiddenError
            ? globalsError.message
            : `Failed to fetch GlobalDatasources: ${globalsError.message}`}
        </Alert>
      )}
      {projectsError && (
        <Alert severity={projectsError instanceof ForbiddenError ? 'warning' : 'error'}>
          {projectsError instanceof ForbiddenError
            ? projectsError.message
            : `Failed to fetch Projects: ${projectsError.message}`}
        </Alert>
      )}
      {actionFeedback && (
        <Alert severity={actionFeedback.kind} onClose={() => setActionFeedback(null)}>
          {actionFeedback.text}
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
          <Stack direction="row" spacing={1.25} alignItems="center" flexWrap="wrap" useFlexGap>
            <TextField
              size="small"
              placeholder="Search name, plugin, or scope..."
              value={searchText}
              onChange={(e) => {
                setSearchText(e.target.value);
                setPage(0);
              }}
              sx={{ width: { xs: '100%', sm: 270 }, '& .MuiInputBase-input': { fontSize: 13, py: 0.75 } }}
            />

            <FormControl size="small" sx={{ minWidth: 180 }}>
              <Select
                value={scopeFilter}
                onChange={(e) => {
                  setScopeFilter(e.target.value);
                  setPage(0);
                }}
              >
                <MenuItem value="ALL">All scopes ({allItems.length})</MenuItem>
                <MenuItem value="global">Global ({globalDatasources.length})</MenuItem>
                {projects.map((p) => (
                  <MenuItem key={p.metadata.name} value={`project:${p.metadata.name}`}>
                    Project: {getResourceDisplayName(p)}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>

          <Stack direction="row" spacing={1} alignItems="center">
            <Button
              size="small"
              variant="outlined"
              startIcon={<Refresh />}
              disabled={probing || allItems.length === 0}
              onClick={async () => {
                await Promise.all([refetchGlobals(), refetchProjectDs()]);
                await runProbes(allItems);
              }}
            >
              {probing ? 'Probing...' : 'Test connectivity'}
            </Button>

            <Button size="small" variant="contained" startIcon={<Plus />} onClick={openCreateModal}>
              Add data source
            </Button>
          </Stack>
        </Box>

        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell width={170}>Type</TableCell>
                <TableCell>Data source name</TableCell>
                <TableCell width={160}>Scope</TableCell>
                <TableCell>Endpoint / Proxy URL</TableCell>
                <TableCell width={150}>Live probe</TableCell>
                <TableCell align="right" width={170}>
                  Operations
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {paged.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} align="center" sx={{ py: 6 }}>
                    <Stack spacing={1.5} alignItems="center">
                      <Typography variant="body2" color="text.secondary">
                        No data sources configured yet. Add a Prometheus, VictoriaMetrics, or VictoriaLogs data source
                        directly from the UI.
                      </Typography>
                      <Button size="small" variant="contained" startIcon={<Plus />} onClick={openCreateModal}>
                        Add first data source
                      </Button>
                    </Stack>
                  </TableCell>
                </TableRow>
              ) : (
                paged.map((item) => {
                  const ds = item.resource;
                  const probe = probes[item.key];
                  const isProm = ds.spec.plugin.kind === 'PrometheusDatasource';
                  const typeLabel = isProm ? 'Prometheus' : ds.spec.plugin.kind.replace('Datasource', '');
                  const { url } = extractPluginInfo(ds);

                  return (
                    <TableRow key={item.key} hover>
                      <TableCell>
                        <Stack direction="row" spacing={1} alignItems="center">
                          {isProm ? <PrometheusBrandIcon size={18} /> : <VictoriaLogsBrandIcon size={18} />}
                          <Typography variant="body2" fontWeight={500}>
                            {typeLabel}
                          </Typography>
                        </Stack>
                      </TableCell>

                      <TableCell>
                        <Stack direction="row" spacing={0.75} alignItems="center">
                          <Typography
                            variant="body2"
                            fontWeight={600}
                            color="primary.main"
                            sx={{ cursor: probe ? 'pointer' : 'default', '&:hover': probe ? { textDecoration: 'underline' } : undefined }}
                            onClick={() => probe && setInspectedProbe(probe)}
                          >
                            {ds.metadata.name}
                          </Typography>
                          {ds.spec.default && (
                            <Tooltip title="Default datasource for this plugin kind">
                              <CheckCircle sx={{ fontSize: 15, color: 'primary.main' }} />
                            </Tooltip>
                          )}
                        </Stack>
                        <Typography variant="caption" color="text.secondary">
                          {getResourceDisplayName(ds)}
                        </Typography>
                      </TableCell>

                      <TableCell>
                        <Chip
                          size="small"
                          variant="outlined"
                          color={item.scope === 'global' ? 'primary' : 'default'}
                          label={item.scope === 'global' ? 'Global' : `Project: ${item.project}`}
                          sx={{ height: 22, fontSize: 11 }}
                        />
                      </TableCell>

                      <TableCell sx={{ fontFamily: 'monospace', fontSize: 12, color: 'text.secondary' }}>
                        {url || 'Direct / Unspecified'}
                      </TableCell>

                      <TableCell>
                        {probe ? (
                          <Chip
                            size="small"
                            icon={probe.ok ? <CheckCircle fontSize="small" /> : <AlertCircle fontSize="small" />}
                            color={probe.ok ? 'success' : probe.statusCode === 0 ? 'default' : 'error'}
                            variant="outlined"
                            label={
                              probe.ok
                                ? `OK · ${probe.latencyMs} ms`
                                : probe.statusCode === 0
                                  ? 'Custom'
                                  : `HTTP ${probe.statusCode}`
                            }
                            onClick={() => setInspectedProbe(probe)}
                            sx={{ height: 22, fontSize: 11.5, cursor: 'pointer' }}
                          />
                        ) : (
                          <Typography variant="caption" color="text.secondary">
                            Probing...
                          </Typography>
                        )}
                      </TableCell>

                      <TableCell align="right">
                        <Stack direction="row" spacing={0.25} justifyContent="flex-end">
                          <Tooltip title="Inspect proxy probe">
                            <span>
                              <Button
                                size="small"
                                variant="text"
                                disabled={!probe}
                                onClick={() => probe && setInspectedProbe(probe)}
                                sx={{ minWidth: 0, px: 1, fontSize: 12 }}
                              >
                                Inspect
                              </Button>
                            </span>
                          </Tooltip>
                          <Tooltip title="Edit data source">
                            <IconButton size="small" onClick={() => openEditModal(item)}>
                              <PencilOutline fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Delete data source">
                            <IconButton size="small" color="error" onClick={() => setDeleteTarget(item)}>
                              <DeleteOutline fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </Stack>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </TableContainer>

        <TablePagination
          component="div"
          count={filtered.length}
          page={page}
          onPageChange={(_, p) => setPage(p)}
          rowsPerPage={rowsPerPage}
          onRowsPerPageChange={(e) => {
            setRowsPerPage(parseInt(e.target.value, 10));
            setPage(0);
          }}
          rowsPerPageOptions={[10, 20, 50]}
        />
      </Card>

      {/* Create / Edit Datasource Dialog */}
      <Dialog open={formOpen} onClose={() => setFormOpen(false)} maxWidth="sm" fullWidth>
        <Box component="form" onSubmit={handleSaveDatasource}>
          <DialogTitle>{form.mode === 'create' ? 'Add Data Source' : `Edit Data Source: ${form.name}`}</DialogTitle>
          <DialogContent dividers>
            <Stack spacing={2}>
              {formError && <Alert severity="error">{formError}</Alert>}

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <FormControl size="small" fullWidth disabled={form.mode === 'edit'}>
                  <InputLabel id="ds-scope-label">Scope</InputLabel>
                  <Select
                    labelId="ds-scope-label"
                    label="Scope"
                    value={form.scope}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        scope: e.target.value as 'global' | 'project',
                        project: prev.project || projects[0]?.metadata.name || '',
                      }))
                    }
                  >
                    <MenuItem value="global">Global Datasource (All projects)</MenuItem>
                    <MenuItem value="project" disabled={projects.length === 0}>
                      Project Datasource {projects.length === 0 ? '(Create a project first)' : ''}
                    </MenuItem>
                  </Select>
                </FormControl>

                {form.scope === 'project' && (
                  <FormControl size="small" fullWidth disabled={form.mode === 'edit'}>
                    <InputLabel id="ds-project-label">Project</InputLabel>
                    <Select
                      labelId="ds-project-label"
                      label="Project"
                      value={form.project}
                      onChange={(e) => setForm((prev) => ({ ...prev, project: e.target.value }))}
                    >
                      {projects.map((p) => (
                        <MenuItem key={p.metadata.name} value={p.metadata.name}>
                          {getResourceDisplayName(p)} ({p.metadata.name})
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                )}
              </Stack>

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  label="Datasource ID (metadata.name)"
                  placeholder="e.g. prometheus-main"
                  value={form.name}
                  onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                  disabled={form.mode === 'edit'}
                  required
                  fullWidth
                  size="small"
                  helperText="Unique identifier used in queries and dashboards"
                />

                <TextField
                  label="Display Name"
                  placeholder="e.g. Cluster Metrics"
                  value={form.displayName}
                  onChange={(e) => setForm((prev) => ({ ...prev, displayName: e.target.value }))}
                  fullWidth
                  size="small"
                />
              </Stack>

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <FormControl size="small" fullWidth>
                  <InputLabel id="ds-plugin-label">Plugin Kind</InputLabel>
                  <Select
                    labelId="ds-plugin-label"
                    label="Plugin Kind"
                    value={form.pluginKind}
                    onChange={(e) => setForm((prev) => ({ ...prev, pluginKind: e.target.value }))}
                  >
                    <MenuItem value="PrometheusDatasource">Prometheus / VictoriaMetrics (PrometheusDatasource)</MenuItem>
                    <MenuItem value="VictoriaLogsDatasource">VictoriaLogs (VictoriaLogsDatasource)</MenuItem>
                    <MenuItem value="JaegerDatasource">Jaeger / VictoriaTraces (JaegerDatasource)</MenuItem>
                    <MenuItem value="TempoDatasource">Tempo Traces (TempoDatasource)</MenuItem>
                    {!['PrometheusDatasource', 'VictoriaLogsDatasource', 'JaegerDatasource', 'TempoDatasource'].includes(
                      form.pluginKind,
                    ) && <MenuItem value={form.pluginKind}>{form.pluginKind}</MenuItem>}
                  </Select>
                </FormControl>

                <FormControl size="small" fullWidth>
                  <InputLabel id="ds-access-label">Connection Mode</InputLabel>
                  <Select
                    labelId="ds-access-label"
                    label="Connection Mode"
                    value={form.accessMode}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, accessMode: e.target.value as 'proxy' | 'direct' }))
                    }
                  >
                    <MenuItem value="proxy">Perses Server Proxy (Recommended)</MenuItem>
                    <MenuItem value="direct">Browser Direct URL</MenuItem>
                  </Select>
                </FormControl>
              </Stack>

              <TextField
                label="Endpoint URL"
                placeholder={
                  form.pluginKind === 'VictoriaLogsDatasource'
                    ? 'http://vl-victoria-logs-single-server:9428'
                    : form.pluginKind === 'JaegerDatasource'
                      ? 'http://jaeger-query:16686'
                      : form.pluginKind === 'TempoDatasource'
                        ? 'http://tempo:3200'
                        : 'http://victoria-metrics:8428'
                }
                value={form.url}
                onChange={(e) => setForm((prev) => ({ ...prev, url: e.target.value }))}
                required
                fullWidth
                size="small"
                helperText={
                  form.accessMode === 'proxy'
                    ? 'URL reachable from the Perses backend pod (e.g. Kubernetes ClusterIP service URL).'
                    : 'URL reachable directly from the user browser.'
                }
              />

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  label="Description (optional)"
                  value={form.description}
                  onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                  fullWidth
                  size="small"
                />
                {form.accessMode === 'proxy' && (
                  <TextField
                    label="Perses Secret Name (optional)"
                    placeholder="Optional auth Secret"
                    value={form.secretName}
                    onChange={(e) => setForm((prev) => ({ ...prev, secretName: e.target.value }))}
                    fullWidth
                    size="small"
                  />
                )}
              </Stack>

              <FormControlLabel
                control={
                  <Switch
                    checked={form.isDefault}
                    onChange={(e) => setForm((prev) => ({ ...prev, isDefault: e.target.checked }))}
                  />
                }
                label="Set as default data source for this plugin type"
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setFormOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" variant="contained" disabled={submitting}>
              {submitting ? 'Saving...' : form.mode === 'create' ? 'Create Data Source' : 'Save Changes'}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete Data Source</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2">
            Are you sure you want to delete{' '}
            <strong>{deleteTarget?.resource.metadata.name}</strong> (
            {deleteTarget?.scope === 'global' ? 'Global' : `Project: ${deleteTarget?.project}`})?
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)} disabled={deleting}>
            Cancel
          </Button>
          <Button color="error" variant="contained" onClick={handleDeleteConfirm} disabled={deleting}>
            {deleting ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Probe Inspection Dialog */}
      <Dialog open={Boolean(inspectedProbe)} onClose={() => setInspectedProbe(null)} maxWidth="md" fullWidth>
        <DialogTitle>
          Datasource Proxy Probe: {inspectedProbe?.name} ({inspectedProbe?.kind})
        </DialogTitle>
        <DialogContent dividers>
          {inspectedProbe && (
            <Stack spacing={1.5}>
              <Typography variant="body2">
                <strong>Scope:</strong>{' '}
                {inspectedProbe.scope === 'global' ? 'GlobalDatasource' : `Project (${inspectedProbe.project})`}
              </Typography>
              <Typography variant="body2">
                <strong>Status:</strong> {inspectedProbe.ok ? 'Connected' : 'Failed'} (HTTP {inspectedProbe.statusCode},{' '}
                {inspectedProbe.latencyMs} ms)
              </Typography>
              <JsonViewer value={inspectedProbe.detail} title="Proxy Probe Response" maxHeight={380} />
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setInspectedProbe(null)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
