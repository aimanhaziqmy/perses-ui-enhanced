import { Card, CardContent, Chip, Stack, Table, TableBody, TableCell, TableRow, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';

import type {
  PersesFrontendConfig,
  PersesHealthResponse,
  PersesPluginModuleResource,
} from '../api/persesClient';
import { fetchPersesPlugins, queryKeys } from '../api/persesClient';

export function SystemAboutView({
  health,
  config,
}: {
  health: PersesHealthResponse | undefined;
  config: PersesFrontendConfig | undefined;
}) {
  const { data: plugins = [] } = useQuery<PersesPluginModuleResource[], Error>({
    queryKey: queryKeys.plugins,
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
                <TableCell>{config?.frontend?.information ?? 'Unified Observability Stack'}</TableCell>
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
