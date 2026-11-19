import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
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
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import type { DashboardResource, ProjectResource } from '@perses-dev/client';
import { getResourceDisplayName } from '@perses-dev/components';
import Check from 'mdi-material-ui/Check';
import ContentCopy from 'mdi-material-ui/ContentCopy';
import React from 'react';

import type { PublicShareEntry } from '@/lib/api/publicShares';

export interface DashboardDialogsProps {
  // Project create/delete
  createProjOpen: boolean;
  onCloseCreateProj: () => void;
  onCreateProject: (e: React.FormEvent) => void;
  projError: string | null;
  projName: string;
  onChangeProjName: (val: string) => void;
  projDisplayName: string;
  onChangeProjDisplayName: (val: string) => void;
  projSaving: boolean;

  deleteProjOpen: boolean;
  onCloseDeleteProj: () => void;
  onDeleteProject: () => void;
  selectedProject: string;

  // Dashboard create/delete
  createDashOpen: boolean;
  onCloseCreateDash: () => void;
  onCreateDashboard: (e: React.FormEvent) => void;
  createMode: 'blank' | 'clone' | 'import';
  onChangeCreateMode: (mode: 'blank' | 'clone' | 'import') => void;
  dashError: string | null;
  onClearDashError: () => void;
  dashName: string;
  onChangeDashName: (val: string) => void;
  dashDisplayName: string;
  onChangeDashDisplayName: (val: string) => void;
  projects: ProjectResource[];
  cloneSourceProject: string;
  onChangeCloneSourceProject: (val: string) => void;
  cloneSourceDashboard: string;
  onChangeCloneSourceDashboard: (val: string) => void;
  cloneProjectDashboards: DashboardResource[];
  detectedImportFormat: 'perses' | 'empty' | 'grafana' | 'invalid';
  onImportFile: (e: React.ChangeEvent<HTMLInputElement>) => void;
  migratingGrafana: boolean;
  onPreviewMigrateGrafana: () => void;
  importJsonText: string;
  onChangeImportJsonText: (val: string) => void;
  useDefaultDatasource: boolean;
  onChangeUseDefaultDatasource: (val: boolean) => void;
  dashSaving: boolean;

  deleteDashOpen: boolean;
  onCloseDeleteDash: () => void;
  onDeleteDashboard: () => void;
  selectedDashboardName: string;

  // Share & Embed
  shareTarget: { project: string; dashboard: DashboardResource } | null;
  onCloseShare: () => void;
  shareScope: 'dashboard' | 'panel';
  onChangeShareScope: (val: 'dashboard' | 'panel') => void;
  sharePanelKey: string;
  onChangeSharePanelKey: (val: string) => void;
  shareVisibility: 'private' | 'public';
  onChangeShareVisibility: (val: 'private' | 'public') => void;
  shareBare: boolean;
  onChangeShareBare: (val: boolean) => void;
  shareCopied: 'url' | 'iframe' | null;
  onSetShareCopied: React.Dispatch<React.SetStateAction<'url' | 'iframe' | null>>;
  isSiteAdmin: boolean;
  guestDashboardsEnabled: boolean;
  availableNamespaces: string[];
  shareNamespaceScope: string;
  onChangeShareNamespaceScope: (val: string) => void;
  activePublicShare: PublicShareEntry | undefined;
  shareSaving: boolean;
  shareError: string | null;
  onPublishPublicShare: () => void;
  onRevokePublicShare: () => void;
}

export function DashboardDialogs({
  createProjOpen,
  onCloseCreateProj,
  onCreateProject,
  projError,
  projName,
  onChangeProjName,
  projDisplayName,
  onChangeProjDisplayName,
  projSaving,
  deleteProjOpen,
  onCloseDeleteProj,
  onDeleteProject,
  selectedProject,
  createDashOpen,
  onCloseCreateDash,
  onCreateDashboard,
  createMode,
  onChangeCreateMode,
  dashError,
  onClearDashError,
  dashName,
  onChangeDashName,
  dashDisplayName,
  onChangeDashDisplayName,
  projects,
  cloneSourceProject,
  onChangeCloneSourceProject,
  cloneSourceDashboard,
  onChangeCloneSourceDashboard,
  cloneProjectDashboards,
  detectedImportFormat,
  onImportFile,
  migratingGrafana,
  onPreviewMigrateGrafana,
  importJsonText,
  onChangeImportJsonText,
  useDefaultDatasource,
  onChangeUseDefaultDatasource,
  dashSaving,
  deleteDashOpen,
  onCloseDeleteDash,
  onDeleteDashboard,
  selectedDashboardName,
  shareTarget,
  onCloseShare,
  shareScope,
  onChangeShareScope,
  sharePanelKey,
  onChangeSharePanelKey,
  shareVisibility,
  onChangeShareVisibility,
  shareBare,
  onChangeShareBare,
  shareCopied,
  onSetShareCopied,
  isSiteAdmin,
  guestDashboardsEnabled,
  availableNamespaces,
  shareNamespaceScope,
  onChangeShareNamespaceScope,
  activePublicShare,
  shareSaving,
  shareError,
  onPublishPublicShare,
  onRevokePublicShare,
}: DashboardDialogsProps) {
  const muiTheme = useTheme();

  return (
    <>
      {/* Create Project Dialog */}
      <Dialog open={createProjOpen} onClose={onCloseCreateProj} maxWidth="xs" fullWidth>
        <Box component="form" onSubmit={onCreateProject}>
          <DialogTitle>Create Project</DialogTitle>
          <DialogContent dividers>
            <Stack spacing={2}>
              {projError && <Alert severity="error">{projError}</Alert>}
              <TextField
                label="Project ID (metadata.name)"
                placeholder="e.g. platform-team"
                value={projName}
                onChange={(e) => onChangeProjName(e.target.value)}
                required
                fullWidth
                size="small"
              />
              <TextField
                label="Display Name (optional)"
                placeholder="e.g. Platform Engineering"
                value={projDisplayName}
                onChange={(e) => onChangeProjDisplayName(e.target.value)}
                fullWidth
                size="small"
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={onCloseCreateProj} disabled={projSaving}>
              Cancel
            </Button>
            <Button type="submit" variant="contained" disabled={projSaving}>
              {projSaving ? 'Creating...' : 'Create Project'}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>

      {/* Delete Project Confirmation */}
      <Dialog open={deleteProjOpen} onClose={onCloseDeleteProj} maxWidth="xs" fullWidth>
        <DialogTitle>Delete Project</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2">
            Are you sure you want to delete project <strong>{selectedProject}</strong> and all dashboards inside it?
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={onCloseDeleteProj} disabled={projSaving}>
            Cancel
          </Button>
          <Button color="error" variant="contained" onClick={onDeleteProject} disabled={projSaving}>
            {projSaving ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Create Dashboard Dialog (Blank / Clone / Import JSON) */}
      <Dialog open={createDashOpen} onClose={onCloseCreateDash} maxWidth="sm" fullWidth>
        <Box component="form" onSubmit={onCreateDashboard}>
          <DialogTitle>New Dashboard in &ldquo;{selectedProject}&rdquo;</DialogTitle>
          <DialogContent dividers>
            <Stack spacing={2}>
              <Tabs
                value={createMode}
                onChange={(_, v: 'blank' | 'clone' | 'import') => {
                  onChangeCreateMode(v);
                  onClearDashError();
                }}
                sx={{ borderBottom: `1px solid ${muiTheme.palette.surface.borderSubtle}` }}
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
                  onChange={(e) => onChangeDashName(e.target.value)}
                  required={createMode !== 'import'}
                  fullWidth
                  size="small"
                  helperText={createMode === 'import' ? 'Optional if metadata.name is inside JSON' : undefined}
                />
                <TextField
                  label="Display Name"
                  placeholder="e.g. Service Latency & Errors"
                  value={dashDisplayName}
                  onChange={(e) => onChangeDashDisplayName(e.target.value)}
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
                        onChangeCloneSourceProject(e.target.value);
                        onChangeCloneSourceDashboard('');
                      }}
                    >
                      {projects.map((p) => (
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
                      onChange={(e) => onChangeCloneSourceDashboard(e.target.value)}
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
                  <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1}>
                    <Typography variant="caption" color="text.secondary">
                      Paste a <strong>Perses</strong> or <strong>Grafana</strong> Dashboard JSON document, or upload a{' '}
                      <code>.json</code> file.
                    </Typography>
                    <Stack direction="row" spacing={1} alignItems="center">
                      {detectedImportFormat === 'grafana' && (
                        <Chip size="small" color="info" variant="outlined" label="Grafana JSON detected" />
                      )}
                      {detectedImportFormat === 'perses' && (
                        <Chip size="small" color="success" variant="outlined" label="Perses JSON detected" />
                      )}
                      <Button size="small" variant="outlined" component="label">
                        Upload .json
                        <input type="file" hidden accept="application/json,.json" onChange={onImportFile} />
                      </Button>
                    </Stack>
                  </Stack>

                  {detectedImportFormat === 'grafana' && (
                    <Alert
                      severity="info"
                      action={
                        <Button
                          size="small"
                          color="inherit"
                          disabled={migratingGrafana || dashSaving}
                          onClick={onPreviewMigrateGrafana}
                        >
                          {migratingGrafana ? 'Converting...' : 'Convert & Preview'}
                        </Button>
                      }
                    >
                      Grafana JSON will be auto-converted via Perses <code>/api/migrate</code>.
                    </Alert>
                  )}

                  <TextField
                    multiline
                    minRows={6}
                    maxRows={12}
                    placeholder='Paste Perses JSON ({"kind": "Dashboard", ...}) or Grafana JSON ({"title": "...", "panels": [...]})'
                    value={importJsonText}
                    onChange={(e) => onChangeImportJsonText(e.target.value)}
                    fullWidth
                    InputProps={{ sx: { fontFamily: 'monospace', fontSize: 12 } }}
                  />

                  <FormControlLabel
                    control={
                      <Checkbox
                        size="small"
                        checked={useDefaultDatasource}
                        onChange={(e) => onChangeUseDefaultDatasource(e.target.checked)}
                      />
                    }
                    label={
                      <Typography variant="caption" color="text.secondary">
                        Map Grafana panel targets to cluster default Perses datasources when migrating
                      </Typography>
                    }
                  />
                </Stack>
              )}
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={onCloseCreateDash} disabled={dashSaving}>
              Cancel
            </Button>
            <Button type="submit" variant="contained" disabled={dashSaving}>
              {dashSaving ? 'Creating...' : 'Create Dashboard'}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>

      {/* Delete Dashboard Confirmation */}
      <Dialog open={deleteDashOpen} onClose={onCloseDeleteDash} maxWidth="xs" fullWidth>
        <DialogTitle>Delete Dashboard</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2">
            Are you sure you want to delete dashboard <strong>{selectedDashboardName}</strong> from project{' '}
            <strong>{selectedProject}</strong>?
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={onCloseDeleteDash} disabled={dashSaving}>
            Cancel
          </Button>
          <Button color="error" variant="contained" onClick={onDeleteDashboard} disabled={dashSaving}>
            {dashSaving ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Share & Embed Modal */}
      <Dialog open={Boolean(shareTarget)} onClose={onCloseShare} maxWidth="sm" fullWidth>
        <DialogTitle>
          Share &amp; Embed: {shareTarget ? getResourceDisplayName(shareTarget.dashboard) : ''}
        </DialogTitle>
        <DialogContent dividers>
          {shareTarget && (() => {
            const panelEntries = Object.entries(shareTarget.dashboard.spec?.panels ?? {});
            const origin = typeof window !== 'undefined' ? window.location.origin : '';
            const params = new URLSearchParams();
            if (shareScope === 'panel' && sharePanelKey) {
              params.set('panel', sharePanelKey);
            }
            if (shareBare) {
              params.set('bare', '1');
            }
            if (shareVisibility === 'public' && activePublicShare?.token) {
              params.set('share', activePublicShare.token);
            }
            const queryStr = params.toString();
            const canShowPublicUrl = shareVisibility === 'private' || Boolean(activePublicShare?.token);
            const embedUrl = canShowPublicUrl
              ? `${origin}/embed/projects/${encodeURIComponent(shareTarget.project)}/dashboards/${encodeURIComponent(shareTarget.dashboard.metadata.name)}${queryStr ? `?${queryStr}` : ''}`
              : '';
            const iframeHtml = canShowPublicUrl
              ? `<iframe src="${embedUrl}" width="100%" height="${shareScope === 'panel' ? 420 : 680}" frameborder="0" allowfullscreen></iframe>`
              : '';

            const copyShare = async (kind: 'url' | 'iframe', text: string) => {
              if (!text) return;
              try {
                await navigator.clipboard.writeText(text);
                onSetShareCopied(kind);
                setTimeout(() => onSetShareCopied((prev) => (prev === kind ? null : prev)), 2000);
              } catch {
                // Ignore clipboard errors
              }
            };

            return (
              <Stack spacing={2}>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                  <FormControl size="small" fullWidth>
                    <InputLabel id="share-scope-label">Share Scope</InputLabel>
                    <Select
                      labelId="share-scope-label"
                      label="Share Scope"
                      value={shareScope}
                      onChange={(e) => onChangeShareScope(e.target.value as 'dashboard' | 'panel')}
                    >
                      <MenuItem value="dashboard">Full Dashboard</MenuItem>
                      <MenuItem value="panel" disabled={panelEntries.length === 0}>
                        Single Panel {panelEntries.length === 0 ? '(none)' : ''}
                      </MenuItem>
                    </Select>
                  </FormControl>

                  <FormControl size="small" fullWidth>
                    <InputLabel id="share-vis-label">Access Mode</InputLabel>
                    <Select
                      labelId="share-vis-label"
                      label="Access Mode"
                      value={shareVisibility}
                      onChange={(e) => onChangeShareVisibility(e.target.value as 'private' | 'public')}
                    >
                      <MenuItem value="private">Private (Requires Login Session)</MenuItem>
                      <MenuItem value="public" disabled={!isSiteAdmin}>
                        Public (Guest Role + Token){!isSiteAdmin ? ' — Admin only' : ''}
                      </MenuItem>
                    </Select>
                  </FormControl>
                </Stack>

                {shareScope === 'panel' && panelEntries.length > 0 && (
                  <FormControl size="small" fullWidth>
                    <InputLabel id="share-panel-label">Select Panel</InputLabel>
                    <Select
                      labelId="share-panel-label"
                      label="Select Panel"
                      value={sharePanelKey}
                      onChange={(e) => onChangeSharePanelKey(e.target.value)}
                    >
                      {panelEntries.map(([key, panel]) => (
                        <MenuItem key={key} value={key}>
                          {panel.spec?.display?.name || key} ({key})
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                )}

                <FormControl size="small" fullWidth>
                  <InputLabel id="share-display-label">Embed Layout</InputLabel>
                  <Select
                    labelId="share-display-label"
                    label="Embed Layout"
                    value={shareBare ? 'bare' : 'controls'}
                    onChange={(e) => onChangeShareBare(e.target.value === 'bare')}
                  >
                    <MenuItem value="controls">Standard (With Time Range &amp; Filter Controls)</MenuItem>
                    <MenuItem value="bare">Bare (Dashboard / Panel Only — No Toolbar)</MenuItem>
                  </Select>
                </FormControl>

                {shareVisibility === 'public' ? (
                  <Stack spacing={1.5}>
                    {!guestDashboardsEnabled && (
                      <Alert severity="warning">
                        The <code>guest</code> role currently has <strong>Dashboards</strong> disabled. Enable{' '}
                        <strong>Dashboards (Overview)</strong> for <code>guest</code> in{' '}
                        <strong>Site Settings → Role View Permissions</strong> so unauthenticated viewers can load this
                        link.
                      </Alert>
                    )}
                    {shareError && <Alert severity="error">{shareError}</Alert>}
                    <FormControl size="small" fullWidth>
                      <InputLabel id="share-ns-scope-label">Tenant Namespace Scope</InputLabel>
                      <Select
                        labelId="share-ns-scope-label"
                        label="Tenant Namespace Scope"
                        value={shareNamespaceScope}
                        onChange={(e) => onChangeShareNamespaceScope(e.target.value)}
                        disabled={shareSaving}
                      >
                        <MenuItem value="*">All namespaces (*)</MenuItem>
                        {availableNamespaces.map((ns) => (
                          <MenuItem key={ns} value={ns}>
                            {ns}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Button
                        variant="contained"
                        size="small"
                        onClick={onPublishPublicShare}
                        disabled={shareSaving || !isSiteAdmin}
                      >
                        {shareSaving
                          ? 'Saving...'
                          : activePublicShare
                            ? 'Update Public Scope'
                            : 'Publish Public Link'}
                      </Button>
                      {activePublicShare && (
                        <Button
                          variant="outlined"
                          color="error"
                          size="small"
                          onClick={onRevokePublicShare}
                          disabled={shareSaving || !isSiteAdmin}
                        >
                          Revoke Link
                        </Button>
                      )}
                      {activePublicShare && (
                        <Chip
                          size="small"
                          color="success"
                          variant="outlined"
                          label={`Active (${activePublicShare.allowedNamespaces.join(', ')})`}
                        />
                      )}
                    </Stack>
                  </Stack>
                ) : (
                  <Alert severity="info">
                    Private embeds reuse the viewer&apos;s Perses/Keycloak browser session. For cross-domain{' '}
                    <code>&lt;iframe&gt;</code> embeds, set <code>perses.config.security.cookie.same_site: none</code>{' '}
                    (with HTTPS).
                  </Alert>
                )}

                {canShowPublicUrl ? (
                  <>
                    <TextField
                      label="Embed URL"
                      size="small"
                      value={embedUrl}
                      fullWidth
                      InputProps={{
                        readOnly: true,
                        sx: { fontFamily: 'monospace', fontSize: 12 },
                        endAdornment: (
                          <Button
                            size="small"
                            startIcon={
                              shareCopied === 'url' ? <Check fontSize="small" /> : <ContentCopy fontSize="small" />
                            }
                            onClick={() => void copyShare('url', embedUrl)}
                          >
                            {shareCopied === 'url' ? 'Copied' : 'Copy'}
                          </Button>
                        ),
                      }}
                    />

                    <TextField
                      label="HTML <iframe> Snippet"
                      size="small"
                      value={iframeHtml}
                      fullWidth
                      multiline
                      minRows={2}
                      InputProps={{
                        readOnly: true,
                        sx: { fontFamily: 'monospace', fontSize: 12 },
                        endAdornment: (
                          <Button
                            size="small"
                            startIcon={
                              shareCopied === 'iframe' ? <Check fontSize="small" /> : <ContentCopy fontSize="small" />
                            }
                            onClick={() => void copyShare('iframe', iframeHtml)}
                          >
                            {shareCopied === 'iframe' ? 'Copied' : 'Copy'}
                          </Button>
                        ),
                      }}
                    />
                  </>
                ) : (
                  <Alert severity="info">
                    Click <strong>Publish Public Link</strong> to generate an opaque share token scoped to the selected
                    namespace(s).
                  </Alert>
                )}
              </Stack>
            );
          })()}
        </DialogContent>
        <DialogActions>
          <Button onClick={onCloseShare}>Close</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
