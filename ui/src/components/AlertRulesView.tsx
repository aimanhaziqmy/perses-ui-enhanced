import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  ListSubheader,
  Menu,
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
  Tooltip,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import AlertCircle from 'mdi-material-ui/AlertCircle';
import CheckCircle from 'mdi-material-ui/CheckCircle';
import DeleteOutline from 'mdi-material-ui/DeleteOutline';
import Download from 'mdi-material-ui/Download';
import MinusCircleOutline from 'mdi-material-ui/MinusCircleOutline';
import PencilOutline from 'mdi-material-ui/PencilOutline';
import Plus from 'mdi-material-ui/Plus';
import Refresh from 'mdi-material-ui/Refresh';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import type {
  AlertRuleConditionOp,
  AlertRuleDefinition,
  LiveAlertRuleEvaluation,
  VictoriaLogsQueryResult,
} from '../api/persesClient';
import {
  DEFAULT_ALERT_RULES,
  ForbiddenError,
  datasourceTargetKey,
  evaluateLiveAlertRules,
  fetchAlertRulesConfig,
  getCurrentPersesUsername,
  queryVictoriaLogs,
  saveAlertRulesConfig,
  useDatasourceTargets,
} from '../api/persesClient';
import { PALETTE_TOKENS } from '../theme/persesTheme';
import type { ExportFormat } from '../utils/exportRecords';
import { exportRecordsToFile } from '../utils/exportRecords';
import { JsonViewer } from './JsonViewer';

const SUGGESTED_GROUPS = ['Core Infrastructure', 'GPU & AI Compute', 'Workloads', 'Storage', 'Observability', 'Custom'];

function formatTs(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

interface RuleFormState {
  mode: 'create' | 'edit';
  id: string;
  name: string;
  group: string;
  datasourceType: 'prometheus' | 'victorialogs';
  datasourceName: string;
  query: string;
  conditionOp: AlertRuleConditionOp;
  threshold: string;
  thresholdLabel: string;
  severity: 'critical' | 'warning' | 'info';
  lookbackMinutes: string;
  enabled: boolean;
}

const DEFAULT_FORM: RuleFormState = {
  mode: 'create',
  id: '',
  name: '',
  group: 'Core Infrastructure',
  datasourceType: 'prometheus',
  datasourceName: '',
  query: '',
  conditionOp: '>',
  threshold: '80',
  thresholdLabel: '> 80',
  severity: 'warning',
  lookbackMinutes: '15',
  enabled: true,
};

export function AlertRulesView({ defaultSubTab = 'rules' }: { defaultSubTab?: 'rules' | 'events' }) {
  const muiTheme = useTheme();
  const mode = muiTheme.palette.mode;
  const tokens = PALETTE_TOKENS[mode];
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [subTab, setSubTab] = useState<'rules' | 'events'>(defaultSubTab);
  useEffect(() => {
    setSubTab(defaultSubTab);
  }, [defaultSubTab]);
  const [selectedGroup, setSelectedGroup] = useState<string>('All');
  const [groupFilterText, setGroupFilterText] = useState<string>('');
  const [datasourceFilter, setDatasourceFilter] = useState<string>('ALL');
  const [severityFilter, setSeverityFilter] = useState<string>('ALL');
  const [searchText, setSearchText] = useState<string>('');
  const [selectedRule, setSelectedRule] = useState<LiveAlertRuleEvaluation | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<RuleFormState>(DEFAULT_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AlertRuleDefinition | null>(null);
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [page, setPage] = useState<number>(0);
  const [rowsPerPage, setRowsPerPage] = useState<number>(10);

  const [eventsQuery, setEventsQuery] = useState<string>('stream:="k8s_events"');
  const [selectedVlKey, setSelectedVlKey] = useState<string>('');
  const [eventsExportAnchorEl, setEventsExportAnchorEl] = useState<HTMLElement | null>(null);
  const [exportingEvents, setExportingEvents] = useState(false);

  const { targets: allTargets, isLoading: loadingTargets } = useDatasourceTargets();
  const promTargets = useMemo(() => allTargets.filter((t) => t.pluginKind === 'PrometheusDatasource'), [allTargets]);
  const vlTargets = useMemo(() => allTargets.filter((t) => t.pluginKind === 'VictoriaLogsDatasource'), [allTargets]);

  useEffect(() => {
    if (vlTargets.length === 0) {
      setSelectedVlKey('');
      return;
    }
    if (!selectedVlKey || !vlTargets.some((t) => datasourceTargetKey(t) === selectedVlKey)) {
      const def = vlTargets.find((t) => t.isDefault) ?? vlTargets[0];
      setSelectedVlKey(datasourceTargetKey(def));
    }
  }, [vlTargets, selectedVlKey]);

  const activeVlTarget = useMemo(
    () => vlTargets.find((t) => datasourceTargetKey(t) === selectedVlKey) ?? vlTargets[0] ?? null,
    [vlTargets, selectedVlKey],
  );

  const { data: rulesConfig = DEFAULT_ALERT_RULES, isLoading: loadingConfig } = useQuery<AlertRuleDefinition[], Error>({
    queryKey: ['perses', 'alert-rules-config'],
    queryFn: fetchAlertRulesConfig,
  });

  const {
    data: evaluatedRules = [],
    isInitialLoading: loadingEval,
    isFetching: fetchingRules,
    error: rulesError,
    refetch: refetchRules,
  } = useQuery<LiveAlertRuleEvaluation[], Error>({
    queryKey: [
      'live-alert-rules',
      JSON.stringify(rulesConfig),
      allTargets.map((t) => `${t.scope}:${t.project ?? ''}:${t.name}`).join(','),
    ],
    queryFn: () => evaluateLiveAlertRules(rulesConfig, allTargets),
    refetchInterval: 30000,
    enabled: subTab === 'rules' && !loadingConfig && !loadingTargets,
  });

  const {
    data: eventsResult,
    isInitialLoading: loadingEvents,
    isFetching: fetchingEvents,
    error: eventsError,
    refetch: refetchEvents,
  } = useQuery<VictoriaLogsQueryResult, Error>({
    queryKey: ['vlogs', 'k8s-events-tab', selectedVlKey, eventsQuery],
    queryFn: () => {
      const startIso = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
      const endIso = new Date().toISOString();
      return queryVictoriaLogs(eventsQuery, 150, startIso, endIso, activeVlTarget!);
    },
    refetchInterval: 30000,
    enabled: subTab === 'events' && Boolean(activeVlTarget),
  });

  const persistRules = async (nextRules: AlertRuleDefinition[], successMsg: string) => {
    setFeedback(null);
    const saved = await saveAlertRulesConfig(nextRules);
    await queryClient.setQueryData(['perses', 'alert-rules-config'], saved);
    setFeedback({ kind: 'success', text: successMsg });
  };

  const handleToggleRule = async (rule: AlertRuleDefinition, enabled: boolean) => {
    const username = getCurrentPersesUsername();
    const next = rulesConfig.map((r) =>
      r.id === rule.id
        ? { ...r, enabled, updatedBy: username, updatedAt: new Date().toISOString() }
        : r,
    );
    try {
      await persistRules(next, `Rule "${rule.name}" ${enabled ? 'enabled' : 'disabled'}.`);
    } catch (err) {
      setFeedback({
        kind: 'error',
        text: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const openCreateRule = () => {
    setFormError(null);
    setForm(DEFAULT_FORM);
    setFormOpen(true);
  };

  const openEditRule = (rule: AlertRuleDefinition) => {
    setFormError(null);
    setForm({
      mode: 'edit',
      id: rule.id,
      name: rule.name,
      group: rule.group,
      datasourceType: rule.datasourceType,
      datasourceName: rule.datasourceName ?? '',
      query: rule.query,
      conditionOp: rule.conditionOp,
      threshold: String(rule.threshold),
      thresholdLabel: rule.thresholdLabel,
      severity: rule.severity,
      lookbackMinutes: String(rule.lookbackMinutes ?? 15),
      enabled: rule.enabled,
    });
    setFormOpen(true);
  };

  const handleSaveRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setFormError('Rule name is required.');
      return;
    }
    if (!form.query.trim()) {
      setFormError('Query expression is required.');
      return;
    }
    const thresholdNum = Number(form.threshold);
    if (!['nonempty', 'empty'].includes(form.conditionOp) && !Number.isFinite(thresholdNum)) {
      setFormError('Threshold must be a valid number.');
      return;
    }

    setSaving(true);
    setFormError(null);
    const username = getCurrentPersesUsername();
    const ruleId =
      form.mode === 'edit'
        ? form.id
        : form.name
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '') || `rule-${Date.now()}`;

    const uniqueId =
      form.mode === 'create' && rulesConfig.some((r) => r.id === ruleId)
        ? `${ruleId}-${Date.now().toString(36)}`
        : ruleId;

    const newRule: AlertRuleDefinition = {
      id: uniqueId,
      name: form.name.trim(),
      group: form.group.trim() || 'General',
      datasourceType: form.datasourceType,
      datasourceName: form.datasourceName.trim() || undefined,
      query: form.query.trim(),
      conditionOp: form.conditionOp,
      threshold: Number.isFinite(thresholdNum) ? thresholdNum : 0,
      thresholdLabel:
        form.thresholdLabel.trim() ||
        (form.conditionOp === 'nonempty'
          ? 'non-empty'
          : form.conditionOp === 'empty'
            ? 'empty'
            : `${form.conditionOp} ${thresholdNum}`),
      severity: form.severity,
      enabled: form.enabled,
      lookbackMinutes: Math.max(1, Number(form.lookbackMinutes) || 15),
      updatedBy: username,
      updatedAt: new Date().toISOString(),
    };

    try {
      const next =
        form.mode === 'create'
          ? [...rulesConfig, newRule]
          : rulesConfig.map((r) => (r.id === form.id ? newRule : r));
      await persistRules(next, `${form.mode === 'create' ? 'Created' : 'Updated'} rule "${newRule.name}".`);
      setFormOpen(false);
    } catch (err) {
      setFormError(
        err instanceof ForbiddenError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err),
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteRule = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      const next = rulesConfig.filter((r) => r.id !== deleteTarget.id);
      await persistRules(next, `Deleted rule "${deleteTarget.name}".`);
      setDeleteTarget(null);
    } catch (err) {
      setFeedback({
        kind: 'error',
        text: err instanceof Error ? err.message : String(err),
      });
      setDeleteTarget(null);
    } finally {
      setSaving(false);
    }
  };

  const ruleGroups = useMemo(() => {
    const set = new Set<string>();
    for (const r of rulesConfig) {
      if (r.group) set.add(r.group);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [rulesConfig]);

  const filteredRules = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return evaluatedRules.filter((r) => {
      if (selectedGroup !== 'All' && r.group !== selectedGroup) return false;
      if (datasourceFilter !== 'ALL' && r.datasourceType !== datasourceFilter) return false;
      if (severityFilter !== 'ALL' && r.severity !== severityFilter) return false;
      if (!q) return true;
      return `${r.name} ${r.query} ${r.group} ${r.detail} ${r.resolvedDatasource}`.toLowerCase().includes(q);
    });
  }, [evaluatedRules, selectedGroup, datasourceFilter, severityFilter, searchText]);

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

  const handleExportEvents = async (format: ExportFormat, scope: 'loaded' | 'full') => {
    setEventsExportAnchorEl(null);
    if (!activeVlTarget) return;
    setExportingEvents(true);
    try {
      let records = events;
      if (scope === 'full') {
        const startIso = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
        const endIso = new Date().toISOString();
        const res = await queryVictoriaLogs(eventsQuery, 5000, startIso, endIso, activeVlTarget);
        const q = searchText.trim().toLowerCase();
        records = q
          ? res.entries.filter((e) => JSON.stringify(e).toLowerCase().includes(q))
          : res.entries;
      }
      const count = exportRecordsToFile(records as Record<string, unknown>[], format, 'cluster-events-export');
      setFeedback({
        kind: 'success',
        text: `Exported ${count.toLocaleString()} cluster event${count === 1 ? '' : 's'} as ${format.toUpperCase()}.`,
      });
    } catch (err) {
      setFeedback({
        kind: 'error',
        text: `Events export failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setExportingEvents(false);
    }
  };

  const targetOptionsForForm = form.datasourceType === 'prometheus' ? promTargets : vlTargets;

  return (
    <Stack spacing={1.5}>
      {feedback && (
        <Alert severity={feedback.kind} onClose={() => setFeedback(null)}>
          {feedback.text}
        </Alert>
      )}

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
            <Tab value="rules" label={`Alert rules (${rulesConfig.length})`} />
            <Tab value="events" label="Cluster Events (Logs)" />
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
                All ({rulesConfig.length})
              </Box>

              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
                Rule groups
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
                {ruleGroups
                  .filter((g) => g.toLowerCase().includes(groupFilterText.trim().toLowerCase()))
                  .map((group) => {
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

              <FormControl size="small" sx={{ minWidth: 160 }}>
                <Select
                  value={datasourceFilter}
                  onChange={(e) => {
                    setDatasourceFilter(e.target.value);
                    setPage(0);
                  }}
                >
                  <MenuItem value="ALL">All engine types</MenuItem>
                  <MenuItem value="prometheus">Prometheus / Metrics</MenuItem>
                  <MenuItem value="victorialogs">VictoriaLogs / Logs</MenuItem>
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
                  <MenuItem value="info">Info</MenuItem>
                </Select>
              </FormControl>

              <TextField
                size="small"
                placeholder="Name, group or query..."
                value={searchText}
                onChange={(e) => {
                  setSearchText(e.target.value);
                  setPage(0);
                }}
                sx={{ minWidth: 200, flex: 1, '& .MuiInputBase-input': { fontSize: 13, py: 0.75 } }}
              />

              <Button size="small" variant="contained" startIcon={<Plus />} onClick={openCreateRule}>
                Add rule
              </Button>
            </Box>

            {allTargets.length === 0 && !loadingTargets && (
              <Box sx={{ p: 2 }}>
                <Alert
                  severity="info"
                  action={
                    <Button size="small" color="inherit" onClick={() => navigate('/datasources')}>
                      Add data source
                    </Button>
                  }
                >
                  No metrics or log data sources are configured yet. Rules will evaluate once a data source is added.
                </Alert>
              </Box>
            )}

            {rulesError && (
              <Box sx={{ p: 2 }}>
                <Alert severity="error">Failed to evaluate live alert rules: {rulesError.message}</Alert>
              </Box>
            )}

            {loadingConfig || loadingEval ? (
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
                        <TableCell align="right" width={150}>
                          Operations
                        </TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {pagedRules.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={8} align="center" sx={{ py: 5 }}>
                            <Typography variant="body2" color="text.secondary">
                              No alert rules match your filter. Click &ldquo;Add rule&rdquo; to create one.
                            </Typography>
                          </TableCell>
                        </TableRow>
                      ) : (
                        pagedRules.map((rule) => (
                          <TableRow key={rule.id} hover sx={{ opacity: rule.enabled ? 1 : 0.7 }}>
                            <TableCell>
                              {rule.status === 'disabled' ? (
                                <MinusCircleOutline fontSize="small" color="disabled" />
                              ) : rule.status === 'normal' ? (
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
                                {rule.group} · {rule.severity} · Threshold: {rule.thresholdLabel}
                              </Typography>
                            </TableCell>
                            <TableCell>
                              <Chip
                                size="small"
                                label={rule.measuredValue}
                                color={
                                  rule.status === 'disabled'
                                    ? 'default'
                                    : rule.status === 'normal'
                                      ? 'success'
                                      : rule.status === 'firing'
                                        ? 'warning'
                                        : 'error'
                                }
                                variant="outlined"
                                sx={{ height: 22, fontSize: 11.5 }}
                              />
                            </TableCell>
                            <TableCell>
                              <Chip
                                size="small"
                                label={rule.resolvedDatasource}
                                variant="outlined"
                                sx={{ height: 22, fontSize: 11 }}
                              />
                            </TableCell>
                            <TableCell sx={{ fontFamily: 'monospace', fontSize: 12, color: 'text.secondary' }}>
                              {formatTs(rule.evaluatedAt)}
                            </TableCell>
                            <TableCell>
                              <Typography variant="caption">{rule.updatedBy}</Typography>
                            </TableCell>
                            <TableCell>
                              <Switch
                                size="small"
                                color="primary"
                                checked={rule.enabled}
                                onChange={(e) => void handleToggleRule(rule.rule, e.target.checked)}
                              />
                            </TableCell>
                            <TableCell align="right">
                              <Stack direction="row" spacing={0.25} justifyContent="flex-end">
                                <Button
                                  size="small"
                                  variant="text"
                                  onClick={() => setSelectedRule(rule)}
                                  sx={{ minWidth: 0, px: 1, fontSize: 12 }}
                                >
                                  Inspect
                                </Button>
                                <Tooltip title="Edit rule">
                                  <IconButton size="small" onClick={() => openEditRule(rule.rule)}>
                                    <PencilOutline fontSize="small" />
                                  </IconButton>
                                </Tooltip>
                                <Tooltip title="Delete rule">
                                  <IconButton
                                    size="small"
                                    color="error"
                                    onClick={() => setDeleteTarget(rule.rule)}
                                  >
                                    <DeleteOutline fontSize="small" />
                                  </IconButton>
                                </Tooltip>
                              </Stack>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
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
              flexWrap: 'wrap',
              gap: 1.25,
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" sx={{ flex: 1 }}>
              <IconButton
                size="small"
                onClick={() => void refetchEvents()}
                disabled={fetchingEvents || !activeVlTarget}
                sx={{ border: `1px solid ${tokens.borderSubtle}`, borderRadius: 1 }}
              >
                <Refresh fontSize="small" />
              </IconButton>

              {vlTargets.length > 0 && (
                <FormControl size="small" sx={{ minWidth: 180 }}>
                  <Select value={selectedVlKey} onChange={(e) => setSelectedVlKey(e.target.value)}>
                    {vlTargets.map((t) => (
                      <MenuItem key={datasourceTargetKey(t)} value={datasourceTargetKey(t)}>
                        {t.displayName} ({t.scope === 'global' ? 'Global' : t.project})
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}

              <TextField
                size="small"
                label="Event LogsQL query"
                value={eventsQuery}
                onChange={(e) => setEventsQuery(e.target.value)}
                sx={{ width: { xs: '100%', sm: 240 }, '& .MuiInputBase-input': { fontFamily: 'monospace', fontSize: 12.5 } }}
              />

              <TextField
                size="small"
                placeholder="Filter results (pod, reason, message)..."
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                sx={{ width: { xs: '100%', sm: 260 }, '& .MuiInputBase-input': { fontSize: 13, py: 0.75 } }}
              />
            </Stack>
            <Stack direction="row" spacing={1} alignItems="center">
              <Chip size="small" variant="outlined" color="primary" label={`Events (6h): ${events.length}`} />
              <Button
                size="small"
                variant="outlined"
                startIcon={exportingEvents ? <CircularProgress size={14} color="inherit" /> : <Download fontSize="small" />}
                disabled={exportingEvents || !activeVlTarget}
                onClick={(e) => setEventsExportAnchorEl(e.currentTarget)}
              >
                {exportingEvents ? 'Exporting...' : 'Export'}
              </Button>
              <Menu
                anchorEl={eventsExportAnchorEl}
                open={Boolean(eventsExportAnchorEl)}
                onClose={() => setEventsExportAnchorEl(null)}
              >
                <ListSubheader sx={{ lineHeight: '28px', fontSize: 11 }}>
                  Current results ({events.length} rows)
                </ListSubheader>
                <MenuItem disabled={events.length === 0} onClick={() => void handleExportEvents('csv', 'loaded')}>
                  Export current as CSV
                </MenuItem>
                <MenuItem disabled={events.length === 0} onClick={() => void handleExportEvents('json', 'loaded')}>
                  Export current as JSON
                </MenuItem>
                <MenuItem disabled={events.length === 0} onClick={() => void handleExportEvents('jsonl', 'loaded')}>
                  Export current as JSONL (NDJSON)
                </MenuItem>
                <ListSubheader sx={{ lineHeight: '28px', fontSize: 11 }}>
                  Full 6h range (up to 5,000 events)
                </ListSubheader>
                <MenuItem onClick={() => void handleExportEvents('csv', 'full')}>
                  Export 6h range as CSV
                </MenuItem>
                <MenuItem onClick={() => void handleExportEvents('json', 'full')}>
                  Export 6h range as JSON
                </MenuItem>
                <MenuItem onClick={() => void handleExportEvents('jsonl', 'full')}>
                  Export 6h range as JSONL (NDJSON)
                </MenuItem>
              </Menu>
            </Stack>
          </Box>

          {vlTargets.length === 0 && !loadingTargets ? (
            <Box sx={{ p: 4, textAlign: 'center' }}>
              <Alert
                severity="info"
                action={
                  <Button size="small" color="inherit" onClick={() => navigate('/datasources')}>
                    Add data source
                  </Button>
                }
              >
                No VictoriaLogs data source is configured. Add one in Integrations → Data sources to inspect cluster
                events.
              </Alert>
            </Box>
          ) : (
            <>
              {eventsError && (
                <Box sx={{ p: 2 }}>
                  <Alert severity="error">Failed to load events: {eventsError.message}</Alert>
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
                              No events matched <code>{eventsQuery}</code> in the last 6 hours.
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
                                {[
                                  ev['involvedObject.namespace'] || ev['kubernetes.pod_namespace'],
                                  ev['involvedObject.name'],
                                ]
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
            </>
          )}
        </Card>
      )}

      {/* Create / Edit Rule Dialog */}
      <Dialog open={formOpen} onClose={() => setFormOpen(false)} maxWidth="sm" fullWidth>
        <Box component="form" onSubmit={handleSaveRule}>
          <DialogTitle>{form.mode === 'create' ? 'Create Alert Rule' : `Edit Alert Rule: ${form.name}`}</DialogTitle>
          <DialogContent dividers>
            <Stack spacing={2}>
              {formError && <Alert severity="error">{formError}</Alert>}

              <TextField
                label="Rule Name"
                placeholder="e.g. High CPU Load > 90%"
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                required
                fullWidth
                size="small"
              />

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  label="Group"
                  value={form.group}
                  onChange={(e) => setForm((prev) => ({ ...prev, group: e.target.value }))}
                  fullWidth
                  size="small"
                  helperText={`Suggested: ${SUGGESTED_GROUPS.slice(0, 4).join(', ')}`}
                />

                <FormControl size="small" fullWidth>
                  <InputLabel>Severity</InputLabel>
                  <Select
                    label="Severity"
                    value={form.severity}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, severity: e.target.value as RuleFormState['severity'] }))
                    }
                  >
                    <MenuItem value="critical">Critical</MenuItem>
                    <MenuItem value="warning">Warning</MenuItem>
                    <MenuItem value="info">Info</MenuItem>
                  </Select>
                </FormControl>
              </Stack>

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <FormControl size="small" fullWidth>
                  <InputLabel>Query Engine</InputLabel>
                  <Select
                    label="Query Engine"
                    value={form.datasourceType}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        datasourceType: e.target.value as 'prometheus' | 'victorialogs',
                        datasourceName: '',
                      }))
                    }
                  >
                    <MenuItem value="prometheus">Prometheus / Metrics (PromQL)</MenuItem>
                    <MenuItem value="victorialogs">VictoriaLogs (LogsQL)</MenuItem>
                  </Select>
                </FormControl>

                <FormControl size="small" fullWidth>
                  <InputLabel>Target Datasource</InputLabel>
                  <Select
                    label="Target Datasource"
                    value={form.datasourceName}
                    onChange={(e) => setForm((prev) => ({ ...prev, datasourceName: e.target.value }))}
                  >
                    <MenuItem value="">Auto (Default datasource)</MenuItem>
                    {targetOptionsForForm.map((t) => (
                      <MenuItem key={datasourceTargetKey(t)} value={t.name}>
                        {t.name} ({t.scope === 'global' ? 'Global' : t.project})
                      </MenuItem>
                    ))}
                    {form.datasourceName &&
                      !targetOptionsForForm.some(
                        (t) => t.name === form.datasourceName || datasourceTargetKey(t) === form.datasourceName,
                      ) && (
                        <MenuItem value={form.datasourceName}>{form.datasourceName} (missing)</MenuItem>
                      )}
                  </Select>
                </FormControl>
              </Stack>

              <TextField
                label={form.datasourceType === 'prometheus' ? 'PromQL Query' : 'LogsQL Query'}
                placeholder={
                  form.datasourceType === 'prometheus'
                    ? 'e.g. 100 - (avg by (node) (rate(node_cpu_seconds_total{mode="idle"}[2m])) * 100)'
                    : 'e.g. level:="error" OR OOMKilled'
                }
                value={form.query}
                onChange={(e) => setForm((prev) => ({ ...prev, query: e.target.value }))}
                required
                fullWidth
                multiline
                minRows={2}
                size="small"
                InputProps={{ sx: { fontFamily: 'monospace', fontSize: 12.5 } }}
              />

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <FormControl size="small" fullWidth>
                  <InputLabel>Fire Condition</InputLabel>
                  <Select
                    label="Fire Condition"
                    value={form.conditionOp}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, conditionOp: e.target.value as AlertRuleConditionOp }))
                    }
                  >
                    <MenuItem value=">">Value &gt; Threshold</MenuItem>
                    <MenuItem value=">=">Value &gt;= Threshold</MenuItem>
                    <MenuItem value="<">Value &lt; Threshold</MenuItem>
                    <MenuItem value="<=">Value &lt;= Threshold</MenuItem>
                    <MenuItem value="==">Value == Threshold</MenuItem>
                    <MenuItem value="!=">Value != Threshold</MenuItem>
                    <MenuItem value="nonempty">Result non-empty (&gt; 0 series/logs)</MenuItem>
                    <MenuItem value="empty">Result empty (0 series/logs)</MenuItem>
                  </Select>
                </FormControl>

                {!['nonempty', 'empty'].includes(form.conditionOp) && (
                  <TextField
                    label="Threshold Value"
                    type="number"
                    value={form.threshold}
                    onChange={(e) => setForm((prev) => ({ ...prev, threshold: e.target.value }))}
                    fullWidth
                    size="small"
                  />
                )}
              </Stack>

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  label="Display Threshold Label (optional)"
                  placeholder="e.g. < 85% or == 0"
                  value={form.thresholdLabel}
                  onChange={(e) => setForm((prev) => ({ ...prev, thresholdLabel: e.target.value }))}
                  fullWidth
                  size="small"
                />

                {form.datasourceType === 'victorialogs' && (
                  <TextField
                    label="Lookback Window (minutes)"
                    type="number"
                    value={form.lookbackMinutes}
                    onChange={(e) => setForm((prev) => ({ ...prev, lookbackMinutes: e.target.value }))}
                    fullWidth
                    size="small"
                  />
                )}
              </Stack>

              <FormControlLabel
                control={
                  <Switch
                    checked={form.enabled}
                    onChange={(e) => setForm((prev) => ({ ...prev, enabled: e.target.checked }))}
                  />
                }
                label="Enable live rule evaluation"
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setFormOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" variant="contained" disabled={saving}>
              {saving ? 'Saving...' : form.mode === 'create' ? 'Create Rule' : 'Save Changes'}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>

      {/* Delete Rule Confirmation Dialog */}
      <Dialog open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete Alert Rule</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2">
            Are you sure you want to delete alert rule <strong>{deleteTarget?.name}</strong>?
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)} disabled={saving}>
            Cancel
          </Button>
          <Button color="error" variant="contained" onClick={handleDeleteRule} disabled={saving}>
            {saving ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Inspect Evaluation Dialog */}
      <Dialog open={Boolean(selectedRule)} onClose={() => setSelectedRule(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{selectedRule?.name}</DialogTitle>
        <DialogContent dividers>
          {selectedRule && (
            <Stack spacing={1.5}>
              <Typography variant="body2">
                <strong>Group:</strong> {selectedRule.group}
              </Typography>
              <Typography variant="body2">
                <strong>Datasource:</strong> {selectedRule.resolvedDatasource} ({selectedRule.datasourceType})
              </Typography>
              <Typography variant="body2">
                <strong>Measured Value:</strong> {selectedRule.measuredValue} (Threshold: {selectedRule.thresholdLabel})
              </Typography>
              <Typography variant="body2">
                <strong>Detail:</strong> {selectedRule.detail}
              </Typography>
              <JsonViewer value={selectedRule.query} title="Query Expression" maxHeight={140} />
              <JsonViewer value={selectedRule} title="Rule & Evaluation Snapshot" maxHeight={280} />
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSelectedRule(null)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
