import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import type { DashboardResource, ProjectResource } from '@perses-dev/client';
import { ErrorAlert, ErrorBoundary, getResourceDisplayName } from '@perses-dev/components';
import { ViewDashboard } from '@perses-dev/dashboards';
import { PluginRegistry, ValidationProvider, remotePluginLoader } from '@perses-dev/plugin-system';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import { fetchDashboard, fetchDashboards, fetchProjects, usePersesDatasourceApi } from '../api/persesClient';
import { PALETTE_TOKENS } from '../theme/persesTheme';

export function DashboardsView() {
  const muiTheme = useTheme();
  const tokens = PALETTE_TOKENS[muiTheme.palette.mode];

  const pluginLoader = useMemo(() => remotePluginLoader({ baseURL: '', apiPrefix: '' }), []);
  const [selectedProject, setSelectedProject] = useState<string>('');
  const [selectedDashboardName, setSelectedDashboardName] = useState<string>('');

  const {
    data: projects,
    isLoading: loadingProjects,
    error: projectsError,
  } = useQuery<ProjectResource[], Error>({
    queryKey: ['perses', 'projects'],
    queryFn: fetchProjects,
  });

  useEffect(() => {
    if (!projects || projects.length === 0) return;
    if (!selectedProject || !projects.some((p) => p.metadata.name === selectedProject)) {
      const preferred = projects.find((p) => p.metadata.name === 'observability') ?? projects[0];
      setSelectedProject(preferred.metadata.name);
    }
  }, [projects, selectedProject]);

  const {
    data: dashboards,
    isLoading: loadingDashboards,
    error: dashboardsError,
  } = useQuery<DashboardResource[], Error>({
    queryKey: ['perses', 'dashboards', selectedProject],
    queryFn: () => fetchDashboards(selectedProject),
    enabled: Boolean(selectedProject),
  });

  useEffect(() => {
    if (!dashboards || dashboards.length === 0) {
      setSelectedDashboardName('');
      return;
    }
    if (!selectedDashboardName || !dashboards.some((d) => d.metadata.name === selectedDashboardName)) {
      setSelectedDashboardName(dashboards[0].metadata.name);
    }
  }, [dashboards, selectedDashboardName]);

  const {
    data: activeDashboard,
    isLoading: loadingActiveDashboard,
    error: activeDashboardError,
  } = useQuery<DashboardResource, Error>({
    queryKey: ['perses', 'dashboard', selectedProject, selectedDashboardName],
    queryFn: () => fetchDashboard(selectedProject, selectedDashboardName),
    enabled: Boolean(selectedProject && selectedDashboardName),
  });

  const datasourceApi = usePersesDatasourceApi(selectedProject || undefined);

  if (loadingProjects) {
    return (
      <Stack alignItems="center" justifyContent="center" sx={{ py: 8 }}>
        <CircularProgress />
      </Stack>
    );
  }

  if (projectsError) {
    return <Alert severity="error">Failed to load Perses projects: {projectsError.message}</Alert>;
  }

  if (!projects || projects.length === 0) {
    return (
      <Alert severity="warning">
        No Perses projects found. Verify provisioning ConfigMap is mounted in Perses.
      </Alert>
    );
  }

  return (
    <Stack spacing={1.75} sx={{ height: '100%' }}>
      {/* Nightingale-style Breadcrumb & Variable Selector Header */}
      <Box
        sx={{
          px: 2,
          py: 1.5,
          borderRadius: 2,
          bgcolor: tokens.bgSurface,
          border: `1px solid ${tokens.borderSubtle}`,
          display: 'flex',
          flexDirection: { xs: 'column', md: 'row' },
          gap: 1.5,
          alignItems: { xs: 'stretch', md: 'center' },
          justifyContent: 'space-between',
        }}
      >
        <Stack direction="row" spacing={1.25} alignItems="center" flexWrap="wrap" useFlexGap>
          <Typography variant="body2" color="text.secondary" fontWeight={600}>
            Dashboards
          </Typography>
          <Typography variant="body2" color="text.secondary">
            /
          </Typography>
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel id="project-select-label">Project</InputLabel>
            <Select
              labelId="project-select-label"
              label="Project"
              value={selectedProject}
              onChange={(e) => {
                setSelectedProject(e.target.value);
                setSelectedDashboardName('');
              }}
            >
              {projects.map((p) => (
                <MenuItem key={p.metadata.name} value={p.metadata.name}>
                  {getResourceDisplayName(p)}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <Typography variant="body2" color="text.secondary">
            /
          </Typography>
          <FormControl size="small" sx={{ minWidth: 250 }} disabled={!dashboards || dashboards.length === 0}>
            <InputLabel id="dashboard-select-label">Dashboard</InputLabel>
            <Select
              labelId="dashboard-select-label"
              label="Dashboard"
              value={selectedDashboardName}
              onChange={(e) => setSelectedDashboardName(e.target.value)}
            >
              {(dashboards ?? []).map((d) => (
                <MenuItem key={d.metadata.name} value={d.metadata.name}>
                  {getResourceDisplayName(d)}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Stack>

        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
          <Chip
            size="small"
            variant="outlined"
            label="prom | VictoriaMetrics"
            sx={{ fontFamily: 'monospace', fontSize: 11.5 }}
          />
          <Chip
            size="small"
            variant="outlined"
            label="logs | VictoriaLogs"
            sx={{ fontFamily: 'monospace', fontSize: 11.5 }}
          />
        </Stack>
      </Box>

      {dashboardsError && <Alert severity="error">Failed to load dashboards: {dashboardsError.message}</Alert>}
      {activeDashboardError && (
        <Alert severity="error">Failed to load dashboard payload: {activeDashboardError.message}</Alert>
      )}

      {(loadingDashboards || loadingActiveDashboard) && (
        <Stack alignItems="center" justifyContent="center" sx={{ py: 8 }}>
          <CircularProgress />
        </Stack>
      )}

      {!loadingDashboards && dashboards && dashboards.length === 0 && (
        <Alert severity="info">Project &ldquo;{selectedProject}&rdquo; currently has no dashboards.</Alert>
      )}

      {activeDashboard && (
        <Box sx={{ flex: 1, minHeight: 0 }}>
          <ErrorBoundary FallbackComponent={ErrorAlert}>
            <PluginRegistry
              pluginLoader={pluginLoader}
              defaultPluginKinds={{
                Panel: 'TimeSeriesChart',
                TimeSeriesQuery: 'PrometheusTimeSeriesQuery',
              }}
            >
              <ValidationProvider>
                <ErrorBoundary FallbackComponent={ErrorAlert}>
                  <ViewDashboard
                    key={`${activeDashboard.metadata.project}/${activeDashboard.metadata.name}`}
                    dashboardResource={activeDashboard}
                    datasourceApi={datasourceApi}
                    isInitialVariableSticky={true}
                    isAnnotationEnabled={true}
                    isReadonly={false}
                    isEditing={false}
                    isVariableEnabled={true}
                    isDatasourceEnabled={true}
                  />
                </ErrorBoundary>
              </ValidationProvider>
            </PluginRegistry>
          </ErrorBoundary>
        </Box>
      )}
    </Stack>
  );
}
