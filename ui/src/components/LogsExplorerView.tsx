import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Drawer,
  FormControl,
  FormControlLabel,
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
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import DeleteOutline from 'mdi-material-ui/DeleteOutline';
import PencilOutline from 'mdi-material-ui/PencilOutline';
import Plus from 'mdi-material-ui/Plus';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import type {
  LogLevel,
  LogPresetItem,
  VictoriaLogEntry,
  VictoriaLogHitBucket,
  VictoriaLogsQueryResult,
} from '../api/persesClient';
import {
  ALL_LOG_LEVELS,
  DEFAULT_LOG_PRESETS,
  ForbiddenError,
  buildLogsQLLevelFilter,
  classifyLogLevel,
  datasourceTargetKey,
  fetchLogPresetsConfig,
  injectLogsQLFilter,
  queryVictoriaLogs,
  queryVictoriaLogsLevelHistogram,
  saveLogPresetsConfig,
  setLocalLogPresets,
  useDatasourceTargets,
} from '../api/persesClient';
import { PALETTE_TOKENS } from '../theme/persesTheme';
import { VictoriaLogsBrandIcon } from './BrandIcons';

interface QueryTabState {
  id: string;
  label: string;
  query: string;
  rangeMinutes: number;
  selectedLevels: LogLevel[];
  customStartIso?: string;
  customEndIso?: string;
}

const TIME_RANGES = [
  { label: 'Last 15 minutes', minutes: 15 },
  { label: 'Last 1 hour', minutes: 60 },
  { label: 'Last 6 hours', minutes: 360 },
  { label: 'Last 24 hours', minutes: 1440 },
];

const LEVEL_META: Record<LogLevel, { label: string; short: string; color: string }> = {
  error: { label: 'Error', short: 'ERR', color: '#EF4444' },
  warning: { label: 'Warning', short: 'WARN', color: '#F59E0B' },
  info: { label: 'Info', short: 'INFO', color: '#3B82F6' },
  debug: { label: 'Debug', short: 'DBG', color: '#8B5CF6' },
  other: { label: 'Other', short: 'OTHER', color: '#64748B' },
};

function formatCompactTs(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${mm}-${dd} ${hh}:${min}:${ss}.${ms}`;
}

function formatFullTs(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  const ms = String(date.getMilliseconds()).padStart(3, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}.${ms}`;
}

function buildFallbackBuckets(entries: VictoriaLogEntry[], startMs: number, endMs: number): VictoriaLogHitBucket[] {
  const bucketCount = 48;
  const span = Math.max(1000, endMs - startMs);
  const stepMs = span / bucketCount;
  const bucketsCounts: Array<Record<LogLevel, number>> = Array.from({ length: bucketCount }, () => ({
    error: 0,
    warning: 0,
    info: 0,
    debug: 0,
    other: 0,
  }));

  for (const entry of entries) {
    const t = new Date(entry._time).getTime();
    if (!Number.isFinite(t)) continue;
    const idx = Math.min(bucketCount - 1, Math.max(0, Math.floor((t - startMs) / stepMs)));
    const lvl = classifyLogLevel(entry);
    bucketsCounts[idx][lvl] += 1;
  }

  return bucketsCounts.map((counts, i) => {
    const d = new Date(startMs + i * stepMs);
    const dEnd = new Date(startMs + (i + 1) * stepMs);
    const count = counts.error + counts.warning + counts.info + counts.debug + counts.other;
    return {
      timestamp: d.toISOString(),
      endTimestamp: dEnd.toISOString(),
      label: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
      count,
      counts,
    };
  });
}

function formatDrawerWidth(size: 'small' | 'medium' | 'large'): number {
  if (size === 'small') return 460;
  if (size === 'large') return 860;
  return 640;
}

function LevelBadge({ level }: { level: LogLevel }) {
  const meta = LEVEL_META[level];
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        px: 0.75,
        py: 0.15,
        borderRadius: 0.75,
        fontSize: 10.5,
        fontWeight: 700,
        fontFamily: 'monospace',
        letterSpacing: '0.03em',
        color: '#FFFFFF',
        bgcolor: meta.color,
        minWidth: 46,
        lineHeight: 1.4,
      }}
    >
      {meta.short}
    </Box>
  );
}

export function LogsExplorerView({ initialQuery = '*' }: { initialQuery?: string }) {
  const muiTheme = useTheme();
  const mode = muiTheme.palette.mode;
  const tokens = PALETTE_TOKENS[mode];
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { targets: vlTargets, isLoading: loadingDatasources } = useDatasourceTargets('VictoriaLogsDatasource');
  const [selectedTargetKey, setSelectedTargetKey] = useState<string>('');

  useEffect(() => {
    if (vlTargets.length === 0) {
      setSelectedTargetKey('');
      return;
    }
    if (!selectedTargetKey || !vlTargets.some((t) => datasourceTargetKey(t) === selectedTargetKey)) {
      const def = vlTargets.find((t) => t.isDefault) ?? vlTargets[0];
      setSelectedTargetKey(datasourceTargetKey(def));
    }
  }, [vlTargets, selectedTargetKey]);

  const activeTarget = useMemo(
    () => vlTargets.find((t) => datasourceTargetKey(t) === selectedTargetKey) ?? vlTargets[0] ?? null,
    [vlTargets, selectedTargetKey],
  );

  const [tabs, setTabs] = useState<QueryTabState[]>([
    { id: 'q1', label: 'Query 1', query: initialQuery, rangeMinutes: 60, selectedLevels: [] },
  ]);
  const [activeTabId, setActiveTabId] = useState<string>('q1');
  const [executedNonce, setExecutedNonce] = useState<number>(1);
  const [showChart, setShowChart] = useState<boolean>(true);
  const [displayMode, setDisplayMode] = useState<'original' | 'table'>('original');
  const [lineBreak, setLineBreak] = useState<boolean>(false);
  const [showLineNum, setShowLineNum] = useState<boolean>(true);
  const [showLogTime, setShowLogTime] = useState<boolean>(true);
  const [page, setPage] = useState<number>(0);
  const [rowsPerPage, setRowsPerPage] = useState<number>(30);
  const [expandedRows, setExpandedRows] = useState<Record<number, boolean>>({});
  const [selectedLogIndex, setSelectedLogIndex] = useState<number | null>(null);
  const [drawerSize, setDrawerSize] = useState<'small' | 'medium' | 'large'>('medium');
  const [drawerTab, setDrawerTab] = useState<'table' | 'json'>('table');
  const [copiedJson, setCopiedJson] = useState<boolean>(false);

  // Presets dialog state
  const [presetDialogOpen, setPresetDialogOpen] = useState(false);
  const [presetMode, setPresetMode] = useState<'create' | 'edit'>('create');
  const [editingPresetId, setEditingPresetId] = useState<string>('');
  const [presetLabel, setPresetLabel] = useState('');
  const [presetQuery, setPresetQuery] = useState('');
  const [presetDesc, setPresetDesc] = useState('');
  const [presetSaving, setPresetSaving] = useState(false);
  const [presetError, setPresetError] = useState<string | null>(null);
  const [managePresetsOpen, setManagePresetsOpen] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'warning' | 'error'; text: string } | null>(null);

  const { data: presets = DEFAULT_LOG_PRESETS } = useQuery<LogPresetItem[], Error>({
    queryKey: ['perses', 'log-presets-config'],
    queryFn: fetchLogPresetsConfig,
  });

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];

  const updateActiveTab = (patch: Partial<QueryTabState>) => {
    setTabs((prev) => prev.map((t) => (t.id === activeTab.id ? { ...t, ...patch } : t)));
  };

  const addTab = () => {
    const num = tabs.length + 1;
    const id = `q${Date.now()}`;
    setTabs((prev) => [...prev, { id, label: `Query ${num}`, query: '*', rangeMinutes: 60, selectedLevels: [] }]);
    setActiveTabId(id);
    setSelectedLogIndex(null);
    setExpandedRows({});
  };

  const effectiveQuery = useMemo(() => {
    const levelExpr = buildLogsQLLevelFilter(activeTab.selectedLevels);
    return injectLogsQLFilter(activeTab.query, levelExpr);
  }, [activeTab.query, activeTab.selectedLevels]);

  const { startDate, endDate } = useMemo(() => {
    if (activeTab.customStartIso && activeTab.customEndIso) {
      const s = new Date(activeTab.customStartIso);
      const e = new Date(activeTab.customEndIso);
      if (!Number.isNaN(s.getTime()) && !Number.isNaN(e.getTime()) && e.getTime() > s.getTime()) {
        return { startDate: s, endDate: e };
      }
    }
    const end = new Date();
    const start = new Date(end.getTime() - activeTab.rangeMinutes * 60 * 1000);
    return { startDate: start, endDate: end };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab.rangeMinutes, activeTab.customStartIso, activeTab.customEndIso, executedNonce, activeTab.id]);

  const {
    data: logsResult,
    isInitialLoading: loadingLogs,
    isFetching: fetchingLogs,
    error: logsError,
  } = useQuery<VictoriaLogsQueryResult, Error>({
    queryKey: [
      'vlogs',
      'query',
      selectedTargetKey,
      activeTab.id,
      effectiveQuery,
      activeTab.rangeMinutes,
      activeTab.customStartIso ?? '',
      activeTab.customEndIso ?? '',
      executedNonce,
    ],
    queryFn: () =>
      queryVictoriaLogs(effectiveQuery, 300, startDate.toISOString(), endDate.toISOString(), activeTarget!),
    enabled: Boolean(activeTarget),
  });

  const spanSeconds = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 1000));
  const stepSeconds = Math.max(1, Math.round(spanSeconds / 50));

  const { data: histogramData } = useQuery<{ buckets: VictoriaLogHitBucket[]; stacked: boolean }, Error>({
    queryKey: [
      'vlogs',
      'level-histogram',
      selectedTargetKey,
      activeTab.id,
      effectiveQuery,
      activeTab.rangeMinutes,
      activeTab.customStartIso ?? '',
      activeTab.customEndIso ?? '',
      executedNonce,
    ],
    queryFn: () =>
      queryVictoriaLogsLevelHistogram(
        effectiveQuery,
        startDate.toISOString(),
        endDate.toISOString(),
        stepSeconds,
        activeTarget!,
      ),
    enabled: Boolean(activeTarget),
    retry: false,
  });

  const effectiveBuckets = useMemo(() => {
    if (histogramData && histogramData.buckets.length > 0) {
      return histogramData.buckets;
    }
    return buildFallbackBuckets(logsResult?.entries ?? [], startDate.getTime(), endDate.getTime());
  }, [histogramData, logsResult?.entries, startDate, endDate]);

  const levelTotals = useMemo(() => {
    const totals: Record<LogLevel, number> = { error: 0, warning: 0, info: 0, debug: 0, other: 0 };
    for (const b of effectiveBuckets) {
      totals.error += b.counts.error;
      totals.warning += b.counts.warning;
      totals.info += b.counts.info;
      totals.debug += b.counts.debug;
      totals.other += b.counts.other;
    }
    return totals;
  }, [effectiveBuckets]);

  const maxBucketCount = Math.max(1, ...effectiveBuckets.map((b) => b.count));

  const entries = logsResult?.entries ?? [];
  const pagedEntries = useMemo(() => {
    const start = page * rowsPerPage;
    return entries.slice(start, start + rowsPerPage);
  }, [entries, page, rowsPerPage]);

  const selectedEntry = selectedLogIndex !== null ? entries[selectedLogIndex] ?? null : null;

  useEffect(() => {
    if (selectedLogIndex === null) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedLogIndex(null);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedLogIndex((prev) => (prev === null ? null : Math.max(0, prev - 1)));
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedLogIndex((prev) => (prev === null ? null : Math.min(entries.length - 1, prev + 1)));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedLogIndex, entries.length]);

  const triggerQuery = () => {
    setPage(0);
    setExpandedRows({});
    setSelectedLogIndex(null);
    setExecutedNonce((n) => n + 1);
  };

  const toggleLevelFilter = (lvl: LogLevel) => {
    const current = activeTab.selectedLevels;
    const next = current.includes(lvl) ? current.filter((l) => l !== lvl) : [...current, lvl];
    updateActiveTab({ selectedLevels: next });
    setPage(0);
    setExpandedRows({});
    setSelectedLogIndex(null);
    setExecutedNonce((n) => n + 1);
  };

  const clearLevelFilters = () => {
    updateActiveTab({ selectedLevels: [] });
    setPage(0);
    setExpandedRows({});
    setSelectedLogIndex(null);
    setExecutedNonce((n) => n + 1);
  };

  const handleZoomToBucket = (bucket: VictoriaLogHitBucket) => {
    updateActiveTab({
      customStartIso: bucket.timestamp,
      customEndIso: bucket.endTimestamp,
    });
    setPage(0);
    setExpandedRows({});
    setSelectedLogIndex(null);
    setExecutedNonce((n) => n + 1);
  };

  const clearCustomZoom = () => {
    updateActiveTab({ customStartIso: undefined, customEndIso: undefined });
    setPage(0);
    setExpandedRows({});
    setSelectedLogIndex(null);
    setExecutedNonce((n) => n + 1);
  };

  const toggleRowExpand = (globalIdx: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedRows((prev) => ({ ...prev, [globalIdx]: !prev[globalIdx] }));
  };

  const appendFieldFilter = (field: string, value: string) => {
    const escaped = String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const expr = `${field}:="${escaped}"`;
    const nextQuery = injectLogsQLFilter(activeTab.query, expr);
    updateActiveTab({ query: nextQuery });
    setPage(0);
    setSelectedLogIndex(null);
    setExecutedNonce((n) => n + 1);
  };

  const handleCopyJson = async () => {
    if (!selectedEntry) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(selectedEntry, null, 2));
      setCopiedJson(true);
      setTimeout(() => setCopiedJson(false), 1800);
    } catch {
      // Ignore clipboard failures in restricted contexts
    }
  };

  const openCreatePreset = () => {
    setPresetError(null);
    setPresetMode('create');
    setEditingPresetId('');
    setPresetLabel('');
    setPresetQuery(activeTab.query || '*');
    setPresetDesc('');
    setPresetDialogOpen(true);
  };

  const openEditPreset = (preset: LogPresetItem) => {
    setPresetError(null);
    setPresetMode('edit');
    setEditingPresetId(preset.id);
    setPresetLabel(preset.label);
    setPresetQuery(preset.query);
    setPresetDesc(preset.description ?? '');
    setPresetDialogOpen(true);
  };

  const handleSavePreset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!presetLabel.trim() || !presetQuery.trim()) {
      setPresetError('Preset name and LogsQL query are required.');
      return;
    }
    setPresetSaving(true);
    setPresetError(null);
    const id =
      presetMode === 'edit'
        ? editingPresetId
        : presetLabel
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '') || `preset-${Date.now()}`;
    const uniqueId =
      presetMode === 'create' && presets.some((p) => p.id === id) ? `${id}-${Date.now().toString(36)}` : id;

    const item: LogPresetItem = {
      id: uniqueId,
      label: presetLabel.trim(),
      query: presetQuery.trim(),
      description: presetDesc.trim() || undefined,
    };

    const next =
      presetMode === 'create'
        ? [...presets, item]
        : presets.map((p) => (p.id === editingPresetId ? item : p));

    try {
      const saved = await saveLogPresetsConfig(next);
      queryClient.setQueryData(['perses', 'log-presets-config'], saved);
      setPresetDialogOpen(false);
      setFeedback({ kind: 'success', text: `Saved shared preset "${item.label}".` });
    } catch (err) {
      if (err instanceof ForbiddenError) {
        setLocalLogPresets(next);
        queryClient.setQueryData(['perses', 'log-presets-config'], next);
        setPresetDialogOpen(false);
        setFeedback({
          kind: 'warning',
          text: `Saved preset "${item.label}" locally in browser (cluster-wide sync requires admin/editor GlobalVariable permission).`,
        });
      } else {
        setPresetError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setPresetSaving(false);
    }
  };

  const handleDeletePreset = async (preset: LogPresetItem) => {
    if (presets.length <= 1) return;
    const next = presets.filter((p) => p.id !== preset.id);
    try {
      const saved = await saveLogPresetsConfig(next);
      queryClient.setQueryData(['perses', 'log-presets-config'], saved);
      setFeedback({ kind: 'success', text: `Removed preset "${preset.label}".` });
    } catch (err) {
      if (err instanceof ForbiddenError) {
        setLocalLogPresets(next);
        queryClient.setQueryData(['perses', 'log-presets-config'], next);
        setFeedback({
          kind: 'warning',
          text: `Removed preset "${preset.label}" locally (cluster-wide sync requires GlobalVariable write permission).`,
        });
      } else {
        setFeedback({ kind: 'error', text: err instanceof Error ? err.message : String(err) });
      }
    }
  };

  if (loadingDatasources) {
    return (
      <Stack alignItems="center" justifyContent="center" sx={{ py: 8 }}>
        <CircularProgress />
      </Stack>
    );
  }

  if (!activeTarget) {
    return (
      <Card>
        <CardContent sx={{ py: 6, textAlign: 'center' }}>
          <Stack spacing={1.5} alignItems="center">
            <VictoriaLogsBrandIcon size={36} />
            <Typography variant="subtitle1" fontWeight={700}>
              No VictoriaLogs data source configured
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Add a VictoriaLogsDatasource in Integrations → Data sources to query logs, filter levels, and save shared
              presets.
            </Typography>
            <Button variant="contained" onClick={() => navigate('/datasources')}>
              Add data source
            </Button>
          </Stack>
        </CardContent>
      </Card>
    );
  }

  return (
    <Stack spacing={1.5}>
      {feedback && (
        <Alert severity={feedback.kind} onClose={() => setFeedback(null)}>
          {feedback.text}
        </Alert>
      )}

      {/* Query Tabs & Datasource Bar */}
      <Card>
        <Box
          sx={{
            px: 2,
            borderBottom: `1px solid ${tokens.borderSubtle}`,
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            flexWrap: 'wrap',
          }}
        >
          <Tabs
            value={activeTab.id}
            onChange={(_, val: string) => {
              setActiveTabId(val);
              setPage(0);
            }}
            sx={{ minHeight: 40, '& .MuiTab-root': { minHeight: 40, py: 0.75, fontSize: 13 } }}
          >
            {tabs.map((tab) => (
              <Tab key={tab.id} value={tab.id} label={tab.label} />
            ))}
          </Tabs>
          <Button size="small" variant="text" onClick={addTab} sx={{ minWidth: 32, fontSize: 16 }}>
            +
          </Button>
          <Box sx={{ flexGrow: 1 }} />
          <Stack direction="row" spacing={1} alignItems="center" sx={{ py: 0.5 }}>
            <VictoriaLogsBrandIcon size={16} />
            <FormControl size="small" sx={{ minWidth: 185 }}>
              <Select
                value={selectedTargetKey}
                onChange={(e) => {
                  setSelectedTargetKey(e.target.value);
                  setPage(0);
                  setExecutedNonce((n) => n + 1);
                }}
              >
                {vlTargets.map((t) => (
                  <MenuItem key={datasourceTargetKey(t)} value={datasourceTargetKey(t)}>
                    {t.displayName} ({t.scope === 'global' ? 'Global' : t.project})
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>
        </Box>

        <CardContent sx={{ p: 1.75, '&:last-child': { pb: 1.75 } }}>
          {/* Shared Presets Bar */}
          <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 1.25 }}>
            <Typography variant="caption" color="text.secondary" fontWeight={600}>
              Presets:
            </Typography>
            {presets.map((preset) => (
              <Chip
                key={preset.id}
                size="small"
                label={preset.label}
                variant={activeTab.query === preset.query ? 'filled' : 'outlined'}
                color={activeTab.query === preset.query ? 'primary' : 'default'}
                onClick={() => {
                  updateActiveTab({ query: preset.query });
                  setPage(0);
                  setExecutedNonce((n) => n + 1);
                }}
                sx={{ height: 22, fontSize: 11.5 }}
              />
            ))}
            <Chip
              size="small"
              icon={<Plus sx={{ fontSize: 14 }} />}
              label="Save preset"
              variant="outlined"
              color="primary"
              onClick={openCreatePreset}
              sx={{ height: 22, fontSize: 11.5, cursor: 'pointer' }}
            />
            <Button
              size="small"
              variant="text"
              onClick={() => setManagePresetsOpen(true)}
              sx={{ fontSize: 11.5, minWidth: 0, px: 0.75, py: 0 }}
            >
              Manage presets
            </Button>
          </Stack>

          {/* Search Query Input Bar */}
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25} alignItems="stretch">
            <Box
              sx={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                border: `1px solid ${tokens.borderSubtle}`,
                borderRadius: 1.5,
                overflow: 'hidden',
                bgcolor: tokens.bgSurface,
              }}
            >
              <Box
                sx={{
                  px: 1.5,
                  py: 0.9,
                  bgcolor: tokens.bgSubtle,
                  borderRight: `1px solid ${tokens.borderSubtle}`,
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: 'text.secondary',
                  whiteSpace: 'nowrap',
                }}
              >
                Query conditions
              </Box>
              <TextField
                fullWidth
                size="small"
                variant="standard"
                placeholder='Enter LogsQL query (e.g. *, stream:="k8s_events", error)'
                value={activeTab.query}
                onChange={(e) => updateActiveTab({ query: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') triggerQuery();
                }}
                InputProps={{
                  disableUnderline: true,
                  sx: { px: 1.5, fontFamily: 'monospace', fontSize: 13 },
                }}
              />
            </Box>

            <FormControl size="small" sx={{ minWidth: 160 }}>
              <Select
                value={activeTab.rangeMinutes}
                onChange={(e) => {
                  updateActiveTab({
                    rangeMinutes: Number(e.target.value),
                    customStartIso: undefined,
                    customEndIso: undefined,
                  });
                  setPage(0);
                  setExpandedRows({});
                  setSelectedLogIndex(null);
                  setExecutedNonce((n) => n + 1);
                }}
              >
                {TIME_RANGES.map((r) => (
                  <MenuItem key={r.minutes} value={r.minutes}>
                    {r.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            {activeTab.customStartIso && activeTab.customEndIso && (
              <Chip
                size="small"
                color="primary"
                onDelete={clearCustomZoom}
                label={`Zoom: ${formatCompactTs(activeTab.customStartIso)} ~ ${formatCompactTs(activeTab.customEndIso)}`}
                sx={{ alignSelf: 'center', fontFamily: 'monospace', fontSize: 11.5 }}
              />
            )}

            <Button
              variant="contained"
              color="primary"
              onClick={triggerQuery}
              disabled={fetchingLogs}
              sx={{ px: 3 }}
            >
              {fetchingLogs ? 'Querying...' : 'Query'}
            </Button>
          </Stack>

          {/* Server-Side Level Filter Chips */}
          <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mt: 1.25 }}>
            <Typography variant="caption" color="text.secondary" fontWeight={600}>
              Level filter:
            </Typography>
            <Chip
              size="small"
              label="All"
              variant={activeTab.selectedLevels.length === 0 ? 'filled' : 'outlined'}
              color={activeTab.selectedLevels.length === 0 ? 'primary' : 'default'}
              onClick={clearLevelFilters}
              sx={{ height: 22, fontSize: 11.5 }}
            />
            {ALL_LOG_LEVELS.map((lvl) => {
              const meta = LEVEL_META[lvl];
              const active = activeTab.selectedLevels.includes(lvl);
              return (
                <Chip
                  key={lvl}
                  size="small"
                  label={`${meta.label} (${levelTotals[lvl]})`}
                  variant={active ? 'filled' : 'outlined'}
                  onClick={() => toggleLevelFilter(lvl)}
                  icon={
                    <Box
                      sx={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        bgcolor: active ? '#FFFFFF' : meta.color,
                        ml: 0.75,
                      }}
                    />
                  }
                  sx={{
                    height: 22,
                    fontSize: 11.5,
                    bgcolor: active ? meta.color : undefined,
                    color: active ? '#FFFFFF' : undefined,
                    borderColor: active ? meta.color : undefined,
                    '&:hover': active ? { bgcolor: meta.color } : undefined,
                  }}
                />
              );
            })}
          </Stack>

          {/* Stacked Level Log Statistics Histogram */}
          <Box sx={{ mt: 2 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1} sx={{ mb: 1 }}>
              <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap">
                <Typography variant="caption" fontWeight={600} color="text.secondary">
                  All log statistics
                </Typography>
                <Typography variant="caption" fontSize={11} color="text.secondary">
                  (click any bar to zoom · stacked by severity)
                </Typography>
              </Stack>
              <Stack direction="row" spacing={1.5} alignItems="center">
                <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace', fontSize: 11 }}>
                  {formatFullTs(startDate)} ~ {formatFullTs(endDate)}
                </Typography>
                <Typography
                  variant="caption"
                  color="primary.main"
                  sx={{ cursor: 'pointer', fontWeight: 600 }}
                  onClick={() => setShowChart((prev) => !prev)}
                >
                  {showChart ? 'Hide chart' : 'Show chart'}
                </Typography>
              </Stack>
            </Stack>

            <Collapse in={showChart}>
              <Box
                sx={{
                  p: 1.25,
                  borderRadius: 1.5,
                  bgcolor: tokens.bgSubtle,
                  border: `1px solid ${tokens.borderSubtle}`,
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: 76 }}>
                  {effectiveBuckets.map((bucket, idx) => {
                    const total = bucket.count;
                    const totalHeightPx = total > 0 ? Math.max(4, Math.round((total / maxBucketCount) * 68)) : 2;
                    const tooltipText = (
                      <Box sx={{ fontSize: 11.5 }}>
                        <div>
                          <strong>
                            {formatCompactTs(bucket.timestamp)} ~ {formatCompactTs(bucket.endTimestamp)}
                          </strong>
                        </div>
                        <div>Total: {total} logs (click to zoom)</div>
                        <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
                          {ALL_LOG_LEVELS.map((lvl) => (
                            <span key={lvl} style={{ color: LEVEL_META[lvl].color, fontWeight: 600 }}>
                              {LEVEL_META[lvl].short}: {bucket.counts[lvl]}
                            </span>
                          ))}
                        </div>
                      </Box>
                    );

                    const orderedLevels: LogLevel[] = ['error', 'warning', 'info', 'debug', 'other'];

                    return (
                      <Tooltip key={`${bucket.timestamp}-${idx}`} title={tooltipText}>
                        <Box
                          onClick={() => handleZoomToBucket(bucket)}
                          sx={{
                            flex: 1,
                            height: '100%',
                            display: 'flex',
                            alignItems: 'flex-end',
                            cursor: 'pointer',
                            '&:hover .stacked-bar': {
                              filter: 'brightness(1.12)',
                              outline: `1px solid ${tokens.borderSubtle}`,
                            },
                          }}
                        >
                          {total === 0 ? (
                            <Box
                              className="stacked-bar"
                              sx={{
                                width: '100%',
                                height: 2,
                                bgcolor: 'divider',
                                opacity: 0.35,
                                borderRadius: '2px 2px 0 0',
                              }}
                            />
                          ) : (
                            <Box
                              className="stacked-bar"
                              sx={{
                                width: '100%',
                                height: totalHeightPx,
                                display: 'flex',
                                flexDirection: 'column-reverse',
                                borderRadius: '2px 2px 0 0',
                                overflow: 'hidden',
                              }}
                            >
                              {orderedLevels.map((lvl) => {
                                const c = bucket.counts[lvl];
                                if (c <= 0) return null;
                                const pct = (c / total) * 100;
                                return (
                                  <Box
                                    key={lvl}
                                    sx={{
                                      width: '100%',
                                      height: `${pct}%`,
                                      minHeight: 1.5,
                                      bgcolor: LEVEL_META[lvl].color,
                                    }}
                                  />
                                );
                              })}
                            </Box>
                          )}
                        </Box>
                      </Tooltip>
                    );
                  })}
                </Box>
                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 0.75 }} flexWrap="wrap" gap={1}>
                  <Typography variant="caption" fontSize={10.5} color="text.secondary">
                    {effectiveBuckets[0]?.label ?? ''}
                  </Typography>
                  <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap">
                    {ALL_LOG_LEVELS.map((lvl) => (
                      <Stack key={lvl} direction="row" spacing={0.5} alignItems="center">
                        <Box sx={{ width: 8, height: 8, borderRadius: 0.5, bgcolor: LEVEL_META[lvl].color }} />
                        <Typography variant="caption" fontSize={10.5} color="text.secondary">
                          {LEVEL_META[lvl].label}: {levelTotals[lvl]}
                        </Typography>
                      </Stack>
                    ))}
                    <Typography variant="caption" fontSize={10.5} color="text.secondary">
                      · Peak bucket: {maxBucketCount}
                    </Typography>
                  </Stack>
                  <Typography variant="caption" fontSize={10.5} color="text.secondary">
                    {effectiveBuckets[effectiveBuckets.length - 1]?.label ?? ''}
                  </Typography>
                </Stack>
              </Box>
            </Collapse>
          </Box>
        </CardContent>
      </Card>

      {logsError && <Alert severity="error">VictoriaLogs query failed: {logsError.message}</Alert>}

      {/* Results Toolbar + Log Stream Table */}
      <Card>
        <Box
          sx={{
            px: 2,
            py: 1,
            borderBottom: `1px solid ${tokens.borderSubtle}`,
            display: 'flex',
            flexWrap: 'wrap',
            gap: 1.5,
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap">
            <ToggleButtonGroup
              size="small"
              exclusive
              value={displayMode}
              onChange={(_, val: 'original' | 'table' | null) => {
                if (val) setDisplayMode(val);
              }}
            >
              <ToggleButton value="original" sx={{ px: 1.5, py: 0.4, fontSize: 12 }}>
                Original
              </ToggleButton>
              <ToggleButton value="table" sx={{ px: 1.5, py: 0.4, fontSize: 12 }}>
                Table
              </ToggleButton>
            </ToggleButtonGroup>

            <FormControlLabel
              control={<Switch size="small" checked={lineBreak} onChange={(e) => setLineBreak(e.target.checked)} />}
              label={<Typography variant="caption">Line break</Typography>}
            />
            <FormControlLabel
              control={<Switch size="small" checked={showLineNum} onChange={(e) => setShowLineNum(e.target.checked)} />}
              label={<Typography variant="caption">Lines</Typography>}
            />
            <FormControlLabel
              control={<Switch size="small" checked={showLogTime} onChange={(e) => setShowLogTime(e.target.checked)} />}
              label={<Typography variant="caption">Log time</Typography>}
            />
          </Stack>

          <Stack direction="row" spacing={2} alignItems="center">
            <Typography variant="caption" color="text.secondary">
              Duration : <strong>{logsResult?.durationMs ?? 0} ms</strong>
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Count : <strong>{entries.length}</strong>
            </Typography>
          </Stack>
        </Box>

        {loadingLogs ? (
          <Stack alignItems="center" justifyContent="center" spacing={1} sx={{ py: 8 }}>
            <CircularProgress size={26} />
            <Typography variant="caption" color="text.secondary">
              Streaming LogsQL records from {activeTarget.name}...
            </Typography>
          </Stack>
        ) : entries.length === 0 ? (
          <Box sx={{ p: 4, textAlign: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              No logs matched query <code>{effectiveQuery}</code> in the selected time range.
            </Typography>
          </Box>
        ) : displayMode === 'original' ? (
          <TableContainer sx={{ maxHeight: 580, overflowX: 'hidden' }}>
            <Table size="small" stickyHeader sx={{ tableLayout: 'fixed', width: '100%' }}>
              <TableHead>
                <TableRow>
                  <TableCell width={46} />
                  {showLineNum && <TableCell width={56}>Lines</TableCell>}
                  <TableCell width={70}>Level</TableCell>
                  {showLogTime && <TableCell width={160}>Log time</TableCell>}
                  <TableCell>Log data</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {pagedEntries.map((entry, idx) => {
                  const globalIndex = page * rowsPerPage + idx;
                  const rowNumber = globalIndex + 1;
                  const isExpanded = Boolean(expandedRows[globalIndex]);
                  const isSelected = selectedLogIndex === globalIndex;
                  const lvl = classifyLogLevel(entry);
                  const extraFields = Object.entries(entry)
                    .filter(([k, v]) => k !== '_time' && k !== '_stream_id' && v !== '')
                    .sort(([a], [b]) => a.localeCompare(b));

                  return (
                    <React.Fragment key={`${entry._time}-${rowNumber}`}>
                      <TableRow
                        hover
                        selected={isSelected}
                        onClick={() => setSelectedLogIndex(globalIndex)}
                        sx={{
                          cursor: 'pointer',
                          '&.Mui-selected': { bgcolor: tokens.bgActiveNav },
                        }}
                      >
                        <TableCell sx={{ verticalAlign: 'top', pt: 0.75 }}>
                          <Tooltip title={isExpanded ? 'Collapse inline fields' : 'Expand dropdown fields'}>
                            <IconButton
                              size="small"
                              onClick={(e) => toggleRowExpand(globalIndex, e)}
                              sx={{ fontSize: 12, width: 24, height: 24 }}
                            >
                              {isExpanded ? '▾' : '▸'}
                            </IconButton>
                          </Tooltip>
                        </TableCell>
                        {showLineNum && (
                          <TableCell sx={{ fontFamily: 'monospace', color: 'text.secondary', verticalAlign: 'top', pt: 1 }}>
                            {rowNumber}
                          </TableCell>
                        )}
                        <TableCell sx={{ verticalAlign: 'top', pt: 0.9 }}>
                          <LevelBadge level={lvl} />
                        </TableCell>
                        {showLogTime && (
                          <TableCell
                            sx={{
                              fontFamily: 'monospace',
                              whiteSpace: 'nowrap',
                              verticalAlign: 'top',
                              pt: 1,
                              fontSize: 12,
                            }}
                          >
                            {formatCompactTs(entry._time)}
                          </TableCell>
                        )}
                        <TableCell sx={{ py: 0.65, overflow: 'hidden' }}>
                          <Box
                            sx={{
                              display: 'flex',
                              flexWrap: 'wrap',
                              gap: 0.6,
                              alignItems: 'center',
                              maxHeight: lineBreak || isExpanded ? 'none' : 50,
                              overflow: 'hidden',
                            }}
                          >
                            {extraFields.map(([k, v]) => (
                              <Box
                                key={k}
                                sx={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  border: `1px solid ${tokens.borderSubtle}`,
                                  borderRadius: 1,
                                  overflow: 'hidden',
                                  fontSize: 11.5,
                                  fontFamily: 'monospace',
                                  maxWidth: lineBreak || isExpanded ? '100%' : 360,
                                }}
                              >
                                <Box
                                  component="span"
                                  sx={{
                                    px: 0.65,
                                    py: 0.1,
                                    bgcolor: tokens.bgSubtle,
                                    color: 'text.secondary',
                                    borderRight: `1px solid ${tokens.borderSubtle}`,
                                    fontWeight: 600,
                                    flexShrink: 0,
                                  }}
                                >
                                  {k}
                                </Box>
                                <Box
                                  component="span"
                                  sx={{
                                    px: 0.65,
                                    py: 0.1,
                                    color: 'text.primary',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: lineBreak || isExpanded ? 'pre-wrap' : 'nowrap',
                                    wordBreak: 'break-word',
                                  }}
                                >
                                  {String(v)}
                                </Box>
                              </Box>
                            ))}
                          </Box>
                        </TableCell>
                      </TableRow>

                      {isExpanded && (
                        <TableRow>
                          <TableCell
                            colSpan={1 + (showLineNum ? 1 : 0) + 1 + (showLogTime ? 1 : 0) + 1}
                            sx={{ p: 0, bgcolor: tokens.bgSubtle }}
                          >
                            <Box sx={{ px: 3, py: 1.25, borderBottom: `1px solid ${tokens.borderSubtle}` }}>
                              <Stack
                                direction="row"
                                justifyContent="space-between"
                                alignItems="center"
                                sx={{ mb: 0.75 }}
                              >
                                <Typography variant="caption" fontWeight={700} color="text.secondary">
                                  Structured Log Fields ({Object.keys(entry).length} fields)
                                </Typography>
                                <Button
                                  size="small"
                                  variant="text"
                                  onClick={() => setSelectedLogIndex(globalIndex)}
                                  sx={{ fontSize: 11.5, py: 0 }}
                                >
                                  Open Detail Drawer →
                                </Button>
                              </Stack>
                              <Table size="small" sx={{ bgcolor: tokens.bgSurface, borderRadius: 1 }}>
                                <TableBody>
                                  {Object.entries(entry)
                                    .sort(([a], [b]) => a.localeCompare(b))
                                    .map(([k, v]) => (
                                      <TableRow key={k} hover>
                                        <TableCell
                                          sx={{
                                            width: 240,
                                            fontFamily: 'monospace',
                                            fontSize: 11.5,
                                            fontWeight: 600,
                                            color: 'text.secondary',
                                            verticalAlign: 'top',
                                          }}
                                        >
                                          {k}
                                        </TableCell>
                                        <TableCell
                                          sx={{
                                            fontFamily: 'monospace',
                                            fontSize: 11.5,
                                            wordBreak: 'break-word',
                                            whiteSpace: 'pre-wrap',
                                          }}
                                        >
                                          {String(v)}
                                        </TableCell>
                                      </TableRow>
                                    ))}
                                </TableBody>
                              </Table>
                            </Box>
                          </TableCell>
                        </TableRow>
                      )}
                    </React.Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        ) : (
          <TableContainer sx={{ maxHeight: 580 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell width={70}>Level</TableCell>
                  <TableCell width={160}>Timestamp</TableCell>
                  <TableCell width={200}>Namespace / Pod</TableCell>
                  <TableCell>Message (_msg)</TableCell>
                  <TableCell width={220}>Stream</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {pagedEntries.map((entry, idx) => {
                  const globalIndex = page * rowsPerPage + idx;
                  const lvl = classifyLogLevel(entry);
                  return (
                    <TableRow
                      key={`${entry._time}-${idx}`}
                      hover
                      selected={selectedLogIndex === globalIndex}
                      onClick={() => setSelectedLogIndex(globalIndex)}
                      sx={{ cursor: 'pointer' }}
                    >
                      <TableCell>
                        <LevelBadge level={lvl} />
                      </TableCell>
                      <TableCell sx={{ fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                        {formatCompactTs(entry._time)}
                      </TableCell>
                      <TableCell sx={{ fontFamily: 'monospace', fontSize: 11.5 }}>
                        {[entry['kubernetes.pod_namespace'], entry['kubernetes.pod_name']].filter(Boolean).join(' / ') ||
                          '-'}
                      </TableCell>
                      <TableCell sx={{ fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-word' }}>
                        {entry._msg}
                      </TableCell>
                      <TableCell sx={{ fontFamily: 'monospace', fontSize: 11, color: 'text.secondary' }}>
                        {entry._stream}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}

        <TablePagination
          component="div"
          count={entries.length}
          page={page}
          onPageChange={(_, p) => setPage(p)}
          rowsPerPage={rowsPerPage}
          onRowsPerPageChange={(e) => {
            setRowsPerPage(parseInt(e.target.value, 10));
            setPage(0);
          }}
          rowsPerPageOptions={[15, 30, 50, 100]}
        />
      </Card>

      {/* Create / Edit Log Preset Dialog */}
      <Dialog open={presetDialogOpen} onClose={() => setPresetDialogOpen(false)} maxWidth="sm" fullWidth>
        <Box component="form" onSubmit={handleSavePreset}>
          <DialogTitle>{presetMode === 'create' ? 'Save Shared Log Preset' : 'Edit Log Preset'}</DialogTitle>
          <DialogContent dividers>
            <Stack spacing={2}>
              {presetError && <Alert severity="error">{presetError}</Alert>}
              <TextField
                label="Preset Name"
                placeholder="e.g. Ingress 5xx Errors"
                value={presetLabel}
                onChange={(e) => setPresetLabel(e.target.value)}
                required
                fullWidth
                size="small"
              />
              <TextField
                label="LogsQL Query"
                value={presetQuery}
                onChange={(e) => setPresetQuery(e.target.value)}
                required
                fullWidth
                multiline
                minRows={2}
                size="small"
                InputProps={{ sx: { fontFamily: 'monospace', fontSize: 12.5 } }}
              />
              <TextField
                label="Description (optional)"
                value={presetDesc}
                onChange={(e) => setPresetDesc(e.target.value)}
                fullWidth
                size="small"
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setPresetDialogOpen(false)} disabled={presetSaving}>
              Cancel
            </Button>
            <Button type="submit" variant="contained" disabled={presetSaving}>
              {presetSaving ? 'Saving...' : 'Save Preset'}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>

      {/* Manage Presets Dialog */}
      <Dialog open={managePresetsOpen} onClose={() => setManagePresetsOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Manage Shared Log Presets</DialogTitle>
        <DialogContent dividers>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Label</TableCell>
                <TableCell>LogsQL Query</TableCell>
                <TableCell align="right" width={96}>
                  Actions
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {presets.map((preset) => (
                <TableRow key={preset.id} hover>
                  <TableCell sx={{ fontWeight: 600 }}>{preset.label}</TableCell>
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: 11.5 }}>{preset.query}</TableCell>
                  <TableCell align="right">
                    <IconButton
                      size="small"
                      onClick={() => {
                        setManagePresetsOpen(false);
                        openEditPreset(preset);
                      }}
                    >
                      <PencilOutline fontSize="small" />
                    </IconButton>
                    <Tooltip title={presets.length <= 1 ? 'At least one preset is required' : 'Delete preset'}>
                      <span>
                        <IconButton
                          size="small"
                          color="error"
                          disabled={presets.length <= 1}
                          onClick={() => void handleDeletePreset(preset)}
                        >
                          <DeleteOutline fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DialogContent>
        <DialogActions>
          <Button
            variant="outlined"
            startIcon={<Plus />}
            onClick={() => {
              setManagePresetsOpen(false);
              openCreatePreset();
            }}
          >
            Add Preset
          </Button>
          <Button onClick={() => setManagePresetsOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Right Slide-Out Log Detail Drawer */}
      <Drawer
        anchor="right"
        open={Boolean(selectedEntry)}
        onClose={() => setSelectedLogIndex(null)}
        PaperProps={{
          sx: {
            width: { xs: '100vw', sm: formatDrawerWidth(drawerSize) },
            maxWidth: '100vw',
            bgcolor: tokens.bgSurface,
            display: 'flex',
            flexDirection: 'column',
          },
        }}
      >
        {selectedEntry && (
          <>
            {/* Drawer Header */}
            <Box
              sx={{
                px: 2.5,
                py: 1.5,
                borderBottom: `1px solid ${tokens.borderSubtle}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 1.5,
              }}
            >
              <Stack direction="row" spacing={1} alignItems="center">
                <LevelBadge level={classifyLogLevel(selectedEntry)} />
                <Typography variant="subtitle1" fontWeight={700} sx={{ fontFamily: 'monospace' }}>
                  {formatCompactTs(selectedEntry._time)}
                </Typography>
              </Stack>

              <Stack direction="row" spacing={1} alignItems="center">
                <ToggleButtonGroup
                  size="small"
                  exclusive
                  value={drawerSize}
                  onChange={(_, val: 'small' | 'medium' | 'large' | null) => {
                    if (val) setDrawerSize(val);
                  }}
                >
                  <ToggleButton value="small" sx={{ px: 1.25, py: 0.25, fontSize: 12 }}>
                    Small
                  </ToggleButton>
                  <ToggleButton value="medium" sx={{ px: 1.25, py: 0.25, fontSize: 12 }}>
                    Medium
                  </ToggleButton>
                  <ToggleButton value="large" sx={{ px: 1.25, py: 0.25, fontSize: 12 }}>
                    Large
                  </ToggleButton>
                </ToggleButtonGroup>
                <IconButton size="small" onClick={() => setSelectedLogIndex(null)} aria-label="Close detail drawer">
                  ✕
                </IconButton>
              </Stack>
            </Box>

            {/* Drawer Body */}
            <Box sx={{ flex: 1, overflowY: 'auto', p: 2.5 }}>
              <Stack spacing={1.25} sx={{ mb: 2 }}>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
                  <Box
                    sx={{
                      flex: 1,
                      p: 1.25,
                      borderRadius: 1,
                      border: `1px solid ${tokens.borderSubtle}`,
                      bgcolor: tokens.bgSubtle,
                    }}
                  >
                    <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                      _msg
                    </Typography>
                    <Typography
                      variant="body2"
                      fontWeight={600}
                      sx={{ fontFamily: 'monospace', fontSize: 12.5, mt: 0.25, wordBreak: 'break-word' }}
                    >
                      {selectedEntry._msg || '-'}
                    </Typography>
                  </Box>

                  <Box
                    sx={{
                      width: { xs: '100%', sm: 225 },
                      flexShrink: 0,
                      p: 1.25,
                      borderRadius: 1,
                      border: `1px solid ${tokens.borderSubtle}`,
                      bgcolor: tokens.bgSubtle,
                    }}
                  >
                    <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                      _time
                    </Typography>
                    <Typography
                      variant="body2"
                      fontWeight={600}
                      sx={{ fontFamily: 'monospace', fontSize: 12, mt: 0.25, wordBreak: 'break-word' }}
                    >
                      {selectedEntry._time}
                    </Typography>
                  </Box>
                </Stack>

                {selectedEntry._stream_id && (
                  <Box
                    sx={{
                      p: 1.25,
                      borderRadius: 1,
                      border: `1px solid ${tokens.borderSubtle}`,
                      bgcolor: tokens.bgSubtle,
                    }}
                  >
                    <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                      _stream_id
                    </Typography>
                    <Typography
                      variant="body2"
                      fontWeight={600}
                      sx={{ fontFamily: 'monospace', fontSize: 12, mt: 0.25, wordBreak: 'break-all' }}
                    >
                      {selectedEntry._stream_id}
                    </Typography>
                  </Box>
                )}

                {selectedEntry._stream && (
                  <Box
                    sx={{
                      p: 1.25,
                      borderRadius: 1,
                      border: `1px solid ${tokens.borderSubtle}`,
                      bgcolor: tokens.bgSubtle,
                    }}
                  >
                    <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                      _stream
                    </Typography>
                    <Typography
                      variant="body2"
                      fontWeight={600}
                      sx={{ fontFamily: 'monospace', fontSize: 12, mt: 0.25, wordBreak: 'break-word' }}
                    >
                      {selectedEntry._stream}
                    </Typography>
                  </Box>
                )}
              </Stack>

              <Box
                sx={{
                  borderBottom: `1px solid ${tokens.borderSubtle}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  mb: 1.25,
                }}
              >
                <Tabs
                  value={drawerTab}
                  onChange={(_, v: 'table' | 'json') => setDrawerTab(v)}
                  sx={{ minHeight: 36, '& .MuiTab-root': { minHeight: 36, py: 0.5, fontSize: 13 } }}
                >
                  <Tab value="table" label="Table" />
                  <Tab value="json" label="JSON" />
                </Tabs>

                <Button size="small" variant="text" onClick={() => void handleCopyJson()} sx={{ fontSize: 12 }}>
                  {copiedJson ? '✓ Copied!' : '❐ Copy to clipboard'}
                </Button>
              </Box>

              {drawerTab === 'table' ? (
                <Table size="small">
                  <TableBody>
                    {Object.entries(selectedEntry)
                      .filter(([k]) => !k.startsWith('_'))
                      .sort(([a], [b]) => a.localeCompare(b))
                      .map(([k, v]) => (
                        <TableRow key={k} hover>
                          <TableCell
                            sx={{
                              width: 190,
                              fontFamily: 'monospace',
                              fontSize: 12,
                              color: 'text.secondary',
                              verticalAlign: 'top',
                            }}
                          >
                            {k}
                          </TableCell>
                          <TableCell
                            sx={{
                              fontFamily: 'monospace',
                              fontSize: 12,
                              wordBreak: 'break-word',
                              whiteSpace: 'pre-wrap',
                            }}
                          >
                            <Stack direction="row" spacing={1} alignItems="flex-start" justifyContent="space-between">
                              <span>{String(v)}</span>
                              <Tooltip title={`Filter by ${k}:="${String(v)}"`}>
                                <Chip
                                  size="small"
                                  label="+ filter"
                                  variant="outlined"
                                  onClick={() => appendFieldFilter(k, String(v))}
                                  sx={{ height: 20, fontSize: 10.5, cursor: 'pointer', flexShrink: 0 }}
                                />
                              </Tooltip>
                            </Stack>
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              ) : (
                <Box
                  component="pre"
                  sx={{
                    m: 0,
                    p: 1.5,
                    borderRadius: 1,
                    bgcolor: tokens.bgSubtle,
                    border: `1px solid ${tokens.borderSubtle}`,
                    fontFamily: 'monospace',
                    fontSize: 12,
                    overflow: 'auto',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {JSON.stringify(selectedEntry, null, 2)}
                </Box>
              )}
            </Box>

            <Box
              sx={{
                px: 2.5,
                py: 1,
                borderTop: `1px solid ${tokens.borderSubtle}`,
                bgcolor: tokens.bgSubtle,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11.5 }}>
                Use ↑ / ↓ to view previous/next log, Esc to close
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace', fontSize: 11.5 }}>
                {selectedLogIndex !== null ? `${selectedLogIndex + 1} / ${entries.length}` : ''}
              </Typography>
            </Box>
          </>
        )}
      </Drawer>
    </Stack>
  );
}
