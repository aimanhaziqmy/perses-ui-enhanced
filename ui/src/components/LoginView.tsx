import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  IconButton,
  LinearProgress,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import KeyVariant from 'mdi-material-ui/KeyVariant';
import ShieldCheck from 'mdi-material-ui/ShieldCheck';
import React, { useState } from 'react';

import type { PersesFrontendConfig, SiteBrandingConfig } from '../api/persesClient';
import { getLocalSiteBranding, loginNative } from '../api/persesClient';
import type { ThemeMode } from '../theme/persesTheme';
import { PALETTE_TOKENS } from '../theme/persesTheme';
import { MoonIcon, PersesLogoMark, SunIcon } from './BrandIcons';

interface LoginViewProps {
  config: PersesFrontendConfig | undefined;
  branding?: SiteBrandingConfig;
  initialError?: string;
  themeMode: ThemeMode;
  onToggleTheme: () => void;
  onAuthenticated: () => void;
}

export function LoginView({
  config,
  branding: brandingProp,
  initialError,
  themeMode,
  onToggleTheme,
  onAuthenticated,
}: LoginViewProps) {
  const muiTheme = useTheme();
  const tokens = PALETTE_TOKENS[muiTheme.palette.mode];
  const branding = brandingProp ?? getLocalSiteBranding();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(initialError ?? null);

  const providers = config?.security?.authentication?.providers;
  const nativeEnabled = providers?.enable_native ?? true;
  const oauthProviders = providers?.oauth ?? [];
  const oidcProviders = providers?.oidc ?? [];

  const handleNativeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setErrorMessage(null);
    try {
      await loginNative(username.trim(), password);
      onAuthenticated();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg || 'Authentication failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleExternalLogin = (kind: 'oauth' | 'oidc', slugId: string) => {
    const rd = encodeURIComponent(window.location.pathname + window.location.search || '/');
    window.location.href = `/api/auth/providers/${kind}/${encodeURIComponent(slugId)}/login?rd=${rd}`;
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        p: 3,
        bgcolor: tokens.bgCanvas,
      }}
    >
      <Card sx={{ width: '100%', maxWidth: 440, p: 1 }}>
        <CardContent>
          <Stack spacing={2.5}>
            <Stack direction="row" alignItems="center" justifyContent="space-between">
              <Stack direction="row" spacing={1.25} alignItems="center">
                <PersesLogoMark size={36} logoUrl={branding.logoUrl} logoText={branding.logoText} />
                <Box>
                  <Typography variant="h6" fontWeight={800} lineHeight={1.2}>
                    {branding.appName}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {branding.appSubtitle}
                  </Typography>
                </Box>
              </Stack>

              <Stack direction="row" spacing={0.75} alignItems="center">
                <Chip size="small" label="Auth Enabled" color="primary" variant="outlined" />
                <Tooltip title={`Switch to ${themeMode === 'light' ? 'Dark' : 'Light'} theme`}>
                  <IconButton size="small" onClick={onToggleTheme}>
                    {themeMode === 'light' ? <MoonIcon fontSize="small" /> : <SunIcon fontSize="small" />}
                  </IconButton>
                </Tooltip>
              </Stack>
            </Stack>

            {errorMessage && <Alert severity="error">{errorMessage}</Alert>}

            {(oidcProviders.length > 0 || oauthProviders.length > 0) && (
              <Stack spacing={1.25}>
                {oidcProviders.map((provider) => (
                  <Button
                    key={`oidc-${provider.slug_id}`}
                    variant="contained"
                    size="large"
                    fullWidth
                    startIcon={<ShieldCheck />}
                    onClick={() => handleExternalLogin('oidc', provider.slug_id)}
                  >
                    Sign in with {provider.name || provider.slug_id}
                  </Button>
                ))}
                {oauthProviders.map((provider) => (
                  <Button
                    key={`oauth-${provider.slug_id}`}
                    variant="contained"
                    size="large"
                    fullWidth
                    startIcon={<ShieldCheck />}
                    onClick={() => handleExternalLogin('oauth', provider.slug_id)}
                  >
                    Sign in with {provider.name || provider.slug_id}
                  </Button>
                ))}
              </Stack>
            )}

            {nativeEnabled && (oidcProviders.length > 0 || oauthProviders.length > 0) && (
              <Divider>
                <Typography variant="caption" color="text.secondary">
                  or native credentials
                </Typography>
              </Divider>
            )}

            {nativeEnabled && (
              <Box component="form" onSubmit={handleNativeSubmit}>
                <Stack spacing={2}>
                  <TextField
                    label="Username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                    fullWidth
                    autoComplete="username"
                  />
                  <TextField
                    label="Password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    fullWidth
                    autoComplete="current-password"
                  />
                  <Button
                    type="submit"
                    variant={oauthProviders.length > 0 || oidcProviders.length > 0 ? 'outlined' : 'contained'}
                    size="large"
                    fullWidth
                    disabled={submitting || !username.trim() || !password}
                    startIcon={<KeyVariant />}
                  >
                    Sign in with Perses Native Auth
                  </Button>
                  {submitting && <LinearProgress />}
                </Stack>
              </Box>
            )}
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
