import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  FormControl,
  IconButton,
  MenuItem,
  Select,
  Stack,
  Switch,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import AlertCircle from 'mdi-material-ui/AlertCircle';
import CheckCircle from 'mdi-material-ui/CheckCircle';
import Refresh from 'mdi-material-ui/Refresh';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import type { LiveAlertRuleEvaluation, VictoriaLogsQueryResult } from '../api/persesClient';
import { evaluateLiveAlertRules, queryVictoriaLogs } from '../api/persesClient';
import { PALETTE_TOKENS } from '../theme/persesTheme';

const RULE_GROUPS = ['All', 'Core Infrastructure', 'GPU & AI Compute', 'Workloads', 'Storage', 'Observability'];

function formatTs(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

export function AlertRulesView({ defaultSubTab = 'rules' }: { defaultSubTab?: 'rules' | 'events' }) {
  const muiTheme = useTheme();
  const mode = muiTheme.palette.mode;
  const tokens = PALETTE_TOKENS[mode];

  const [subTab, setSubTab] = useState<'rules' | 'events'>(defaultSubTab);
  const [selectedGroup, setSelectedGroup] = useState<string>('All');
  const [groupFilterText, setGroupFilterText] = useState<string>('');
  const [datasourceFilter, setDatasourceFilter] = useState<string>('ALL');
  const [severityFilter, setSeverityFilter] = useState<string>('ALL');
  const [searchText, setSearchText] = useState<string>('');
  const [disabledIds, setDisabledIds] = useState<Record<string, boolean>>({});
  const [selectedRule, setSelectedRule] = useState<LiveAlertRuleEvaluation | null>(null);
  const [page, setPage] = useState<number>(0);
  const [rowsPerPage, setRowsPerPage] = useState<number>(10);

  const {
    data: rules = [],
    isLoading: loadingRules,
    isFetching: fetchingRules,
    error: rulesError,
    refetch: refetchRules,
  } = useQuery<LiveAlertRuleEvaluation[], Error>({
    queryKey: ['live-alert-rules'],
    queryFn: evaluateLiveAlertRules,
    refetchInterval: 30000,
    enabled: subTab === 'rules',
  });

  const {
    data: eventsResult,
    isLoading: loadingEvents,
    isFetching: fetchingEvents,
    error: eventsError,
    refetch: refetchEvents,
  } = useQuery<VictoriaLogsQueryResult, Error>({
    queryKey: ['vlogs', 'k8s-events-tab'],
    queryFn: () => {
      const startIso = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
      const endIso = new Date().toISOString();
      return queryVictoriaLogs('stream:="k8s_events"', 150, startIso, endIso, 'VictoriaLogs');
    },
    refetchInterval: 30000,
    enabled: subTab === 'events',
  });

  const filteredRules = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return rules.filter((r) => {
      if (selectedGroup !== 'All' && r.group !== selectedGroup) return false;
      if (datasourceFilter !== 'ALL' && r.datasource !== datasourceFilter) return false;
      if (severityFilter !== 'ALL' && r.severity !== severityFilter) return false;
      if (!q) return true;
      return `${r.name} ${r.query} ${r.group} ${r.detail}`.toLowerCase().includes(q);
    });
  }, [rules, selectedGroup, datasourceFilter, severityFilter, searchText]);

  const pagedRules = useMemo(() => {
    const start = page * rowsPerPage;
    return filteredRules.slice(start, start + rowsPerPage);
  }, [filteredRules, page, rowsPerPage]);

  const events = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    const list = eventsResult?.entries ?? [];
    if (!q) return list;
    return list.filter((e) => JSON.stringify(e).toLowerCase().includes(q));
  }, [eventsResult, searchText]);

  return (
    <Stack spacing={1.5}>
      <Card>
        <Box sx={{ px: 2, borderBottom: `1px solid ${tokens.borderSubtle}` }}>
          <Tabs
            value={subTab}
            onChange={(_, val: 'rules' | 'events') => {
              setSubTab(val);
              setPage(0);
            }}
            sx={{ minHeight: 42, '& .MuiTab-root': { minHeight: 42, py: 0.75, fontSize: 13 } }}
          >
            <Tab value="rules" label="Alert rules (Live Cluster Checks)" />
            <Tab value="events" label="Kubernetes Events (VictoriaLogs)" />
          </Tabs>
        </Box>
      </Card>

      {subTab === 'rules' ? (
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'stretch' }}>
          {/* Left Preset Filters & Groups */}
          <Card sx={{ width: 224, flexShrink: 0, display: { xs: 'none', md: 'block' } }}>
            <CardContent sx={{ p: 1.75 }}>
              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
                Preset filters
              </Typography>
              <Box
                onClick={() => {
                  setSelectedGroup('All');
                  setPage(0);
                }}
                sx={{
                  px: 1.25,
                  py: 0.75,
                  mb: 2,
                  borderRadius: 1,
                  cursor: 'pointer',
                  fontSize: 13,
                  fontWeight: selectedGroup === 'All' ? 600 : 400,
                  bgcolor: selectedGroup === 'All' ? tokens.bgActiveNav : 'transparent',
                  color: selectedGroup === 'All' ? 'primary.main' : 'text.primary',
                }}
              >
                All ({rules.length})
              </Box>

              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
                Business groups
              </Typography>
              <TextField
                size="small"
                fullWidth
                placeholder="Search groups..."
                value={groupFilterText}
                onChange={(e) => setGroupFilterText(e.target.value)}
                sx={{ mb: 1.25, '& .MuiInputBase-input': { fontSize: 12.5, py: 0.75 } }}
              />
              <Stack spacing={0.4}>
                {RULE_GROUPS.filter(
                  (g) => g !== 'All' && g.toLowerCase().includes(groupFilterText.trim().toLowerCase()),
                ).map((group) => {
                  const selected = selectedGroup === group;
                  return (
                    <Box
                      key={group}
                      onClick={() => {
                        setSelectedGroup(group);
                        setPage(0);
                      }}
                      sx={{
                        px: 1.25,
                        py: 0.75,
                        borderRadius: 1,
                        cursor: 'pointer',
                        fontSize: 13,
                        fontWeight: selected ? 600 : 400,
                        bgcolor: selected ? tokens.bgActiveNav : 'transparent',
                        color: selected ? 'primary.main' : 'text.secondary',
                        '&:hover': { bgcolor: tokens.bgHover },
                      }}
                    >
                      {group}
                    </Box>
                  );
                })}
              </Stack>
            </CardContent>
          </Card>

          {/* Right Rules Table */}
          <Card sx={{ flex: 1, minWidth: 0 }}>
            <Box
              sx={{
                p: 1.5,
                borderBottom: `1px solid ${tokens.borderSubtle}`,
                display: 'flex',
                flexWrap: 'wrap',
                gap: 1.25,
                alignItems: 'center',
              }}
            >
              <IconButton
                size="small"
                onClick={() => void refetchRules()}
                disabled={fetchingRules}
                sx={{ border: `1px solid ${tokens.borderSubtle}`, borderRadius: 1 }}
              >
                <Refresh fontSize="small" />
              </IconButton>

              <FormControl size="small" sx={{ minWidth: 150 }}>
                <Select
                  value={datasourceFilter}
                  onChange={(e) => {
                    setDatasourceFilter(e.target.value);
                    setPage(0);
                  }}
                >
                  <MenuItem value="ALL">All data sources</MenuItem>
                  <MenuItem value="VictoriaMetrics">VictoriaMetrics</MenuItem>
                  <MenuItem value="VictoriaLogs">VictoriaLogs</MenuItem>
                </Select>
              </FormControl>

              <FormControl size="small" sx={{ minWidth: 130 }}>
                <Select
                  value={severityFilter}
                  onChange={(e) => {
                    setSeverityFilter(e.target.value);
                    setPage(0);
                  }}
                >
                  <MenuItem value="ALL">All severities</MenuItem>
                  <MenuItem value="critical">Critical</MenuItem>
                  <MenuItem value="warning">Warning</MenuItem>
                </Select>
              </FormControl>

              <TextField
                size="small"
                placeholder="Name, tags or query..."
                value={searchText}
                onChange={(e) => {
                  setSearchText(e.target.value);
                  setPage(0);
                }}
                sx={{ minWidth: 240, flex: 1, '& .MuiInputBase-input': { fontSize: 13, py: 0.75 } }}
              />
            </Box>

            {rulesError && (
              <Box sx={{ p: 2 }}>
                <Alert severity="error">Failed to evaluate live alert rules: {rulesError.message}</Alert>
              </Box>
            )}

            {loadingRules ? (
              <Stack alignItems="center" justifyContent="center" sx={{ py: 8 }}>
                <CircularProgress size={28} />
              </Stack>
            ) : (
              <>
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell width={64}>Status</TableCell>
                        <TableCell>Name</TableCell>
                        <TableCell>Live reading</TableCell>
                        <TableCell>Datasource</TableCell>
                        <TableCell>Evaluated</TableCell>
                        <TableCell>Updated by</TableCell>
                        <TableCell>Enable</TableCell>
                        <TableCell align="right">Operations</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {pagedRules.map((rule) => {
                        const enabled = !disabledIds[rule.id];
                        return (
                          <TableRow key={rule.id} hover>
                            <TableCell>
                              {rule.status === 'normal' ? (
                                <CheckCircle fontSize="small" color="success" />
                              ) : (
                                <AlertCircle fontSize="small" color={rule.status === 'firing' ? 'warning' : 'error'} />
                              )}
                            </TableCell>
                            <TableCell>
                              <Typography
                                variant="body2"
                                fontWeight={500}
                                color="primary.main"
                                sx={{ cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}
                                onClick={() => setSelectedRule(rule)}
                              >
                                {rule.name}
                              </Typography>
                              <Typography variant="caption" color="text.secondary">
                                {rule.group} · Threshold: {rule.thresholdLabel}
                              </Typography>
                            </TableCell>
                            <TableCell>
                              <Chip
                                size="small"
                                label={rule.measuredValue}
                                color={
                                  rule.status === 'normal' ? 'success' : rule.status === 'firing' ? 'warning' : 'error'
                                }
                                variant="outlined"
                                sx={{ height: 22, fontSize: 11.5 }}
                              />
                            </TableCell>
                            <TableCell>
                              <Chip size="small" label={rule.datasource} sx={{ height: 22, fontSize: 11 }} />
                            </TableCell>
                            <TableCell sx={{ fontFamily: 'monospace', fontSize: 12, color: 'text.secondary' }}>
                              {formatTs(rule.evaluatedAt)}
                            </TableCell>
                            <TableCell>
                              <Typography variant="caption">Admin</Typography>
                            </TableCell>
                            <TableCell>
                              <Switch
                                size="small"
                                color="primary"
                                checked={enabled}
                                onChange={(e) =>
                                  setDisabledIds((prev) => ({ ...prev, [rule.id]: !e.target.checked }))
                                }
                              />
                            </TableCell>
                            <TableCell align="right">
                              <Button size="small" variant="text" onClick={() => setSelectedRule(rule)}>
                                Inspect
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>

                <TablePagination
                  component="div"
                  count={filteredRules.length}
                  page={page}
                  onPageChange={(_, p) => setPage(p)}
                  rowsPerPage={rowsPerPage}
                  onRowsPerPageChange={(e) => {
                    setRowsPerPage(parseInt(e.target.value, 10));
                    setPage(0);
                  }}
                  rowsPerPageOptions={[10, 25]}
                />
              </>
            )}
          </Card>
        </Box>
      ) : (
        <Card>
          <Box
            sx={{
              p: 1.5,
              borderBottom: `1px solid ${tokens.borderSubtle}`,
              display: 'flex',
              gap: 1.25,
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <Stack direction="row" spacing={1} alignItems="center" sx={{ flex: 1 }}>
              <IconButton
                size="small"
                onClick={() => void refetchEvents()}
                disabled={fetchingEvents}
                sx={{ border: `1px solid ${tokens.borderSubtle}`, borderRadius: 1 }}
              >
                <Refresh fontSize="small" />
              </IconButton>
              <TextField
                size="small"
                placeholder="Filter Kubernetes events (pod, reason, message)..."
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                sx={{ width: { xs: '100%', sm: 360 }, '& .MuiInputBase-input': { fontSize: 13, py: 0.75 } }}
              />
            </Stack>
            <Chip size="small" variant="outlined" color="primary" label={`k8s_events (6h): ${events.length}`} />
          </Box>

          {eventsError && (
            <Box sx={{ p: 2 }}>
              <Alert severity="error">Failed to load k8s_events from VictoriaLogs: {eventsError.message}</Alert>
            </Box>
          )}

          {loadingEvents ? (
            <Stack alignItems="center" justifyContent="center" sx={{ py: 8 }}>
              <CircularProgress size={28} />
            </Stack>
          ) : (
            <TableContainer sx={{ maxHeight: 600 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell width={170}>Time</TableCell>
                    <TableCell width={100}>Severity</TableCell>
                    <TableCell width={160}>Namespace / Object</TableCell>
                    <TableCell>Message</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {events.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} align="center" sx={{ py: 4 }}>
                        <Typography variant="body2" color="text.secondary">
                          No Kubernetes events matched in VictoriaLogs for the last 6 hours.
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ) : (
                    events.map((ev, idx) => {
                      const isWarn =
                        String(ev.type || ev._msg || '')
                          .toLowerCase()
                          .includes('warn') || String(ev._msg || '').toLowerCase().includes('error');
                      return (
                        <TableRow key={`${ev._time}-${idx}`} hover>
                          <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                            {formatTs(ev._time)}
                          </TableCell>
                          <TableCell>
                            <Chip
                              size="small"
                              label={ev.type || (isWarn ? 'Warning' : 'Normal')}
                              color={isWarn ? 'warning' : 'success'}
                              variant="outlined"
                              sx={{ height: 22, fontSize: 11 }}
                            />
                          </TableCell>
                          <TableCell sx={{ fontFamily: 'monospace', fontSize: 11.5 }}>
                            {[ev['involvedObject.namespace'] || ev['kubernetes.pod_namespace'], ev['involvedObject.name']]
                              .filter(Boolean)
                              .join(' / ') || ev._stream}
                          </TableCell>
                          <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{ev._msg}</TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Card>
      )}

      <Dialog open={Boolean(selectedRule)} onClose={() => setSelectedRule(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{selectedRule?.name}</DialogTitle>
        <DialogContent dividers>
          {selectedRule && (
            <Stack spacing={1.5}>
              <Typography variant="body2">
                <strong>Group:</strong> {selectedRule.group}
              </Typography>
              <Typography variant="body2">
                <strong>Datasource:</strong> {selectedRule.datasource}
              </Typography>
              <Typography variant="body2">
                <strong>Measured Value:</strong> {selectedRule.measuredValue} (Threshold: {selectedRule.thresholdLabel})
              </Typography>
              <Typography variant="body2">
                <strong>Detail:</strong> {selectedRule.detail}
              </Typography>
              <Box
                component="pre"
                sx={{
                  p: 1.5,
                  borderRadius: 1,
                  bgcolor: tokens.bgSubtle,
                  fontFamily: 'monospace',
                  fontSize: 12,
                  overflowX: 'auto',
                }}
              >
                {selectedRule.query}
              </Box>
            </Stack>
          )}
        </DialogContent>
      </Dialog>
    </Stack>
  );
}

