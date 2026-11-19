import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import type { DatasourceResource, GlobalDatasourceResource, ProjectResource } from '@perses-dev/client';
import { getResourceDisplayName } from '@perses-dev/components';
import React from 'react';

import type { DatasourceProbeResult } from '@/lib/api/datasources';
import { JsonViewer } from '@/components/ui/JsonViewer';

export type UnifiedDatasourceItem =
  | { scope: 'global'; key: string; resource: GlobalDatasourceResource }
  | { scope: 'project'; project: string; key: string; resource: DatasourceResource };

export interface DatasourceFormState {
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

export interface DatasourceDialogsProps {
  projects: ProjectResource[];
  formOpen: boolean;
  form: DatasourceFormState;
  formError: string | null;
  submitting: boolean;
  onCloseForm: () => void;
  onChangeForm: React.Dispatch<React.SetStateAction<DatasourceFormState>>;
  onSaveDatasource: (e: React.FormEvent) => void;
  deleteTarget: UnifiedDatasourceItem | null;
  deleting: boolean;
  onCloseDelete: () => void;
  onConfirmDelete: () => void;
  inspectedProbe: DatasourceProbeResult | null;
  onCloseProbe: () => void;
}

export function DatasourceDialogs({
  projects,
  formOpen,
  form,
  formError,
  submitting,
  onCloseForm,
  onChangeForm,
  onSaveDatasource,
  deleteTarget,
  deleting,
  onCloseDelete,
  onConfirmDelete,
  inspectedProbe,
  onCloseProbe,
}: DatasourceDialogsProps) {
  return (
    <>
      {/* Create / Edit Datasource Dialog */}
      <Dialog open={formOpen} onClose={onCloseForm} maxWidth="sm" fullWidth>
        <Box component="form" onSubmit={onSaveDatasource}>
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
                      onChangeForm((prev) => ({
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
                      onChange={(e) => onChangeForm((prev) => ({ ...prev, project: e.target.value }))}
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
                  onChange={(e) => onChangeForm((prev) => ({ ...prev, name: e.target.value }))}
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
                  onChange={(e) => onChangeForm((prev) => ({ ...prev, displayName: e.target.value }))}
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
                    onChange={(e) => onChangeForm((prev) => ({ ...prev, pluginKind: e.target.value }))}
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
                      onChangeForm((prev) => ({ ...prev, accessMode: e.target.value as 'proxy' | 'direct' }))
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
                      ? 'http://victoria-traces:10428/select/jaeger'
                      : form.pluginKind === 'TempoDatasource'
                        ? 'http://tempo:3200'
                        : 'http://victoria-metrics:8428'
                }
                value={form.url}
                onChange={(e) => onChangeForm((prev) => ({ ...prev, url: e.target.value }))}
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
                  onChange={(e) => onChangeForm((prev) => ({ ...prev, description: e.target.value }))}
                  fullWidth
                  size="small"
                />
                {form.accessMode === 'proxy' && (
                  <TextField
                    label="Perses Secret Name (optional)"
                    placeholder="Optional auth Secret"
                    value={form.secretName}
                    onChange={(e) => onChangeForm((prev) => ({ ...prev, secretName: e.target.value }))}
                    fullWidth
                    size="small"
                  />
                )}
              </Stack>

              <FormControlLabel
                control={
                  <Switch
                    checked={form.isDefault}
                    onChange={(e) => onChangeForm((prev) => ({ ...prev, isDefault: e.target.checked }))}
                  />
                }
                label="Set as default data source for this plugin type"
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={onCloseForm} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" variant="contained" disabled={submitting}>
              {submitting ? 'Saving...' : form.mode === 'create' ? 'Create Data Source' : 'Save Changes'}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={Boolean(deleteTarget)} onClose={onCloseDelete} maxWidth="xs" fullWidth>
        <DialogTitle>Delete Data Source</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2">
            Are you sure you want to delete{' '}
            <strong>{deleteTarget?.resource.metadata.name}</strong> (
            {deleteTarget?.scope === 'global' ? 'Global' : `Project: ${deleteTarget?.project}`})?
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={onCloseDelete} disabled={deleting}>
            Cancel
          </Button>
          <Button color="error" variant="contained" onClick={onConfirmDelete} disabled={deleting}>
            {deleting ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Probe Inspection Dialog */}
      <Dialog open={Boolean(inspectedProbe)} onClose={onCloseProbe} maxWidth="md" fullWidth>
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
          <Button onClick={onCloseProbe}>Close</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
