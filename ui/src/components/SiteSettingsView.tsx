import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import React, { useEffect, useState } from 'react';

import type { SiteBrandingConfig } from '../api/persesClient';
import { DEFAULT_SITE_BRANDING } from '../api/persesClient';
import { PersesLogoMark } from './BrandIcons';
import { SsoSettingsCard } from './SsoSettingsCard';

export function SiteSettingsView({
  branding,
  onSaveBranding,
  canEdit = false,
}: {
  branding: SiteBrandingConfig;
  onSaveBranding: (next: SiteBrandingConfig) => Promise<void>;
  canEdit?: boolean;
}) {
  const theme = useTheme();

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

          <Box
            sx={{
              p: 2,
              mb: 3,
              borderRadius: 1.5,
              border: `1px solid ${theme.palette.surface.borderSubtle}`,
              bgcolor: theme.palette.surface.bgSubtle,
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
