import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  FormControl,
  FormControlLabel,
  IconButton,
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
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import ArrowDown from 'mdi-material-ui/ArrowDown';
import ArrowLeft from 'mdi-material-ui/ArrowLeft';
import ArrowRight from 'mdi-material-ui/ArrowRight';
import Close from 'mdi-material-ui/Close';
import DeleteSweep from 'mdi-material-ui/DeleteSweep';
import Download from 'mdi-material-ui/Download';
import PencilOutline from 'mdi-material-ui/PencilOutline';
import Plus from 'mdi-material-ui/Plus';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { datasourceTargetKey, useDatasourceTargets } from '@/lib/api/datasources';
import { ForbiddenError } from '@/lib/api/http';
import type {
  HistogramGroupBy,
  LogLevel,
  LogPresetItem,
  VictoriaLogGroupHitBucket,
  VictoriaLogHitBucket,
} from '@/lib/api/logs';
import {
  ALL_LOG_LEVELS,
  DEFAULT_LOG_PRESETS,
  buildLogsQLLevelFilter,
  fetchLogPresetsConfig,
  fetchVictoriaLogsChunked,
  hasCustomLimitOrTransformPipe,
  injectLogsQLFilter,
  queryVictoriaLogsFieldHistogram,
  queryVictoriaLogsLevelHistogram,
  saveLogPresetsConfig,
  setLocalLogPresets,
} from '@/lib/api/logs';
import { queryKeys } from '@/lib/api/queryKeys';
import type {
  LogDatasourceAdapter,
  LogQueryResult,
  NormalizedLogEntry,
} from './api/logDatasource';
import { createLogDatasourceAdapter, toFlatLogRecord } from './api/logDatasource';
import type { ExportFormat } from '@/lib/export/exportRecords';
import { exportRawJsonlLinesToFile, exportRecordsToFile } from '@/lib/export/exportRecords';
import { VictoriaLogsBrandIcon } from '@/components/ui/BrandIcons';
import { LogDetailDrawer } from './LogDetailDrawer';
import { LogsHistogramChart } from './LogsHistogramChart';
import { LogsPresetDialogs } from './components/LogsPresetDialogs';
import { MAX_LIVE_BUFFER_LINES, useLiveTail } from './hooks/useLiveTail';
import { useLogTabs } from './hooks/useLogTabs';
import {
  LEVEL_META,
  LOG_BATCH_SIZE,
  LevelBadge,
  TIME_RANGES,
  buildFallbackBuckets,
  formatCompactTs,
  formatFullTs,
} from './logsExplorerHelpers';

export function LogsExplorerView({
  initialQuery = '*',
  lockedNamespace,
}: {
  initialQuery?: string;
  lockedNamespace?: string;
}) {
  const muiTheme = useTheme();
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

  const [executedNonce, setExecutedNonce] = useState<number>(1);
  const [showChart, setShowChart] = useState<boolean>(true);
  const [displayMode, setDisplayMode] = useState<'original' | 'table'>('original');
  const [lineBreak, setLineBreak] = useState<boolean>(false);
  const [showLineNum, setShowLineNum] = useState<boolean>(true);
  const [showLogTime, setShowLogTime] = useState<boolean>(true);
  const [page, setPage] = useState<number>(0);
  const [rowsPerPage, setRowsPerPage] = useState<number>(30);
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const [expandedRows, setExpandedRows] = useState<Record<number, boolean>>({});
  const [selectedLogIndex, setSelectedLogIndex] = useState<number | null>(null);
  const [drawerSize, setDrawerSize] = useState<'small' | 'medium' | 'large'>('medium');
  const [drawerTab, setDrawerTab] = useState<'table' | 'json'>('table');
  const [copiedJson, setCopiedJson] = useState<boolean>(false);

  const resetPaginationAndSelection = useCallback(() => {
    setCursorStack([]);
    setPage(0);
    setSelectedLogIndex(null);
    setExpandedRows({});
  }, []);

  const {
    tabs,
    setActiveTabId,
    activeTab,
    editingTabId,
    setEditingTabId,
    editingTabLabel,
    setEditingTabLabel,
    debouncedQuery,
    setDebouncedQuery,
    updateActiveTab,
    addTab,
    closeTab,
    commitTabRename,
  } = useLogTabs(initialQuery, resetPaginationAndSelection);

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
  const [exportAnchorEl, setExportAnchorEl] = useState<HTMLElement | null>(null);
  const [exportingLogs, setExportingLogs] = useState(false);
  const [exportProgressCount, setExportProgressCount] = useState(0);
  const exportAbortRef = useRef<AbortController | null>(null);

  const logAdapter: LogDatasourceAdapter | null = useMemo(
    () => (activeTarget ? createLogDatasourceAdapter(activeTarget) : null),
    [activeTarget],
  );

  const { data: presets = DEFAULT_LOG_PRESETS } = useQuery<LogPresetItem[], Error>({
    queryKey: queryKeys.logPresetsConfig,
    queryFn: fetchLogPresetsConfig,
  });

  const effectiveQuery = useMemo(() => {
    const levelExpr = buildLogsQLLevelFilter(activeTab.selectedLevels);
    let q = injectLogsQLFilter(debouncedQuery, levelExpr);
    if (lockedNamespace) {
      const escapedNs = lockedNamespace.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      q = injectLogsQLFilter(q, `kubernetes.namespace_name:="${escapedNs}"`);
    }
    return q;
  }, [debouncedQuery, activeTab.selectedLevels, lockedNamespace]);

  const handleClearLiveSelection = useCallback(() => {
    setExpandedRows({});
    setSelectedLogIndex(null);
  }, []);

  const {
    liveMode,
    setLiveMode,
    liveEntries,
    liveError,
    setLiveError,
    autoScroll,
    setAutoScroll,
    liveScrollContainerRef,
    liveVirtualizer,
    handleLiveScroll,
    handleResumeLiveScroll,
    handleClearLiveLogs,
  } = useLiveTail({
    logAdapter,
    effectiveQuery,
    lineBreak,
    onClearSelection: handleClearLiveSelection,
  });

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

  const cursorEndIso = cursorStack.length > 0 ? cursorStack[cursorStack.length - 1] : endDate.toISOString();
  const canCursorPage = !hasCustomLimitOrTransformPipe(effectiveQuery);

  const {
    data: logsResult,
    isInitialLoading: loadingLogs,
    isFetching: fetchingLogs,
    error: logsError,
  } = useQuery<LogQueryResult, Error>({
    queryKey: queryKeys.logsQuery(
      selectedTargetKey,
      activeTab.id,
      effectiveQuery,
      activeTab.rangeMinutes,
      activeTab.customStartIso ?? '',
      activeTab.customEndIso ?? '',
      cursorEndIso,
      executedNonce,
    ),
    queryFn: ({ signal }) =>
      logAdapter!.queryLogs({
        query: effectiveQuery,
        limit: LOG_BATCH_SIZE,
        startIso: startDate.toISOString(),
        endIso: cursorEndIso,
        sortDesc: true,
        signal,
      }),
    enabled: Boolean(logAdapter) && !liveMode,
  });

  const spanSeconds = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 1000));
  const stepSeconds = Math.max(1, Math.round(spanSeconds / 50));
  const [histogramGroupBy, setHistogramGroupBy] = useState<HistogramGroupBy>('level');

  const { data: groupHistogramData } = useQuery<
    { buckets: VictoriaLogGroupHitBucket[]; seriesKeys: string[] },
    Error
  >({
    queryKey: queryKeys.logsGroupHistogram(
      histogramGroupBy,
      selectedTargetKey,
      activeTab.id,
      effectiveQuery,
      activeTab.rangeMinutes,
      activeTab.customStartIso ?? '',
      activeTab.customEndIso ?? '',
      executedNonce,
    ),
    queryFn: ({ signal }) =>
      queryVictoriaLogsFieldHistogram(
        effectiveQuery,
        startDate.toISOString(),
        endDate.toISOString(),
        stepSeconds,
        activeTarget!,
        histogramGroupBy === 'container' ? 'kubernetes.container_name' : '_stream',
        10,
        signal,
      ),
    enabled: Boolean(activeTarget) && histogramGroupBy !== 'level',
  });

  const { data: histogramData } = useQuery<{ buckets: VictoriaLogHitBucket[]; stacked: boolean }, Error>({
    queryKey: queryKeys.logsLevelHistogram(
      selectedTargetKey,
      activeTab.id,
      effectiveQuery,
      activeTab.rangeMinutes,
      activeTab.customStartIso ?? '',
      activeTab.customEndIso ?? '',
      activeTab.selectedLevels.join(','),
      executedNonce,
    ),
    queryFn: ({ signal }) =>
      queryVictoriaLogsLevelHistogram(
        effectiveQuery,
        startDate.toISOString(),
        endDate.toISOString(),
        stepSeconds,
        activeTarget!,
        activeTab.selectedLevels,
        signal,
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

  const entries: NormalizedLogEntry[] = useMemo(
    () => (liveMode ? liveEntries : (logsResult?.entries ?? [])),
    [liveMode, liveEntries, logsResult?.entries],
  );
  const pagedEntries = useMemo(() => {
    if (liveMode) return entries;
    const start = page * rowsPerPage;
    return entries.slice(start, start + rowsPerPage);
  }, [entries, page, rowsPerPage, liveMode]);

  const selectedEntry = useMemo(
    () => (selectedLogIndex !== null && entries[selectedLogIndex] ? toFlatLogRecord(entries[selectedLogIndex]) : null),
    [selectedLogIndex, entries],
  );

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
    setDebouncedQuery(activeTab.query);
    setCursorStack([]);
    setPage(0);
    setExpandedRows({});
    setSelectedLogIndex(null);
    setExecutedNonce((n) => n + 1);
  };

  const toggleLevelFilter = (lvl: LogLevel) => {
    const current = activeTab.selectedLevels;
    const next = current.includes(lvl) ? current.filter((l) => l !== lvl) : [...current, lvl];
    updateActiveTab({ selectedLevels: next });
    setCursorStack([]);
    setPage(0);
    setExpandedRows({});
    setSelectedLogIndex(null);
    setExecutedNonce((n) => n + 1);
  };

  const clearLevelFilters = () => {
    updateActiveTab({ selectedLevels: [] });
    setCursorStack([]);
    setPage(0);
    setExpandedRows({});
    setSelectedLogIndex(null);
    setExecutedNonce((n) => n + 1);
  };

  const handleZoomToBucket = (bucket: { timestamp: string; endTimestamp: string }) => {
    updateActiveTab({
      customStartIso: bucket.timestamp,
      customEndIso: bucket.endTimestamp,
    });
    setCursorStack([]);
    setPage(0);
    setExpandedRows({});
    setSelectedLogIndex(null);
    setExecutedNonce((n) => n + 1);
  };

  const clearCustomZoom = () => {
    updateActiveTab({ customStartIso: undefined, customEndIso: undefined });
    setCursorStack([]);
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
    setDebouncedQuery(nextQuery);
    setCursorStack([]);
    setPage(0);
    setSelectedLogIndex(null);
    setExecutedNonce((n) => n + 1);
  };

  const oldestEntryTs = entries.length > 0 ? String(entries[entries.length - 1].timestamp ?? '').trim() : '';
  const hasOlderBatch =
    canCursorPage &&
    entries.length >= LOG_BATCH_SIZE &&
    Boolean(oldestEntryTs) &&
    oldestEntryTs > startDate.toISOString();

  const handleLoadOlderBatch = () => {
    if (!hasOlderBatch) return;
    setCursorStack((prev) => [...prev, oldestEntryTs]);
    setPage(0);
    setExpandedRows({});
    setSelectedLogIndex(null);
  };

  const handleLoadNewerBatch = () => {
    if (cursorStack.length === 0) return;
    setCursorStack((prev) => prev.slice(0, -1));
    setPage(0);
    setExpandedRows({});
    setSelectedLogIndex(null);
  };

  const handleResetToLatestBatch = () => {
    if (cursorStack.length === 0) return;
    setCursorStack([]);
    setPage(0);
    setExpandedRows({});
    setSelectedLogIndex(null);
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

  const handleExportLogs = async (
    format: ExportFormat,
    scope: 'loaded' | 'stream20k' | 'stream50k',
  ) => {
    setExportAnchorEl(null);
    if (!activeTarget) return;

    if (scope === 'loaded') {
      const flatRecords = entries.map((e) => toFlatLogRecord(e));
      const count = exportRecordsToFile(flatRecords as Record<string, unknown>[], format, 'victorialogs-batch');
      setFeedback({
        kind: 'success',
        text: `Exported ${count.toLocaleString()} log record${count === 1 ? '' : 's'} as ${format.toUpperCase()}.`,
      });
      return;
    }

    const maxRows = scope === 'stream50k' ? 50000 : 20000;
    const rawLinesOnly = format === 'jsonl';
    const controller = new AbortController();
    exportAbortRef.current = controller;
    setExportingLogs(true);
    setExportProgressCount(0);

    try {
      const result = await fetchVictoriaLogsChunked({
        query: effectiveQuery,
        startIso: startDate.toISOString(),
        endIso: endDate.toISOString(),
        target: activeTarget,
        maxRows,
        chunkSize: 1000,
        rawLinesOnly,
        signal: controller.signal,
        onProgress: (count) => setExportProgressCount(count),
      });

      const exportedCount = rawLinesOnly
        ? exportRawJsonlLinesToFile(result.rawLines ?? [], 'victorialogs-export')
        : exportRecordsToFile((result.entries ?? []) as Record<string, unknown>[], format, 'victorialogs-export');

      setFeedback({
        kind: result.truncatedByMax ? 'warning' : 'success',
        text: result.truncatedByMax
          ? `Exported ${exportedCount.toLocaleString()} logs (safety cap ${maxRows.toLocaleString()} reached). Narrow the time window or query to download older logs.`
          : `Stream-exported ${exportedCount.toLocaleString()} log record${exportedCount === 1 ? '' : 's'} as ${format.toUpperCase()}.`,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setFeedback({ kind: 'warning', text: 'Log export cancelled.' });
      } else {
        setFeedback({
          kind: 'error',
          text: `Export failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    } finally {
      exportAbortRef.current = null;
      setExportingLogs(false);
      setExportProgressCount(0);
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
            borderBottom: `1px solid ${muiTheme.palette.surface.borderSubtle}`,
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            flexWrap: 'wrap',
          }}
        >
          <Tabs
            value={activeTab.id}
            onChange={(_, val: string) => {
              const nextTab = tabs.find((t) => t.id === val);
              setActiveTabId(val);
              setDebouncedQuery(nextTab?.query ?? '*');
              setCursorStack([]);
              setPage(0);
            }}
            sx={{ minHeight: 40, '& .MuiTab-root': { minHeight: 40, py: 0.5, px: 1.5, fontSize: 13 } }}
          >
            {tabs.map((tab) => (
              <Tab
                key={tab.id}
                value={tab.id}
                label={
                  editingTabId === tab.id ? (
                    <TextField
                      size="small"
                      autoFocus
                      value={editingTabLabel}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setEditingTabLabel(e.target.value)}
                      onBlur={() => commitTabRename(tab.id)}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === 'Enter') commitTabRename(tab.id);
                        if (e.key === 'Escape') setEditingTabId(null);
                      }}
                      sx={{ width: 110, '& .MuiInputBase-input': { py: 0.25, px: 0.75, fontSize: 12 } }}
                    />
                  ) : (
                    <Stack
                      direction="row"
                      spacing={0.5}
                      alignItems="center"
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        setEditingTabId(tab.id);
                        setEditingTabLabel(tab.label);
                      }}
                    >
                      <span>{tab.label}</span>
                      <Tooltip title="Rename tab (or double-click)">
                        <Box
                          component="span"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingTabId(tab.id);
                            setEditingTabLabel(tab.label);
                          }}
                          sx={{ display: 'inline-flex', opacity: 0.65, '&:hover': { opacity: 1 }, cursor: 'pointer' }}
                        >
                          <PencilOutline sx={{ fontSize: 13 }} />
                        </Box>
                      </Tooltip>
                      {tabs.length > 1 && (
                        <Tooltip title="Close tab">
                          <Box
                            component="span"
                            onClick={(e) => {
                              e.stopPropagation();
                              closeTab(tab.id);
                            }}
                            sx={{ display: 'inline-flex', opacity: 0.65, '&:hover': { opacity: 1 }, cursor: 'pointer' }}
                          >
                            <Close sx={{ fontSize: 13 }} />
                          </Box>
                        </Tooltip>
                      )}
                    </Stack>
                  )
                }
              />
            ))}
          </Tabs>
          <Tooltip title="Add new query tab">
            <IconButton size="small" onClick={addTab} sx={{ ml: 0.5 }}>
              <Plus fontSize="small" />
            </IconButton>
          </Tooltip>
          <Box sx={{ flexGrow: 1 }} />
          <Stack direction="row" spacing={1} alignItems="center" sx={{ py: 0.5 }}>
            <VictoriaLogsBrandIcon size={16} />
            <FormControl size="small" sx={{ minWidth: 185 }}>
              <Select
                value={selectedTargetKey}
                onChange={(e) => {
                  setSelectedTargetKey(e.target.value);
                  setCursorStack([]);
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
                  setDebouncedQuery(preset.query);
                  setCursorStack([]);
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
                border: `1px solid ${muiTheme.palette.surface.borderSubtle}`,
                borderRadius: 1.5,
                overflow: 'hidden',
                bgcolor: muiTheme.palette.surface.bgSurface,
              }}
            >
              <Box
                sx={{
                  px: 1.5,
                  py: 0.9,
                  bgcolor: muiTheme.palette.surface.bgSubtle,
                  borderRight: `1px solid ${muiTheme.palette.surface.borderSubtle}`,
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
                  setCursorStack([]);
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
              disabled={fetchingLogs || liveMode}
              sx={{ px: 3 }}
            >
              {fetchingLogs ? 'Querying...' : 'Query'}
            </Button>

            <Button
              variant={liveMode ? 'contained' : 'outlined'}
              color={liveMode ? 'success' : 'inherit'}
              onClick={() => {
                setLiveMode((prev) => {
                  const next = !prev;
                  if (next) {
                    setAutoScroll(true);
                    setLiveError(null);
                    setSelectedLogIndex(null);
                    setExpandedRows({});
                  }
                  return next;
                });
              }}
              startIcon={
                <Box
                  component="span"
                  sx={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    bgcolor: liveMode ? '#FFFFFF' : '#22C55E',
                    ...(liveMode && {
                      '@keyframes livePulse': {
                        '0%, 100%': { opacity: 1, transform: 'scale(1)' },
                        '50%': { opacity: 0.4, transform: 'scale(1.35)' },
                      },
                      animation: 'livePulse 1.2s ease-in-out infinite',
                    }),
                  }}
                />
              }
              sx={{ px: 2, whiteSpace: 'nowrap' }}
            >
              {liveMode ? 'Live (ON)' : 'Live'}
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
          <LogsHistogramChart
            buckets={effectiveBuckets}
            groupBuckets={groupHistogramData?.buckets}
            groupSeriesKeys={groupHistogramData?.seriesKeys}
            groupBy={histogramGroupBy}
            onChangeGroupBy={setHistogramGroupBy}
            levelTotals={levelTotals}
            maxBucketCount={maxBucketCount}
            startLabel={formatFullTs(startDate)}
            endLabel={formatFullTs(endDate)}
            showChart={showChart}
            onToggleShowChart={() => setShowChart((prev) => !prev)}
            onZoomToBucket={handleZoomToBucket}
          />
        </CardContent>
      </Card>

      {logsError && !liveMode && <Alert severity="error">Log query failed: {logsError.message}</Alert>}
      {liveError && liveMode && <Alert severity="warning">Live tail poll warning: {liveError}</Alert>}

      {/* Results Toolbar + Log Stream Table */}
      <Card>
        <Box
          sx={{
            px: 2,
            py: 1,
            borderBottom: `1px solid ${muiTheme.palette.surface.borderSubtle}`,
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

          <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap">
            {liveMode && (
              <>
                <Chip
                  size="small"
                  color="success"
                  variant="outlined"
                  label={`Live Tail · ${entries.length.toLocaleString()} / ${MAX_LIVE_BUFFER_LINES.toLocaleString()} FIFO`}
                  sx={{ height: 24, fontSize: 11, fontFamily: 'monospace' }}
                />
                {!autoScroll && (
                  <Button
                    size="small"
                    variant="contained"
                    color="warning"
                    startIcon={<ArrowDown fontSize="small" />}
                    onClick={handleResumeLiveScroll}
                    sx={{ py: 0.35, fontSize: 12 }}
                  >
                    Resume Live Scroll
                  </Button>
                )}
                <Button
                  size="small"
                  variant="outlined"
                  color="inherit"
                  startIcon={<DeleteSweep fontSize="small" />}
                  onClick={handleClearLiveLogs}
                  disabled={entries.length === 0}
                  sx={{ py: 0.35, fontSize: 12 }}
                >
                  Clear
                </Button>
              </>
            )}
            {!liveMode && (
              <Typography variant="caption" color="text.secondary">
                Duration : <strong>{logsResult?.durationMs ?? 0} ms</strong>
              </Typography>
            )}
            <Typography variant="caption" color="text.secondary">
              Count : <strong>{entries.length}</strong>
            </Typography>
            <Button
              size="small"
              variant="outlined"
              startIcon={exportingLogs ? <CircularProgress size={14} color="inherit" /> : <Download fontSize="small" />}
              disabled={exportingLogs || !activeTarget}
              onClick={(e) => setExportAnchorEl(e.currentTarget)}
              sx={{ py: 0.35, fontSize: 12 }}
            >
              {exportingLogs
                ? `Exporting${exportProgressCount > 0 ? ` (${exportProgressCount.toLocaleString()})` : '...'}`
                : 'Export'}
            </Button>
            {exportingLogs && (
              <Button
                size="small"
                color="error"
                variant="text"
                onClick={() => exportAbortRef.current?.abort()}
                sx={{ py: 0.35, fontSize: 11.5, minWidth: 0 }}
              >
                Cancel
              </Button>
            )}
            <Menu
              anchorEl={exportAnchorEl}
              open={Boolean(exportAnchorEl)}
              onClose={() => setExportAnchorEl(null)}
            >
              <ListSubheader sx={{ lineHeight: '28px', fontSize: 11 }}>
                Current batch ({entries.length} rows)
              </ListSubheader>
              <MenuItem disabled={entries.length === 0} onClick={() => void handleExportLogs('csv', 'loaded')}>
                Export current as CSV
              </MenuItem>
              <MenuItem disabled={entries.length === 0} onClick={() => void handleExportLogs('json', 'loaded')}>
                Export current as JSON
              </MenuItem>
              <MenuItem disabled={entries.length === 0} onClick={() => void handleExportLogs('jsonl', 'loaded')}>
                Export current as JSONL (NDJSON)
              </MenuItem>
              <ListSubheader sx={{ lineHeight: '28px', fontSize: 11 }}>
                Chunked stream (1,000/batch {'\u2014'} zero timeout)
              </ListSubheader>
              <MenuItem onClick={() => void handleExportLogs('csv', 'stream20k')}>
                Stream up to 20,000 logs as CSV
              </MenuItem>
              <MenuItem onClick={() => void handleExportLogs('json', 'stream20k')}>
                Stream up to 20,000 logs as JSON
              </MenuItem>
              <MenuItem onClick={() => void handleExportLogs('jsonl', 'stream50k')}>
                Stream up to 50,000 logs as JSONL (low RAM)
              </MenuItem>
            </Menu>
          </Stack>
        </Box>

        {!liveMode && loadingLogs ? (
          <Stack alignItems="center" justifyContent="center" spacing={1} sx={{ py: 8 }}>
            <CircularProgress size={26} />
            <Typography variant="caption" color="text.secondary">
              Streaming LogsQL records from {activeTarget.name}...
            </Typography>
          </Stack>
        ) : entries.length === 0 ? (
          <Box sx={{ p: 4, textAlign: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              {liveMode
                ? `Waiting for live logs matching "${effectiveQuery}"...`
                : <>No logs matched query <code>{effectiveQuery}</code> in the selected time range.</>}
            </Typography>
          </Box>
        ) : liveMode ? (
          <Box sx={{ position: 'relative' }}>
            <Box
              ref={liveScrollContainerRef}
              onScroll={handleLiveScroll}
              sx={{
                height: 560,
                overflowY: 'auto',
                overflowX: 'hidden',
                fontFamily: 'monospace',
              }}
            >
              <Box
                sx={{
                  height: `${liveVirtualizer.getTotalSize()}px`,
                  width: '100%',
                  position: 'relative',
                }}
              >
                {liveVirtualizer.getVirtualItems().map((virtualRow) => {
                  const idx = virtualRow.index;
                  const entry = entries[idx];
                  if (!entry) return null;
                  const isSelected = selectedLogIndex === idx;
                  return (
                    <Box
                      key={virtualRow.key}
                      data-index={idx}
                      ref={liveVirtualizer.measureElement}
                      onClick={() => setSelectedLogIndex(idx)}
                      sx={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        transform: `translateY(${virtualRow.start}px)`,
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 1.25,
                        px: 1.5,
                        py: 0.6,
                        cursor: 'pointer',
                        borderBottom: `1px solid ${muiTheme.palette.surface.borderSubtle}`,
                        bgcolor: isSelected ? muiTheme.palette.surface.bgActiveNav : 'transparent',
                        '&:hover': { bgcolor: isSelected ? muiTheme.palette.surface.bgActiveNav : muiTheme.palette.surface.bgHover },
                      }}
                    >
                      {showLineNum && (
                        <Typography
                          variant="caption"
                          sx={{ width: 44, flexShrink: 0, color: 'text.secondary', fontFamily: 'monospace', pt: 0.15 }}
                        >
                          {idx + 1}
                        </Typography>
                      )}
                      <Box sx={{ width: 58, flexShrink: 0, pt: 0.1 }}>
                        <LevelBadge level={entry.severity} />
                      </Box>
                      {showLogTime && (
                        <Typography
                          variant="caption"
                          sx={{ width: 138, flexShrink: 0, fontFamily: 'monospace', color: 'text.secondary', whiteSpace: 'nowrap', pt: 0.15 }}
                        >
                          {formatCompactTs(entry.timestamp)}
                        </Typography>
                      )}
                      {displayMode === 'table' && (
                        <Typography
                          variant="caption"
                          noWrap
                          sx={{ width: 170, flexShrink: 0, fontFamily: 'monospace', color: 'text.secondary', pt: 0.15 }}
                        >
                          {[entry.namespace, entry.pod].filter(Boolean).join(' / ') || '-'}
                        </Typography>
                      )}
                      <Typography
                        variant="caption"
                        sx={{
                          flex: 1,
                          minWidth: 0,
                          fontFamily: 'monospace',
                          fontSize: 12,
                          color: 'text.primary',
                          whiteSpace: lineBreak ? 'pre-wrap' : 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          wordBreak: 'break-word',
                          pt: 0.1,
                        }}
                      >
                        {entry.message || JSON.stringify(entry.labels)}
                      </Typography>
                    </Box>
                  );
                })}
              </Box>
            </Box>

            {!autoScroll && (
              <Box
                sx={{
                  position: 'absolute',
                  bottom: 14,
                  right: 20,
                  zIndex: 4,
                }}
              >
                <Button
                  size="small"
                  variant="contained"
                  color="warning"
                  startIcon={<ArrowDown fontSize="small" />}
                  onClick={handleResumeLiveScroll}
                  sx={{ boxShadow: 4 }}
                >
                  Resume Live Scroll
                </Button>
              </Box>
            )}
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
                  const flatRecord = toFlatLogRecord(entry);
                  const extraFields = Object.entries(flatRecord)
                    .filter(([k, v]) => k !== '_time' && k !== '_stream_id' && v !== '')
                    .sort(([a], [b]) => a.localeCompare(b));

                  return (
                    <React.Fragment key={`${entry.timestamp}-${rowNumber}`}>
                      <TableRow
                        hover
                        selected={isSelected}
                        onClick={() => setSelectedLogIndex(globalIndex)}
                        sx={{
                          cursor: 'pointer',
                          '&.Mui-selected': { bgcolor: muiTheme.palette.surface.bgActiveNav },
                        }}
                      >
                        <TableCell sx={{ verticalAlign: 'top', pt: 0.75 }}>
                          <Tooltip title={isExpanded ? 'Collapse inline fields' : 'Expand dropdown fields'}>
                            <IconButton
                              size="small"
                              onClick={(e) => toggleRowExpand(globalIndex, e)}
                              sx={{ fontSize: 12, width: 24, height: 24 }}
                            >
                              {isExpanded ? '\u25BE' : '\u25B8'}
                            </IconButton>
                          </Tooltip>
                        </TableCell>
                        {showLineNum && (
                          <TableCell sx={{ fontFamily: 'monospace', color: 'text.secondary', verticalAlign: 'top', pt: 1 }}>
                            {rowNumber}
                          </TableCell>
                        )}
                        <TableCell sx={{ verticalAlign: 'top', pt: 0.9 }}>
                          <LevelBadge level={entry.severity} />
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
                            {formatCompactTs(entry.timestamp)}
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
                                  border: `1px solid ${muiTheme.palette.surface.borderSubtle}`,
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
                                    bgcolor: muiTheme.palette.surface.bgSubtle,
                                    color: 'text.secondary',
                                    borderRight: `1px solid ${muiTheme.palette.surface.borderSubtle}`,
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
                            sx={{ p: 0, bgcolor: muiTheme.palette.surface.bgSubtle }}
                          >
                            <Box sx={{ px: 3, py: 1.25, borderBottom: `1px solid ${muiTheme.palette.surface.borderSubtle}` }}>
                              <Stack
                                direction="row"
                                justifyContent="space-between"
                                alignItems="center"
                                sx={{ mb: 0.75 }}
                              >
                                <Typography variant="caption" fontWeight={700} color="text.secondary">
                                  Structured Log Fields ({Object.keys(flatRecord).length} fields)
                                </Typography>
                                <Button
                                  size="small"
                                  variant="text"
                                  endIcon={<ArrowRight fontSize="small" />}
                                  onClick={() => setSelectedLogIndex(globalIndex)}
                                  sx={{ fontSize: 11.5, py: 0 }}
                                >
                                  Open Detail Drawer
                                </Button>
                              </Stack>
                              <Table size="small" sx={{ bgcolor: muiTheme.palette.surface.bgSurface, borderRadius: 1 }}>
                                <TableBody>
                                  {Object.entries(flatRecord)
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
                  <TableCell>Message</TableCell>
                  <TableCell width={220}>Stream</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {pagedEntries.map((entry, idx) => {
                  const globalIndex = page * rowsPerPage + idx;
                  return (
                    <TableRow
                      key={`${entry.timestamp}-${idx}`}
                      hover
                      selected={selectedLogIndex === globalIndex}
                      onClick={() => setSelectedLogIndex(globalIndex)}
                      sx={{ cursor: 'pointer' }}
                    >
                      <TableCell>
                        <LevelBadge level={entry.severity} />
                      </TableCell>
                      <TableCell sx={{ fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                        {formatCompactTs(entry.timestamp)}
                      </TableCell>
                      <TableCell sx={{ fontFamily: 'monospace', fontSize: 11.5 }}>
                        {[entry.namespace, entry.pod].filter(Boolean).join(' / ') || '-'}
                      </TableCell>
                      <TableCell sx={{ fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-word' }}>
                        {entry.message}
                      </TableCell>
                      <TableCell sx={{ fontFamily: 'monospace', fontSize: 11, color: 'text.secondary' }}>
                        {entry.stream}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}

        {!liveMode && (
          <Box
            sx={{
              px: 2,
              py: 0.5,
              borderTop: `1px solid ${muiTheme.palette.surface.borderSubtle}`,
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 1,
            }}
          >
          {canCursorPage ? (
            <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap">
              <Chip
                size="small"
                variant="outlined"
                label={`Batch #${cursorStack.length + 1} \u00B7 up to ${LOG_BATCH_SIZE}/slice`}
                sx={{ fontFamily: 'monospace', fontSize: 11 }}
              />
              <Button
                size="small"
                variant="text"
                disabled={cursorStack.length === 0 || fetchingLogs}
                onClick={handleResetToLatestBatch}
              >
                Latest
              </Button>
              <Button
                size="small"
                variant="outlined"
                disabled={cursorStack.length === 0 || fetchingLogs}
                onClick={handleLoadNewerBatch}
                startIcon={<ArrowLeft fontSize="small" />}
              >
                Newer
              </Button>
              <Button
                size="small"
                variant="outlined"
                disabled={!hasOlderBatch || fetchingLogs}
                onClick={handleLoadOlderBatch}
                endIcon={<ArrowRight fontSize="small" />}
              >
                Older
              </Button>
            </Stack>
          ) : (
            <Typography variant="caption" color="text.secondary">
              Custom pipe query active (cursor stepping disabled)
            </Typography>
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
        </Box>
        )}
      </Card>

      <LogsPresetDialogs
        presetDialogOpen={presetDialogOpen}
        onClosePresetDialog={() => setPresetDialogOpen(false)}
        presetMode={presetMode}
        presetLabel={presetLabel}
        onChangePresetLabel={setPresetLabel}
        presetQuery={presetQuery}
        onChangePresetQuery={setPresetQuery}
        presetDesc={presetDesc}
        onChangePresetDesc={setPresetDesc}
        presetSaving={presetSaving}
        presetError={presetError}
        onSavePreset={handleSavePreset}
        managePresetsOpen={managePresetsOpen}
        onCloseManagePresets={() => setManagePresetsOpen(false)}
        presets={presets}
        onEditPreset={openEditPreset}
        onDeletePreset={(preset) => void handleDeletePreset(preset)}
        onAddPreset={openCreatePreset}
      />

      <LogDetailDrawer
        selectedEntry={selectedEntry}
        selectedIndex={selectedLogIndex}
        totalCount={entries.length}
        drawerSize={drawerSize}
        drawerTab={drawerTab}
        copiedJson={copiedJson}
        onClose={() => setSelectedLogIndex(null)}
        onChangeSize={setDrawerSize}
        onChangeTab={setDrawerTab}
        onCopyJson={() => void handleCopyJson()}
        onAppendFieldFilter={appendFieldFilter}
      />
    </Stack>
  );
}
