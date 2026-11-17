import {
  Alert,
  Box,
  Card,
  Chip,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import Refresh from 'mdi-material-ui/Refresh';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import type { BackendAlertItem, BackendRuleGroup } from '../api/persesClient';
import {
  datasourceTargetKey,
  fetchBackendAlertRules,
  fetchBackendAlerts,
  queryKeys,
  useDatasourceTargets,
} from '../api/persesClient';
import { ViewEmptyState, ViewLoadingState } from './ViewStates';

export function BackendAlertsPanel() {
  const theme = useTheme();
  const { targets: promTargets } = useDatasourceTargets('PrometheusDatasource');
  const [selectedKey, setSelectedKey] = useState<string>('');

  useEffect(() => {
    if (promTargets.length === 0) {
      setSelectedKey('');
      return;
    }
    if (!selectedKey || !promTargets.some((t) => datasourceTargetKey(t) === selectedKey)) {
      const def = promTargets.find((t) => t.isDefault) ?? promTargets[0];
      setSelectedKey(datasourceTargetKey(def));
    }
  }, [promTargets, selectedKey]);

  const activeTarget = useMemo(
    () => promTargets.find((t) => datasourceTargetKey(t) === selectedKey) ?? promTargets[0] ?? null,
    [promTargets, selectedKey],
  );

  const activeKey = activeTarget ? datasourceTargetKey(activeTarget) : '';

  const {
    data: groups = [],
    isLoading: loadingRules,
    isFetching: fetchingRules,
    error: rulesError,
    refetch: refetchRules,
  } = useQuery<BackendRuleGroup[], Error>({
    queryKey: queryKeys.backendAlertRules(activeKey),
    queryFn: () => fetchBackendAlertRules(activeTarget!),
    enabled: Boolean(activeTarget),
    retry: false,
  });

  const {
    data: alerts = [],
    isLoading: loadingAlerts,
    isFetching: fetchingAlerts,
    error: alertsError,
    refetch: refetchAlerts,
  } = useQuery<BackendAlertItem[], Error>({
    queryKey: queryKeys.backendAlerts(activeKey),
    queryFn: () => fetchBackendAlerts(activeTarget!),
    enabled: Boolean(activeTarget),
    retry: false,
  });

  const flattenedRules = useMemo(
    () =>
      groups.flatMap((g) =>
        (g.rules ?? []).map((r) => ({
          group: g.name,
          ...r,
        })),
      ),
    [groups],
  );

  const firingAlerts = useMemo(
    () => alerts.filter((a) => a.state === 'firing' || a.state === 'pending'),
    [alerts],
  );

  if (!activeTarget) {
    return (
      <ViewEmptyState
        title="No Prometheus / vmalert datasource configured"
        description="Add a PrometheusDatasource in Integrations -> Data sources to query /api/v1/rules and /api/v1/alerts."
      />
    );
  }

  return (
    <Stack spacing={2}>
      <Card>
        <Box
          sx={{
            p: 1.5,
            borderBottom: `1px solid ${theme.palette.surface.borderSubtle}`,
            display: 'flex',
            flexWrap: 'wrap',
            gap: 1.25,
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <Stack direction="row" spacing={1.25} alignItems="center">
            <Tooltip title="Refresh /api/v1/rules and /api/v1/alerts">
              <IconButton
                size="small"
                onClick={() => {
                  void refetchRules();
                  void refetchAlerts();
                }}
                disabled={fetchingRules || fetchingAlerts}
                sx={{ border: `1px solid ${theme.palette.surface.borderSubtle}`, borderRadius: 1 }}
              >
                <Refresh fontSize="small" />
              </IconButton>
            </Tooltip>

            <FormControl size="small" sx={{ minWidth: 220 }}>
              <InputLabel>Prometheus / vmalert</InputLabel>
              <Select
                label="Prometheus / vmalert"
                value={activeKey}
                onChange={(e) => setSelectedKey(e.target.value)}
              >
                {promTargets.map((t) => (
                  <MenuItem key={datasourceTargetKey(t)} value={datasourceTargetKey(t)}>
                    {t.displayName}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <Chip
              size="small"
              color={firingAlerts.length > 0 ? 'error' : 'success'}
              variant="outlined"
              label={`${firingAlerts.length} active alerts`}
            />
            <Chip size="small" variant="outlined" label={`${flattenedRules.length} backend rules`} />
          </Stack>
        </Box>

        {(rulesError || alertsError) && (
          <Box sx={{ p: 2 }}>
            <Alert severity="info">
              Backend alerting endpoints returned:{' '}
              {rulesError?.message || alertsError?.message}. Ensure Prometheus or vmalert exposes{' '}
              <code>/api/v1/rules</code> and <code>/api/v1/alerts</code> on this datasource.
            </Alert>
          </Box>
        )}

        {loadingAlerts || loadingRules ? (
          <ViewLoadingState message="Querying /api/v1/rules and /api/v1/alerts..." />
        ) : (
          <Stack spacing={2} sx={{ p: 2 }}>
            <Box>
              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
                Active Alerts (/api/v1/alerts)
              </Typography>
              {alerts.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No active alerts reported by backend.
                </Typography>
              ) : (
                <TableContainer sx={{ border: `1px solid ${theme.palette.surface.borderSubtle}`, borderRadius: 1 }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Alert</TableCell>
                        <TableCell>State</TableCell>
                        <TableCell>Severity</TableCell>
                        <TableCell>Summary / Labels</TableCell>
                        <TableCell>Active Since</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {alerts.map((alert, idx) => (
                        <TableRow key={idx} hover>
                          <TableCell sx={{ fontWeight: 600 }}>
                            {alert.labels?.alertname ?? 'Alert'}
                          </TableCell>
                          <TableCell>
                            <Chip
                              size="small"
                              color={
                                alert.state === 'firing'
                                  ? 'error'
                                  : alert.state === 'pending'
                                    ? 'warning'
                                    : 'default'
                              }
                              label={alert.state}
                            />
                          </TableCell>
                          <TableCell>{alert.labels?.severity ?? '-'}</TableCell>
                          <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                            {alert.annotations?.summary ||
                              alert.annotations?.description ||
                              Object.entries(alert.labels ?? {})
                                .filter(([k]) => k !== 'alertname')
                                .map(([k, v]) => `${k}=${v}`)
                                .join(', ')}
                          </TableCell>
                          <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                            {alert.activeAt ? alert.activeAt.replace('T', ' ').slice(0, 19) : '-'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </Box>

            <Box>
              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
                Backend Rule Groups (/api/v1/rules)
              </Typography>
              {flattenedRules.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No backend rules returned by datasource.
                </Typography>
              ) : (
                <TableContainer sx={{ border: `1px solid ${theme.palette.surface.borderSubtle}`, borderRadius: 1 }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Group</TableCell>
                        <TableCell>Rule</TableCell>
                        <TableCell>Type</TableCell>
                        <TableCell>State</TableCell>
                        <TableCell>Health</TableCell>
                        <TableCell>Expression</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {flattenedRules.map((rule, idx) => (
                        <TableRow key={`${rule.group}-${rule.name}-${idx}`} hover>
                          <TableCell>{rule.group}</TableCell>
                          <TableCell sx={{ fontWeight: 600 }}>{rule.name}</TableCell>
                          <TableCell>
                            <Chip size="small" variant="outlined" label={rule.type} />
                          </TableCell>
                          <TableCell>
                            <Chip
                              size="small"
                              color={
                                rule.state === 'firing'
                                  ? 'error'
                                  : rule.state === 'pending'
                                    ? 'warning'
                                    : 'success'
                              }
                              variant="outlined"
                              label={rule.state ?? 'ok'}
                            />
                          </TableCell>
                          <TableCell>{rule.health ?? '-'}</TableCell>
                          <TableCell sx={{ fontFamily: 'monospace', fontSize: 11.5, maxWidth: 360 }} title={rule.query}>
                            <Typography variant="caption" sx={{ fontFamily: 'monospace' }} noWrap display="block">
                              {rule.query}
                            </Typography>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </Box>
          </Stack>
        )}
      </Card>
    </Stack>
  );
}
