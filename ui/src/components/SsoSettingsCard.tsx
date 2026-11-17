import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useQuery } from '@tanstack/react-query';
import Check from 'mdi-material-ui/Check';
import ContentCopy from 'mdi-material-ui/ContentCopy';
import KeyVariant from 'mdi-material-ui/KeyVariant';
import ShieldAccount from 'mdi-material-ui/ShieldAccount';

import { fetchPersesConfig } from '../api/persesClient';

type SsoPresetKey = 'keycloak' | 'oidc' | 'google' | 'github';

const SSO_PRESETS: Record<
  SsoPresetKey,
  {
    label: string;
    kind: 'oidc' | 'oauth';
    slugId: string;
    displayName: string;
    scopes: string[];
    issuerPlaceholder: string;
    issuerHelper: string;
    loginProp: string;
  }
> = {
  keycloak: {
    label: 'Keycloak (OIDC / OAuth2)',
    kind: 'oauth',
    slugId: 'keycloak',
    displayName: 'Keycloak SSO',
    scopes: ['openid', 'profile', 'email'],
    issuerPlaceholder: 'https://auth.example.com/realms/observability',
    issuerHelper: 'Keycloak realm base URL (e.g. https://keycloak.example.com/auth/realms/<realm>)',
    loginProp: 'preferred_username',
  },
  oidc: {
    label: 'Generic OIDC (Okta, Dex, Authentik, Azure AD)',
    kind: 'oidc',
    slugId: 'oidc',
    displayName: 'Company SSO',
    scopes: ['openid', 'profile', 'email'],
    issuerPlaceholder: 'https://idp.example.com',
    issuerHelper: 'OIDC Discovery Issuer URL (must serve /.well-known/openid-configuration)',
    loginProp: 'preferred_username',
  },
  google: {
    label: 'Google Workspace / OAuth2',
    kind: 'oauth',
    slugId: 'google',
    displayName: 'Google SSO',
    scopes: ['openid', 'profile', 'email'],
    issuerPlaceholder: 'https://accounts.google.com',
    issuerHelper: 'Google OIDC issuer URL',
    loginProp: 'email',
  },
  github: {
    label: 'GitHub OAuth2',
    kind: 'oauth',
    slugId: 'github',
    displayName: 'GitHub SSO',
    scopes: ['read:user', 'user:email'],
    issuerPlaceholder: 'https://github.com',
    issuerHelper: 'GitHub base URL (or GitHub Enterprise URL)',
    loginProp: 'login',
  },
};

export function SsoSettingsCard() {
  const theme = useTheme();
  const { data: config } = useQuery({
    queryKey: ['perses-config'],
    queryFn: fetchPersesConfig,
    retry: 1,
  });

  const auth = config?.security?.authentication;
  const providers = auth?.providers;
  const nativeEnabled = providers?.enable_native ?? true;
  const oidcList = providers?.oidc ?? [];
  const oauthList = providers?.oauth ?? [];
  const activeProviders = [
    ...oidcList.map((p) => ({ kind: 'oidc' as const, ...p })),
    ...oauthList.map((p) => ({ kind: 'oauth' as const, ...p })),
  ];

  const defaultOrigin = typeof window !== 'undefined' ? window.location.origin : 'https://perses.example.com';

  const [preset, setPreset] = useState<SsoPresetKey>('keycloak');
  const [slugId, setSlugId] = useState(SSO_PRESETS.keycloak.slugId);
  const [displayName, setDisplayName] = useState(SSO_PRESETS.keycloak.displayName);
  const [uiBaseUrl, setUiBaseUrl] = useState(defaultOrigin);
  const [issuerOrBaseUrl, setIssuerOrBaseUrl] = useState(SSO_PRESETS.keycloak.issuerPlaceholder);
  const [clientId, setClientId] = useState('perses-ui');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const activePreset = SSO_PRESETS[preset];

  const handlePresetChange = (next: SsoPresetKey) => {
    setPreset(next);
    const cfg = SSO_PRESETS[next];
    setSlugId(cfg.slugId);
    setDisplayName(cfg.displayName);
    setIssuerOrBaseUrl(cfg.issuerPlaceholder);
  };

  const normalizedOrigin = uiBaseUrl.trim().replace(/\/+$/, '') || defaultOrigin;
  const normalizedIssuer = issuerOrBaseUrl.trim().replace(/\/+$/, '') || activePreset.issuerPlaceholder;
  const safeSlug = slugId.trim().replace(/[^a-zA-Z0-9_-]/g, '') || activePreset.slugId;
  const callbackUrl = `${normalizedOrigin}/api/auth/providers/${activePreset.kind}/${safeSlug}/callback`;

  const generatedYaml = useMemo(() => {
    const scopesYaml = activePreset.scopes.map((s) => `"${s}"`).join(', ');
    if (preset === 'oidc' || preset === 'google') {
      return [
        'perses:',
        '  config:',
        '    security:',
        '      enable_auth: true',
        '      authentication:',
        '        disable_sign_up: false',
        '        providers:',
        `          enable_native: ${nativeEnabled}`,
        '          oidc:',
        `            - slug_id: ${safeSlug}`,
        `              name: "${displayName.trim() || activePreset.displayName}"`,
        `              client_id: "${clientId.trim() || 'perses-ui'}"`,
        '              client_secret_file: /etc/perses/secrets/client-secret',
        `              redirect_uri: "${callbackUrl}"`,
        `              scopes: [${scopesYaml}]`,
        `              issuer: "${normalizedIssuer}"`,
        `              custom_login_property: "${activePreset.loginProp}"`,
      ].join('\n');
    }

    const isGithub = preset === 'github';
    const authUrl = isGithub
      ? `${normalizedIssuer}/login/oauth/authorize`
      : `${normalizedIssuer}/protocol/openid-connect/auth`;
    const tokenUrl = isGithub
      ? `${normalizedIssuer}/login/oauth/access_token`
      : `${normalizedIssuer}/protocol/openid-connect/token`;
    const userInfoUrl = isGithub
      ? 'https://api.github.com/user'
      : `${normalizedIssuer}/protocol/openid-connect/userinfo`;

    return [
      'perses:',
      '  config:',
      '    security:',
      '      enable_auth: true',
      '      authentication:',
      '        disable_sign_up: false',
      '        providers:',
      `          enable_native: ${nativeEnabled}`,
      '          oauth:',
      `            - slug_id: ${safeSlug}`,
      `              name: "${displayName.trim() || activePreset.displayName}"`,
      `              client_id: "${clientId.trim() || 'perses-ui'}"`,
      '              client_secret_file: /etc/perses/secrets/client-secret',
      `              redirect_uri: "${callbackUrl}"`,
      `              scopes: [${scopesYaml}]`,
      `              auth_url: "${authUrl}"`,
      `              token_url: "${tokenUrl}"`,
      `              user_infos_url: "${userInfoUrl}"`,
      `              custom_login_property: "${activePreset.loginProp}"`,
    ].join('\n');
  }, [activePreset, callbackUrl, clientId, displayName, nativeEnabled, normalizedIssuer, preset, safeSlug]);

  const copyText = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((prev) => (prev === key ? null : prev)), 2000);
    } catch {
      // Ignore clipboard failures on non-HTTPS origins
    }
  };

  return (
    <Card>
      <CardContent>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
          <ShieldAccount fontSize="small" />
          <Typography variant="subtitle1" fontWeight={700}>
            SSO &amp; Identity Providers
          </Typography>
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          The login screen automatically renders any OIDC or OAuth2 provider configured on the Perses server alongside
          native credentials. Use this panel to inspect active providers or generate Helm values for Keycloak, Okta,
          Google, GitHub, or any OIDC IdP.
        </Typography>

        {/* Live Status */}
        <Box
          sx={{
            p: 1.75,
            mb: 2.5,
            borderRadius: 1.5,
            border: `1px solid ${theme.palette.surface.borderSubtle}`,
            bgcolor: theme.palette.surface.bgSubtle,
          }}
        >
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 1.25 }}>
            <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase' }}>
              Active Server Auth Config
            </Typography>
            <Chip
              size="small"
              color={nativeEnabled ? 'success' : 'default'}
              variant="outlined"
              label={`Native Login: ${nativeEnabled ? 'Enabled' : 'Disabled'}`}
            />
            <Chip
              size="small"
              variant="outlined"
              label={`Auto-Signup: ${auth?.disable_sign_up ? 'Disabled' : 'Enabled'}`}
            />
            <Chip
              size="small"
              color={activeProviders.length > 0 ? 'primary' : 'default'}
              variant="outlined"
              label={`External SSO: ${activeProviders.length} configured`}
            />
          </Stack>

          {activeProviders.length === 0 ? (
            <Typography variant="caption" color="text.secondary">
              No external OIDC/OAuth providers are currently active on `/api/config`. Generate a snippet below and apply
              it via Helm values to enable SSO.
            </Typography>
          ) : (
            <Stack spacing={1}>
              {activeProviders.map((prov) => {
                const liveCallback = `${defaultOrigin}/api/auth/providers/${prov.kind}/${prov.slug_id}/callback`;
                return (
                  <Box
                    key={`${prov.kind}-${prov.slug_id}`}
                    sx={{
                      p: 1.25,
                      borderRadius: 1,
                      border: `1px solid ${theme.palette.surface.borderSubtle}`,
                      bgcolor: theme.palette.background.paper,
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 1,
                    }}
                  >
                    <Stack direction="row" spacing={1} alignItems="center">
                      <KeyVariant fontSize="small" />
                      <Typography variant="body2" fontWeight={600}>
                        {prov.name || prov.slug_id}
                      </Typography>
                      <Chip size="small" label={`${prov.kind.toUpperCase()} · ${prov.slug_id}`} sx={{ height: 20, fontSize: 11 }} />
                    </Stack>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Typography variant="caption" sx={{ fontFamily: 'monospace', color: 'text.secondary' }}>
                        {liveCallback}
                      </Typography>
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={copiedKey === prov.slug_id ? <Check fontSize="small" /> : <ContentCopy fontSize="small" />}
                        onClick={() => void copyText(prov.slug_id, liveCallback)}
                      >
                        {copiedKey === prov.slug_id ? 'Copied' : 'Copy Callback'}
                      </Button>
                    </Stack>
                  </Box>
                );
              })}
            </Stack>
          )}
        </Box>

        <Divider sx={{ mb: 2.5 }} />

        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.5 }}>
          Helm / Perses SSO Config Generator
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
          Perses loads OIDC/OAuth providers from server configuration at startup. Generate your provider YAML below,
          register the Callback URL in your IdP, and upgrade your Helm release.
        </Typography>

        <Stack spacing={2}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
            <TextField
              select
              label="Identity Provider Preset"
              value={preset}
              onChange={(e) => handlePresetChange(e.target.value as SsoPresetKey)}
              size="small"
              fullWidth
            >
              {(Object.keys(SSO_PRESETS) as SsoPresetKey[]).map((key) => (
                <MenuItem key={key} value={key}>
                  {SSO_PRESETS[key].label}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="Button Display Name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              helperText='Shown as "Sign in with <Name>" on the login screen'
              size="small"
              fullWidth
            />
            <TextField
              label="Provider Slug ID"
              value={slugId}
              onChange={(e) => setSlugId(e.target.value)}
              helperText="URL-safe identifier (e.g. keycloak, okta)"
              size="small"
              sx={{ width: { xs: '100%', md: 220 } }}
            />
          </Stack>

          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
            <TextField
              label="Observability UI Base URL"
              value={uiBaseUrl}
              onChange={(e) => setUiBaseUrl(e.target.value)}
              helperText="External HTTPS URL where users open this UI"
              size="small"
              fullWidth
            />
            <TextField
              label="Client ID"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              helperText="OAuth / OIDC client ID registered in your IdP"
              size="small"
              sx={{ width: { xs: '100%', md: 280 } }}
            />
          </Stack>

          <TextField
            label="Issuer / Realm Base URL"
            value={issuerOrBaseUrl}
            onChange={(e) => setIssuerOrBaseUrl(e.target.value)}
            helperText={activePreset.issuerHelper}
            size="small"
            fullWidth
          />

          <Alert
            severity="info"
            action={
              <Button
                size="small"
                color="inherit"
                startIcon={copiedKey === 'callback' ? <Check fontSize="small" /> : <ContentCopy fontSize="small" />}
                onClick={() => void copyText('callback', callbackUrl)}
              >
                {copiedKey === 'callback' ? 'Copied' : 'Copy'}
              </Button>
            }
          >
            <Typography variant="caption" fontWeight={700} display="block">
              Register this Valid Redirect / Callback URI in your IdP:
            </Typography>
            <Typography variant="caption" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
              {callbackUrl}
            </Typography>
          </Alert>

          <Box>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.75 }}>
              <Typography variant="caption" fontWeight={700} color="text.secondary">
                values.yaml snippet (store client secret in Kubernetes Secret, never inline)
              </Typography>
              <Button
                size="small"
                variant="outlined"
                startIcon={copiedKey === 'yaml' ? <Check fontSize="small" /> : <ContentCopy fontSize="small" />}
                onClick={() => void copyText('yaml', generatedYaml)}
              >
                {copiedKey === 'yaml' ? 'Copied YAML' : 'Copy YAML'}
              </Button>
            </Stack>
            <Box
              component="pre"
              sx={{
                m: 0,
                p: 1.5,
                borderRadius: 1.25,
                border: `1px solid ${theme.palette.surface.borderSubtle}`,
                bgcolor: theme.palette.surface.bgSubtle,
                fontFamily: 'monospace',
                fontSize: 12,
                lineHeight: 1.5,
                overflowX: 'auto',
              }}
            >
              {generatedYaml}
            </Box>
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}
