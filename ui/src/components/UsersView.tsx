import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useQuery } from '@tanstack/react-query';
import React, { useEffect, useMemo, useState } from 'react';

import type {
  PersesFrontendConfig,
  PersesGlobalRoleBindingResource,
  PersesGlobalRoleResource,
  PersesHealthResponse,
  PersesPluginModuleResource,
  PersesUserResource,
  SiteBrandingConfig,
} from '../api/persesClient';
import {
  DEFAULT_SITE_BRANDING,
  fetchPersesGlobalRoleBindings,
  fetchPersesGlobalRoles,
  fetchPersesPlugins,
  fetchPersesUsers,
  fetchProjects,
} from '../api/persesClient';
import { PALETTE_TOKENS } from '../theme/persesTheme';
import { PersesLogoMark } from './BrandIcons';

function formatIso(ts?: string): string {
  if (!ts) return '-';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

export function UsersView() {
  const muiTheme = useTheme();
  const mode = muiTheme.palette.mode;
  const tokens = PALETTE_TOKENS[mode];
  const [search, setSearch] = useState('');

  const { data: users = [], isLoading, error } = useQuery<PersesUserResource[], Error>({
    queryKey: ['perses', 'users'],
    queryFn: fetchPersesUsers,
  });

  const { data: bindings = [] } = useQuery<PersesGlobalRoleBindingResource[], Error>({
    queryKey: ['perses', 'globalrolebindings'],
    queryFn: fetchPersesGlobalRoleBindings,
  });

  const { data: projects = [] } = useQuery({
    queryKey: ['perses', 'projects'],
    queryFn: fetchProjects,
  });

  const roleMap = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const b of bindings) {
      for (const s of b.spec.subjects ?? []) {
        if (s.kind === 'User') {
          const list = m.get(s.name) ?? [];
          list.push(b.spec.role);
          m.set(s.name, list);
        }
      }
    }
    return m;
  }, [bindings]);

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
    return <Alert severity="error">Failed to load Perses users: {error.message}</Alert>;
  }

  return (
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
        <TextField
          size="small"
          placeholder="Username, first name or last name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ width: { xs: '100%', sm: 290 }, '& .MuiInputBase-input': { fontSize: 13, py: 0.75 } }}
        />
        <Chip size="small" variant="outlined" label={`Total ${filtered.length} users`} />
      </Box>

      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Username ↑↓</TableCell>
              <TableCell>Alias</TableCell>
              <TableCell>Role</TableCell>
              <TableCell>Account source</TableCell>
              <TableCell>Projects</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Created</TableCell>
              <TableCell>Updated</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filtered.map((user) => {
              const roles = roleMap.get(user.metadata.name) ?? ['Standard'];
              const alias = `${user.spec?.firstName ?? ''} ${user.spec?.lastName ?? ''}`.trim() || user.metadata.name;
              const isOAuth = Boolean(user.spec?.oauthProviders && user.spec.oauthProviders.length > 0);
              return (
                <TableRow key={user.metadata.name} hover>
                  <TableCell sx={{ fontWeight: 600 }}>{user.metadata.name}</TableCell>
                  <TableCell>{alias}</TableCell>
                  <TableCell>{roles.join(', ')}</TableCell>
                  <TableCell>{isOAuth ? 'OAuth / OIDC' : 'Local Native'}</TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                      {projects.map((p) => (
                        <Chip key={p.metadata.name} size="small" variant="outlined" label={p.metadata.name} />
                      ))}
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label="Normal"
                      sx={{
                        height: 22,
                        fontSize: 11.5,
                        bgcolor: mode === 'light' ? '#ECFDF5' : 'rgba(16, 185, 129, 0.16)',
                        color: mode === 'light' ? '#15803D' : '#34D399',
                      }}
                    />
                  </TableCell>
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: 12, color: 'text.secondary' }}>
                    {formatIso(user.metadata.createdAt)}
                  </TableCell>
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: 12, color: 'text.secondary' }}>
                    {formatIso(user.metadata.updatedAt)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </Card>
  );
}

export function RolesView() {
  const { data: roles = [], isLoading, error } = useQuery<PersesGlobalRoleResource[], Error>({
    queryKey: ['perses', 'globalroles'],
    queryFn: fetchPersesGlobalRoles,
  });

  if (isLoading) {
    return (
      <Stack alignItems="center" justifyContent="center" sx={{ py: 8 }}>
        <CircularProgress />
      </Stack>
    );
  }

  if (error) {
    return <Alert severity="error">Failed to load Perses GlobalRoles: {error.message}</Alert>;
  }

  return (
    <Card>
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Role Name</TableCell>
              <TableCell>Permissions (Actions &amp; Scopes)</TableCell>
              <TableCell>Created</TableCell>
              <TableCell>Updated</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {roles.map((role) => (
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
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Card>
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
                <TableCell>{config?.frontend?.information ?? 'Perses + VictoriaMetrics + VictoriaLogs'}</TableCell>
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
}: {
  branding: SiteBrandingConfig;
  onSaveBranding: (next: SiteBrandingConfig) => Promise<void>;
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
    setSaving(true);
    setSaveMessage(null);
    try {
      setDraft(DEFAULT_SITE_BRANDING);
      await onSaveBranding(DEFAULT_SITE_BRANDING);
      setSaveMessage({ kind: 'success', text: 'Site branding reset to Perses defaults.' });
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
                  fullWidth
                  size="small"
                />
                <TextField
                  label="Organization / Workspace Subtitle"
                  helperText="Displayed under the active user badge at the bottom-left sidebar"
                  value={draft.orgName}
                  onChange={(e) => setDraft((prev) => ({ ...prev, orgName: e.target.value }))}
                  fullWidth
                  size="small"
                />
              </Stack>

              <TextField
                label="Site Description / Subtitle"
                helperText="Shown on the Login screen beneath the logo and in the browser title"
                value={draft.appSubtitle}
                onChange={(e) => setDraft((prev) => ({ ...prev, appSubtitle: e.target.value }))}
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
                  sx={{ width: { xs: '100%', md: 240 } }}
                  size="small"
                />
                <TextField
                  label="Custom Logo Image URL or Data URI"
                  helperText="Paste an HTTPS image URL, or upload a PNG/SVG/JPG file using the button on the right"
                  value={draft.logoUrl}
                  onChange={(e) => setDraft((prev) => ({ ...prev, logoUrl: e.target.value }))}
                  fullWidth
                  size="small"
                />
                <Stack direction="row" spacing={1} sx={{ pt: { md: 0.25 }, flexShrink: 0 }}>
                  <Button variant="outlined" component="label" size="medium">
                    Upload Logo
                    <input type="file" hidden accept="image/png,image/jpeg,image/svg+xml,image/webp" onChange={handleFileUpload} />
                  </Button>
                  {draft.logoUrl && (
                    <Button
                      variant="text"
                      color="secondary"
                      onClick={() => setDraft((prev) => ({ ...prev, logoUrl: '' }))}
                    >
                      Clear Logo
                    </Button>
                  )}
                </Stack>
              </Stack>

              <Stack direction="row" spacing={1.5} justifyContent="flex-end" sx={{ pt: 1 }}>
                <Button variant="outlined" color="inherit" disabled={saving} onClick={handleReset}>
                  Reset to Default
                </Button>
                <Button type="submit" variant="contained" color="primary" disabled={saving}>
                  {saving ? 'Saving...' : 'Save Site Settings'}
                </Button>
              </Stack>
            </Stack>
          </Box>
        </CardContent>
      </Card>
    </Stack>
  );
}

