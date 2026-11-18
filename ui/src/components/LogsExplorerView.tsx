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
import { useVirtualizer } from '@tanstack/react-virtual';
import ArrowDown from 'mdi-material-ui/ArrowDown';
import ArrowLeft from 'mdi-material-ui/ArrowLeft';
import ArrowRight from 'mdi-material-ui/ArrowRight';
import Close from 'mdi-material-ui/Close';
import DeleteOutline from 'mdi-material-ui/DeleteOutline';
import DeleteSweep from 'mdi-material-ui/DeleteSweep';
import Download from 'mdi-material-ui/Download';
import PencilOutline from 'mdi-material-ui/PencilOutline';
import Plus from 'mdi-material-ui/Plus';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import type {
  HistogramGroupBy,
  LogDatasourceAdapter,
  LogLevel,
  LogPresetItem,
  LogQueryResult,
  NormalizedLogEntry,
  VictoriaLogGroupHitBucket,
  VictoriaLogHitBucket,
} from '../api/persesClient';
import {
  ALL_LOG_LEVELS,
  DEFAULT_LOG_PRESETS,
  ForbiddenError,
  buildLogsQLLevelFilter,
  createLogDatasourceAdapter,
  datasourceTargetKey,
  fetchLogPresetsConfig,
  fetchVictoriaLogsChunked,
  hasCustomLimitOrTransformPipe,
  injectLogsQLFilter,
  queryKeys,
  queryVictoriaLogsFieldHistogram,
  queryVictoriaLogsLevelHistogram,
  saveLogPresetsConfig,
  setLocalLogPresets,
  toFlatLogRecord,
  useDatasourceTargets,
} from '../api/persesClient';
import type { ExportFormat } from '../utils/exportRecords';
import { exportRawJsonlLinesToFile, exportRecordsToFile } from '../utils/exportRecords';
import { VictoriaLogsBrandIcon } from './BrandIcons';
import { LogDetailDrawer } from './LogDetailDrawer';
import { LogsHistogramChart } from './LogsHistogramChart';

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

function buildFallbackBuckets(entries: NormalizedLogEntry[], startMs: number, endMs: number): VictoriaLogHitBucket[] {
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
    const t = entry.timestampMs || new Date(entry.timestamp).getTime();
    if (!Number.isFinite(t)) continue;
    const idx = Math.min(bucketCount - 1, Math.max(0, Math.floor((t - startMs) / stepMs)));
    bucketsCounts[idx][entry.severity] += 1;
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

  const LOGS_TABS_STORAGE_KEY = 'perses_logs_query_tabs_v1';

  const [tabs, setTabs] = useState<QueryTabState[]>(() => {
    try {
      const raw = window.localStorage.getItem(LOGS_TABS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { tabs?: QueryTabState[] };
        if (Array.isArray(parsed.tabs) && parsed.tabs.length > 0) {
          const valid = parsed.tabs.filter(
            (t) => t && typeof t.id === 'string' && typeof t.label === 'string' && typeof t.query === 'string',
          );
          if (valid.length > 0) {
            if (initialQuery && initialQuery !== '*') {
              return [{ ...valid[0], query: initialQuery }, ...valid.slice(1)];
            }
            return valid;
          }
        }
      }
    } catch {
      // Ignore malformed localStorage state and fall back to default tab
    }
    return [{ id: 'q1', label: 'Query 1', query: initialQuery, rangeMinutes: 60, selectedLevels: [] }];
  });
  const [activeTabId, setActiveTabId] = useState<string>(() => {
    try {
      const raw = window.localStorage.getItem(LOGS_TABS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { activeTabId?: string; tabs?: QueryTabState[] };
        if (
          typeof parsed.activeTabId === 'string' &&
          Array.isArray(parsed.tabs) &&
          parsed.tabs.some((t) => t?.id === parsed.activeTabId) &&
          (!initialQuery || initialQuery === '*')
        ) {
          return parsed.activeTabId;
        }
      }
    } catch {
      // Fallback to first tab
    }
    return 'q1';
  });
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editingTabLabel, setEditingTabLabel] = useState<string>('');
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

  const LOG_BATCH_SIZE = 200;
  const LIVE_POLL_INTERVAL_MS = 1000;
  const LIVE_FLUSH_INTERVAL_MS = 250;
  const MAX_LIVE_BUFFER_LINES = 2000;

  // Live Tail state & refs
  const [liveMode, setLiveMode] = useState(false);
  const [liveEntries, setLiveEntries] = useState<NormalizedLogEntry[]>([]);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const livePendingBufferRef = useRef<NormalizedLogEntry[]>([]);
  const liveScrollContainerRef = useRef<HTMLDivElement | null>(null);
  const isProgrammaticScrollRef = useRef(false);

  const logAdapter: LogDatasourceAdapter | null = useMemo(
    () => (activeTarget ? createLogDatasourceAdapter(activeTarget) : null),
    [activeTarget],
  );

  const { data: presets = DEFAULT_LOG_PRESETS } = useQuery<LogPresetItem[], Error>({
    queryKey: queryKeys.logPresetsConfig,
    queryFn: fetchLogPresetsConfig,
  });

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];
  const [debouncedQuery, setDebouncedQuery] = useState<string>(activeTab.query);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(activeTab.query);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [activeTab.query, activeTab.id]);

  const updateActiveTab = (patch: Partial<QueryTabState>) => {
    setTabs((prev) => prev.map((t) => (t.id === activeTab.id ? { ...t, ...patch } : t)));
  };

  const addTab = () => {
    const num = tabs.length + 1;
    const id = `q${Date.now()}`;
    setTabs((prev) => [...prev, { id, label: `Query ${num}`, query: '*', rangeMinutes: 60, selectedLevels: [] }]);
    setActiveTabId(id);
    setDebouncedQuery('*');
    setCursorStack([]);
    setPage(0);
    setSelectedLogIndex(null);
    setExpandedRows({});
  };

  const closeTab = (tabId: string) => {
    if (tabs.length <= 1) return;
    const idx = tabs.findIndex((t) => t.id === tabId);
    const nextTabs = tabs.filter((t) => t.id !== tabId);
    setTabs(nextTabs);
    if (activeTabId === tabId) {
      const fallback = nextTabs[Math.max(0, idx - 1)] ?? nextTabs[0];
      setActiveTabId(fallback.id);
      setDebouncedQuery(fallback.query);
      setCursorStack([]);
      setPage(0);
      setSelectedLogIndex(null);
      setExpandedRows({});
    }
    if (editingTabId === tabId) {
      setEditingTabId(null);
    }
  };

  const commitTabRename = (tabId: string) => {
    const trimmed = editingTabLabel.trim();
    if (trimmed) {
      setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, label: trimmed } : t)));
    }
    setEditingTabId(null);
  };

  useEffect(() => {
    try {
      window.localStorage.setItem(LOGS_TABS_STORAGE_KEY, JSON.stringify({ tabs, activeTabId }));
    } catch {
      // Ignore storage quota errors
    }
  }, [tabs, activeTabId]);

  const effectiveQuery = useMemo(() => {
    const levelExpr = buildLogsQLLevelFilter(activeTab.selectedLevels);
    let q = injectLogsQLFilter(debouncedQuery, levelExpr);
    if (lockedNamespace) {
      const escapedNs = lockedNamespace.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      q = injectLogsQLFilter(q, `kubernetes.namespace_name:="${escapedNs}"`);
    }
    return q;
  }, [debouncedQuery, activeTab.selectedLevels, lockedNamespace]);

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

  // Live Tail: 1s incremental delta-polling + 250ms batched UI flush + 2,000-line FIFO ring buffer
  useEffect(() => {
    if (!liveMode || !logAdapter) return;

    setLiveError(null);
    setLiveEntries([]);
    livePendingBufferRef.current = [];

    const handle = logAdapter.startLiveTail({
      query: effectiveQuery,
      pollIntervalMs: LIVE_POLL_INTERVAL_MS,
      initialLookbackSeconds: 60,
      limitPerPoll: 500,
      onEntries: (batch) => {
        if (batch.length > 0) {
          livePendingBufferRef.current.push(...batch);
        }
      },
      onError: (err) => {
        setLiveError(err.message);
      },
    });

    const flushTimer = window.setInterval(() => {
      if (livePendingBufferRef.current.length === 0) return;
      const batch = livePendingBufferRef.current.splice(0);
      setLiveEntries((prev) => {
        const combined = prev.length === 0 ? batch : [...prev, ...batch];
        return combined.length > MAX_LIVE_BUFFER_LINES
          ? combined.slice(combined.length - MAX_LIVE_BUFFER_LINES)
          : combined;
      });
    }, LIVE_FLUSH_INTERVAL_MS);

    return () => {
      handle.stop();
      window.clearInterval(flushTimer);
      livePendingBufferRef.current = [];
    };
  }, [liveMode, logAdapter, effectiveQuery]);

  const entries: NormalizedLogEntry[] = liveMode ? liveEntries : (logsResult?.entries ?? []);
  const pagedEntries = useMemo(() => {
    if (liveMode) return entries;
    const start = page * rowsPerPage;
    return entries.slice(start, start + rowsPerPage);
  }, [entries, page, rowsPerPage, liveMode]);

  const liveVirtualizer = useVirtualizer({
    count: liveMode ? entries.length : 0,
    getScrollElement: () => liveScrollContainerRef.current,
    estimateSize: () => (lineBreak ? 56 : 36),
    overscan: 12,
  });

  useEffect(() => {
    if (!liveMode || !autoScroll || entries.length === 0) return;
    isProgrammaticScrollRef.current = true;
    liveVirtualizer.scrollToIndex(entries.length - 1, { align: 'end' });
    const raf = window.requestAnimationFrame(() => {
      isProgrammaticScrollRef.current = false;
    });
    return () => window.cancelAnimationFrame(raf);
  }, [liveMode, autoScroll, entries, liveVirtualizer]);

  const handleLiveScroll = useCallback(() => {
    if (!liveMode || isProgrammaticScrollRef.current) return;
    const el = liveScrollContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom > 48 && autoScroll) {
      setAutoScroll(false);
    } else if (distanceFromBottom <= 16 && !autoScroll) {
      setAutoScroll(true);
    }
  }, [liveMode, autoScroll]);

  const handleResumeLiveScroll = useCallback(() => {
    setAutoScroll(true);
    if (entries.length > 0) {
      isProgrammaticScrollRef.current = true;
      liveVirtualizer.scrollToIndex(entries.length - 1, { align: 'end' });
      window.requestAnimationFrame(() => {
        isProgrammaticScrollRef.current = false;
      });
    }
  }, [entries.length, liveVirtualizer]);

  const handleClearLiveLogs = useCallback(() => {
    livePendingBufferRef.current = [];
    setLiveEntries([]);
    setExpandedRows({});
    setSelectedLogIndex(null);
  }, []);

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
