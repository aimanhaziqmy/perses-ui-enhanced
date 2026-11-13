import { Alert, Box, FormControl, InputLabel, MenuItem, Select, Stack, Typography } from '@mui/material';
import type { ProjectResource } from '@perses-dev/client';
import { ErrorAlert, ErrorBoundary, getResourceDisplayName } from '@perses-dev/components';
import { ViewExplore } from '@perses-dev/explore';
import { PluginRegistry, ValidationProvider, remotePluginLoader } from '@perses-dev/plugin-system';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { fetchProjects, usePersesDatasourceApi } from '../api/persesClient';

export function ExploreView() {
  const pluginLoader = useMemo(() => remotePluginLoader({ baseURL: '', apiPrefix: '' }), []);
  const [projectName, setProjectName] = useState<string>('');

  const { data: projects, error: projectsError } = useQuery<ProjectResource[], Error>({
    queryKey: ['perses', 'projects'],
    queryFn: fetchProjects,
  });

  const datasourceApi = usePersesDatasourceApi(projectName || undefined);

  return (
    <Stack spacing={2} sx={{ height: '100%' }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        alignItems={{ xs: 'stretch', sm: 'center' }}
        justifyContent="space-between"
        sx={{
          p: 2,
          borderRadius: 2,
          bgcolor: 'background.paper',
          border: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Box>
          <Typography variant="subtitle1" fontWeight={700}>
            Unified Metrics &amp; Logs Explorer
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Query VictoriaMetrics (PromQL) and VictoriaLogs (LogsQL) directly via Perses Proxy
          </Typography>
        </Box>

        <FormControl size="small" sx={{ minWidth: 220 }}>
          <InputLabel id="explore-project-label">Datasource Scope</InputLabel>
          <Select
            labelId="explore-project-label"
            label="Datasource Scope"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
          >
            <MenuItem value="">Global Datasources</MenuItem>
            {(projects ?? []).map((p) => (
              <MenuItem key={p.metadata.name} value={p.metadata.name}>
                {getResourceDisplayName(p)}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Stack>

      {projectsError && <Alert severity="error">Failed to load project scopes: {projectsError.message}</Alert>}

      <Box sx={{ flex: 1, minHeight: 540 }}>
        <ErrorBoundary FallbackComponent={ErrorAlert}>
          <PluginRegistry pluginLoader={pluginLoader}>
            <ValidationProvider>
              <ErrorBoundary FallbackComponent={ErrorAlert}>
                <ViewExplore datasourceApi={datasourceApi} projectName={projectName || undefined} />
              </ErrorBoundary>
            </ValidationProvider>
          </PluginRegistry>
        </ErrorBoundary>
      </Box>
    </Stack>
  );
}

