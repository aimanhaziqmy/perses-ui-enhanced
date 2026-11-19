import { Alert, Box, Button, Chip, FormControl, InputLabel, MenuItem, Select, Stack } from '@mui/material';
import type { ProjectResource } from '@perses-dev/client';
import { ErrorAlert, ErrorBoundary, getResourceDisplayName } from '@perses-dev/components';
import { ViewExplore } from '@perses-dev/explore';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useDatasourceTargets, usePersesDatasourceApi } from '@/lib/api/datasources';
import { fetchProjects } from '@/lib/api/projects';
import { queryKeys } from '@/lib/api/queryKeys';

export function ExploreView({ defaultProject = '' }: { defaultProject?: string }) {
  const navigate = useNavigate();
  const [projectName, setProjectName] = useState<string>(defaultProject);

  const { data: projects, error: projectsError } = useQuery<ProjectResource[], Error>({
    queryKey: queryKeys.projects,
    queryFn: fetchProjects,
  });

  const { targets: allDatasources, isLoading: loadingDatasources } = useDatasourceTargets();
  const datasourceApi = usePersesDatasourceApi(projectName || undefined);

  return (
    <Stack spacing={1.5} sx={{ height: '100%' }}>
      {projectsError && <Alert severity="error">Failed to load project scopes: {projectsError.message}</Alert>}

      {!loadingDatasources && allDatasources.length === 0 ? (
        <Alert
          severity="info"
          action={
            <Button size="small" color="inherit" onClick={() => navigate('/datasources')}>
              Add data source
            </Button>
          }
        >
          No data sources are configured yet. Add a Prometheus or VictoriaLogs data source in Integrations → Data
          sources to explore metrics and logs.
        </Alert>
      ) : (
        <Box sx={{ flex: 1, minHeight: 540 }}>
          <ErrorBoundary FallbackComponent={ErrorAlert}>
            <ViewExplore
              datasourceApi={datasourceApi}
              projectName={projectName || undefined}
              exploreTitleComponent={
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                  <FormControl size="small" sx={{ minWidth: 190 }}>
                    <InputLabel id="explore-project-label" shrink>Datasource Scope</InputLabel>
                    <Select
                      labelId="explore-project-label"
                      label="Datasource Scope"
                      displayEmpty
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
                  <Chip
                    size="small"
                    variant="outlined"
                    label="PromQL · LogsQL"
                    sx={{ height: 24, fontSize: 11, fontFamily: 'monospace' }}
                  />
                </Stack>
              }
            />
          </ErrorBoundary>
        </Box>
      )}
    </Stack>
  );
}
