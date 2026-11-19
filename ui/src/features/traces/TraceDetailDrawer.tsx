import {
  Alert,
  Box,
  Button,
  Chip,
  Drawer,
  IconButton,
  InputAdornment,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import AlertCircle from 'mdi-material-ui/AlertCircle';
import Check from 'mdi-material-ui/Check';
import ChevronDown from 'mdi-material-ui/ChevronDown';
import ChevronRight from 'mdi-material-ui/ChevronRight';
import Close from 'mdi-material-ui/Close';
import ContentCopy from 'mdi-material-ui/ContentCopy';
import Magnify from 'mdi-material-ui/Magnify';
import { useEffect, useMemo, useState } from 'react';

import type { TraceDetail, TraceSpan, TraceTag } from './api/traces';
import { ViewLoadingState } from '@/components/ui/ViewStates';

export interface TraceDetailDrawerProps {
  selectedTraceId: string | null;
  activeTraceDetail: TraceDetail | null | undefined;
  loadingTraceDetail: boolean;
  selectedSpan: TraceSpan | null;
  copiedId: boolean;
  formatDurationUs: (us: number) => string;
  serviceColor: (serviceName: string) => string;
  onClose: () => void;
  onSelectSpan: (span: TraceSpan) => void;
  onCopyTraceId: (traceId: string) => void;
  onSearchInLogs: (traceId: string) => void;
}

type InspectorTab = 'attributes' | 'resource' | 'events' | 'json';

function TagKeyValueTable({ tags, emptyMessage }: { tags: TraceTag[]; emptyMessage: string }) {
  if (tags.length === 0) {
    return (
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', py: 1.5 }}>
        {emptyMessage}
      </Typography>
    );
  }
  return (
    <Table size="small" sx={{ '& td, & th': { py: 0.65, px: 1 } }}>
      <TableHead>
        <TableRow>
          <TableCell sx={{ width: '42%', fontSize: 11, fontWeight: 700 }}>Key</TableCell>
          <TableCell sx={{ fontSize: 11, fontWeight: 700 }}>Value</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {tags.map((tag, idx) => (
          <TableRow key={`${tag.key}-${idx}`} hover>
            <TableCell sx={{ fontFamily: 'monospace', fontSize: 11.5, color: 'text.secondary', wordBreak: 'break-word' }}>
              {tag.key}
            </TableCell>
            <TableCell sx={{ fontFamily: 'monospace', fontSize: 11.5, wordBreak: 'break-word' }}>
              {tag.value}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function TraceDetailDrawer({
  selectedTraceId,
  activeTraceDetail,
  loadingTraceDetail,
  selectedSpan,
  copiedId,
  formatDurationUs,
  serviceColor,
  onClose,
  onSelectSpan,
  onCopyTraceId,
  onSearchInLogs,
}: TraceDetailDrawerProps) {
  const muiTheme = useTheme();
  const [spanSearch, setSpanSearch] = useState('');
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [serviceFilter, setServiceFilter] = useState<string | null>(null);
  const [collapsedSpanIds, setCollapsedSpanIds] = useState<Set<string>>(new Set());
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('attributes');
  const [copiedJson, setCopiedJson] = useState(false);

  useEffect(() => {
    setSpanSearch('');
    setErrorsOnly(false);
    setServiceFilter(null);
    setCollapsedSpanIds(new Set());
    setInspectorTab('attributes');
    setCopiedJson(false);
  }, [selectedTraceId]);

  const spans = activeTraceDetail?.spans ?? [];

  const serviceCounts = useMemo(() => {
    const counts = new Map<string, { total: number; errors: number }>();
    for (const s of spans) {
      const prev = counts.get(s.serviceName) ?? { total: 0, errors: 0 };
      prev.total += 1;
      if (s.hasError) prev.errors += 1;
      counts.set(s.serviceName, prev);
    }
    return Array.from(counts.entries());
  }, [spans]);

  const { childrenCountById, parentMap } = useMemo(() => {
    const childrenMap = new Map<string, number>();
    const parents = new Map<string, string>();
    const ids = new Set(spans.map((s) => s.spanId));
    for (const s of spans) {
      if (s.parentSpanId && ids.has(s.parentSpanId) && s.parentSpanId !== s.spanId) {
        parents.set(s.spanId, s.parentSpanId);
        childrenMap.set(s.parentSpanId, (childrenMap.get(s.parentSpanId) ?? 0) + 1);
      }
    }
    return { childrenCountById: childrenMap, parentMap: parents };
  }, [spans]);

  const hasActiveFilter = Boolean(spanSearch.trim() || errorsOnly || serviceFilter);

  const visibleSpans = useMemo(() => {
    const q = spanSearch.trim().toLowerCase();
    if (hasActiveFilter) {
      return spans.filter((s) => {
        if (errorsOnly && !s.hasError) return false;
        if (serviceFilter && s.serviceName !== serviceFilter) return false;
        if (!q) return true;
        if (
          s.serviceName.toLowerCase().includes(q) ||
          s.operationName.toLowerCase().includes(q) ||
          s.spanId.toLowerCase().includes(q)
        ) {
          return true;
        }
        return (
          s.tags.some((t) => t.key.toLowerCase().includes(q) || t.value.toLowerCase().includes(q)) ||
          s.processTags.some((t) => t.key.toLowerCase().includes(q) || t.value.toLowerCase().includes(q))
        );
      });
    }

    return spans.filter((s) => {
      let cur = parentMap.get(s.spanId);
      while (cur) {
        if (collapsedSpanIds.has(cur)) return false;
        cur = parentMap.get(cur);
      }
      return true;
    });
  }, [collapsedSpanIds, errorsOnly, hasActiveFilter, parentMap, serviceFilter, spanSearch, spans]);

  const toggleCollapse = (spanId: string) => {
    setCollapsedSpanIds((prev) => {
      const next = new Set(prev);
      if (next.has(spanId)) next.delete(spanId);
      else next.add(spanId);
      return next;
    });
  };

  const expandAll = () => setCollapsedSpanIds(new Set());
  const collapseAll = () => {
    const allParents = new Set<string>();
    for (const [id, count] of childrenCountById.entries()) {
      if (count > 0) allParents.add(id);
    }
    setCollapsedSpanIds(allParents);
  };

  const totalUs = Math.max(1, activeTraceDetail?.durationUs ?? 1);
  const rulerTicks = [0, 0.25, 0.5, 0.75, 1];

  const handleCopyJson = async () => {
    if (!selectedSpan) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(selectedSpan, null, 2));
      setCopiedJson(true);
      setTimeout(() => setCopiedJson(false), 1500);
    } catch {
      // Clipboard may be unavailable in non-HTTPS contexts
    }
  };

  return (
    <Drawer
      anchor="right"
      open={Boolean(selectedTraceId)}
      onClose={onClose}
      PaperProps={{ sx: { width: { xs: '100%', lg: '86%' }, maxWidth: 1360 } }}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* Header */}
        <Box
          sx={{
            px: 2.5,
            py: 1.5,
            borderBottom: `1px solid ${muiTheme.palette.surface.borderSubtle}`,
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 1.5,
          }}
        >
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="subtitle1" fontWeight={700} noWrap>
              {activeTraceDetail
                ? `${activeTraceDetail.rootService}: ${activeTraceDetail.rootOperation}`
                : `Trace ${selectedTraceId}`}
            </Typography>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mt: 0.75 }}>
              <Chip
                size="small"
                variant="outlined"
                label={`ID: ${selectedTraceId ?? ''}`}
                sx={{ fontFamily: 'monospace', fontSize: 11 }}
              />
              {activeTraceDetail && (
                <>
                  <Chip
                    size="small"
                    color="primary"
                    variant="outlined"
                    label={`Duration: ${formatDurationUs(activeTraceDetail.durationUs)}`}
                    sx={{ fontSize: 11 }}
                  />
                  <Chip size="small" variant="outlined" label={`${activeTraceDetail.spanCount} spans`} sx={{ fontSize: 11 }} />
                  {activeTraceDetail.errorCount > 0 && (
                    <Chip size="small" color="error" label={`${activeTraceDetail.errorCount} errors`} sx={{ fontSize: 11 }} />
                  )}
                </>
              )}
              {selectedTraceId && (
                <>
                  <Button
                    size="small"
                    startIcon={copiedId ? <Check fontSize="small" /> : <ContentCopy fontSize="small" />}
                    onClick={() => onCopyTraceId(selectedTraceId)}
                  >
                    {copiedId ? 'Copied' : 'Copy ID'}
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<Magnify fontSize="small" />}
                    onClick={() => onSearchInLogs(selectedTraceId)}
                  >
                    Search in Logs
                  </Button>
                </>
              )}
            </Stack>

            {/* Service breakdown chips */}
            {serviceCounts.length > 0 && (
              <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
                <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>
                  Services:
                </Typography>
                {serviceCounts.map(([svc, stats]) => {
                  const active = serviceFilter === svc;
                  const color = serviceColor(svc);
                  return (
                    <Chip
                      key={svc}
                      size="small"
                      variant={active ? 'filled' : 'outlined'}
                      onClick={() => setServiceFilter(active ? null : svc)}
                      icon={<Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: color, ml: 0.75 }} />}
                      label={`${svc} (${stats.total}${stats.errors > 0 ? ` · ${stats.errors} err` : ''})`}
                      sx={{
                        height: 22,
                        fontSize: 11,
                        borderColor: active ? color : muiTheme.palette.surface.borderSubtle,
                        bgcolor: active ? alpha(color, 0.16) : 'transparent',
                      }}
                    />
                  );
                })}
              </Stack>
            )}
          </Box>
          <IconButton onClick={onClose}>
            <Close />
          </IconButton>
        </Box>

        {loadingTraceDetail ? (
          <ViewLoadingState message="Loading trace waterfall..." minHeight="100%" />
        ) : !activeTraceDetail || spans.length === 0 ? (
          <Box sx={{ p: 3 }}>
            <Alert severity="info">
              Span waterfall details are not available for this trace.
            </Alert>
          </Box>
        ) : (
          <Box
            sx={{
              flex: 1,
              minHeight: 0,
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1.45fr) minmax(360px, 1fr)' },
            }}
          >
            {/* Left Pane: Waterfall */}
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                minHeight: 0,
                borderRight: { lg: `1px solid ${muiTheme.palette.surface.borderSubtle}` },
              }}
            >
              {/* Waterfall Filter Toolbar */}
              <Stack
                direction="row"
                spacing={1}
                alignItems="center"
                flexWrap="wrap"
                useFlexGap
                sx={{
                  px: 2,
                  py: 1,
                  borderBottom: `1px solid ${muiTheme.palette.surface.borderSubtle}`,
                  bgcolor: muiTheme.palette.surface.bgSubtle,
                }}
              >
                <TextField
                  size="small"
                  placeholder="Find span, operation, or tag..."
                  value={spanSearch}
                  onChange={(e) => setSpanSearch(e.target.value)}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <Magnify fontSize="small" />
                      </InputAdornment>
                    ),
                    sx: { fontSize: 12, height: 30 },
                  }}
                  sx={{ flex: 1, minWidth: 180 }}
                />
                <Chip
                  size="small"
                  clickable
                  color={errorsOnly ? 'error' : 'default'}
                  variant={errorsOnly ? 'filled' : 'outlined'}
                  icon={<AlertCircle style={{ fontSize: 14 }} />}
                  label={`Errors (${activeTraceDetail.errorCount})`}
                  onClick={() => setErrorsOnly((v) => !v)}
                />
                {!hasActiveFilter && childrenCountById.size > 0 && (
                  <Stack direction="row" spacing={0.5}>
                    <Button size="small" variant="text" onClick={expandAll} sx={{ fontSize: 11, minWidth: 0, px: 1 }}>
                      Expand all
                    </Button>
                    <Button size="small" variant="text" onClick={collapseAll} sx={{ fontSize: 11, minWidth: 0, px: 1 }}>
                      Collapse all
                    </Button>
                  </Stack>
                )}
                <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                  {visibleSpans.length}/{spans.length}
                </Typography>
              </Stack>

              {/* Time Ruler Header */}
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', sm: '300px 1fr 78px' },
                  alignItems: 'center',
                  gap: 1,
                  px: 1.5,
                  py: 0.6,
                  borderBottom: `1px solid ${muiTheme.palette.surface.borderSubtle}`,
                  bgcolor: muiTheme.palette.background.paper,
                }}
              >
                <Typography variant="caption" fontWeight={700} color="text.secondary">
                  Service &amp; Operation
                </Typography>
                <Box sx={{ position: 'relative', height: 16, display: { xs: 'none', sm: 'block' } }}>
                  {rulerTicks.map((ratio) => (
                    <Typography
                      key={ratio}
                      variant="caption"
                      color="text.secondary"
                      sx={{
                        position: 'absolute',
                        left: `${ratio * 100}%`,
                        transform:
                          ratio === 0 ? 'none' : ratio === 1 ? 'translateX(-100%)' : 'translateX(-50%)',
                        fontSize: 10,
                        fontFamily: 'monospace',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {formatDurationUs(Math.round(totalUs * ratio))}
                    </Typography>
                  ))}
                </Box>
                <Typography variant="caption" fontWeight={700} color="text.secondary" align="right">
                  Duration
                </Typography>
              </Box>

              {/* Span Rows */}
              <Box sx={{ flex: 1, overflowY: 'auto' }}>
                {visibleSpans.length === 0 ? (
                  <Box sx={{ p: 3 }}>
                    <Typography variant="body2" color="text.secondary">
                      No spans match the current filter.
                    </Typography>
                  </Box>
                ) : (
                  visibleSpans.map((span) => {
                    const leftPct = Math.min(98.5, (span.relativeStartUs / totalUs) * 100);
                    const widthPct = Math.max(1.2, Math.min(100 - leftPct, (span.durationUs / totalUs) * 100));
                    const isSelected = selectedSpan?.spanId === span.spanId;
                    const color = span.hasError ? '#EF4444' : serviceColor(span.serviceName);
                    const childCount = childrenCountById.get(span.spanId) ?? 0;
                    const isCollapsed = collapsedSpanIds.has(span.spanId);

                    return (
                      <Box
                        key={span.spanId}
                        onClick={() => onSelectSpan(span)}
                        sx={{
                          display: 'grid',
                          gridTemplateColumns: { xs: '1fr', sm: '300px 1fr 78px' },
                          alignItems: 'center',
                          gap: 1,
                          px: 1.5,
                          py: 0.65,
                          cursor: 'pointer',
                          borderBottom: `1px solid ${muiTheme.palette.surface.borderSubtle}`,
                          borderLeft: isSelected ? `3px solid ${color}` : '3px solid transparent',
                          bgcolor: isSelected ? alpha(color, 0.1) : 'transparent',
                          '&:hover': { bgcolor: isSelected ? alpha(color, 0.14) : muiTheme.palette.surface.bgSubtle },
                        }}
                      >
                        {/* Service + Operation Tree Cell */}
                        <Box
                          sx={{
                            pl: hasActiveFilter ? 0 : Math.min(span.depth * 1.5, 9),
                            minWidth: 0,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 0.5,
                          }}
                        >
                          {!hasActiveFilter && childCount > 0 ? (
                            <IconButton
                              size="small"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleCollapse(span.spanId);
                              }}
                              sx={{ p: 0.25, flexShrink: 0 }}
                            >
                              {isCollapsed ? (
                                <ChevronRight sx={{ fontSize: 15 }} />
                              ) : (
                                <ChevronDown sx={{ fontSize: 15 }} />
                              )}
                            </IconButton>
                          ) : (
                            <Box sx={{ width: 18, flexShrink: 0 }} />
                          )}
                          <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: color, flexShrink: 0 }} />
                          <Typography variant="caption" fontWeight={700} noWrap sx={{ flexShrink: 0, maxWidth: 110 }}>
                            {span.serviceName}
                          </Typography>
                          <Tooltip title={span.operationName}>
                            <Typography variant="caption" color="text.secondary" noWrap sx={{ minWidth: 0, flex: 1 }}>
                              {span.operationName}
                            </Typography>
                          </Tooltip>
                          {!hasActiveFilter && isCollapsed && childCount > 0 && (
                            <Chip
                              size="small"
                              label={`+${childCount}`}
                              sx={{ height: 16, fontSize: 10, '& .MuiChip-label': { px: 0.6 } }}
                            />
                          )}
                        </Box>

                        {/* Waterfall Bar with Vertical Gridlines */}
                        <Box
                          sx={{
                            position: 'relative',
                            height: 18,
                            bgcolor: muiTheme.palette.surface.bgSubtle,
                            borderRadius: 0.75,
                            overflow: 'hidden',
                          }}
                        >
                          {[0.25, 0.5, 0.75].map((ratio) => (
                            <Box
                              key={ratio}
                              sx={{
                                position: 'absolute',
                                left: `${ratio * 100}%`,
                                top: 0,
                                bottom: 0,
                                width: '1px',
                                bgcolor: muiTheme.palette.surface.borderSubtle,
                                opacity: 0.7,
                              }}
                            />
                          ))}
                          <Tooltip
                            title={`${span.serviceName} · ${span.operationName} (${formatDurationUs(span.durationUs)}, offset +${formatDurationUs(span.relativeStartUs)})`}
                          >
                            <Box
                              sx={{
                                position: 'absolute',
                                left: `${leftPct}%`,
                                width: `${widthPct}%`,
                                top: 3,
                                bottom: 3,
                                bgcolor: color,
                                borderRadius: 0.5,
                              }}
                            />
                          </Tooltip>
                        </Box>

                        {/* Duration */}
                        <Typography
                          variant="caption"
                          align="right"
                          sx={{
                            fontFamily: 'monospace',
                            fontWeight: 600,
                            color: span.hasError ? 'error.main' : 'text.secondary',
                          }}
                        >
                          {formatDurationUs(span.durationUs)}
                        </Typography>
                      </Box>
                    );
                  })
                )}
              </Box>
            </Box>

            {/* Right Pane: Tabbed Span Inspector */}
            <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, bgcolor: muiTheme.palette.background.paper }}>
              {!selectedSpan ? (
                <Box sx={{ p: 3 }}>
                  <Typography variant="body2" color="text.secondary">
                    Select any span in the waterfall to inspect its attributes, resource tags, events, and raw JSON.
                  </Typography>
                </Box>
              ) : (
                <>
                  <Box sx={{ p: 2, borderBottom: `1px solid ${muiTheme.palette.surface.borderSubtle}` }}>
                    <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                      <Typography variant="subtitle2" fontWeight={700} noWrap>
                        {selectedSpan.serviceName} · {selectedSpan.operationName}
                      </Typography>
                      <Chip
                        size="small"
                        color={selectedSpan.hasError ? 'error' : 'success'}
                        variant="outlined"
                        label={selectedSpan.hasError ? 'Error' : 'OK'}
                        sx={{ height: 20, fontSize: 10.5 }}
                      />
                    </Stack>
                    <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
                      <Chip size="small" label={`Span: ${selectedSpan.spanId}`} sx={{ fontFamily: 'monospace', fontSize: 10.5 }} />
                      {selectedSpan.parentSpanId && (
                        <Chip
                          size="small"
                          label={`Parent: ${selectedSpan.parentSpanId}`}
                          sx={{ fontFamily: 'monospace', fontSize: 10.5 }}
                        />
                      )}
                      <Chip size="small" label={`Start: +${formatDurationUs(selectedSpan.relativeStartUs)}`} sx={{ fontSize: 10.5 }} />
                      <Chip size="small" label={`Duration: ${formatDurationUs(selectedSpan.durationUs)}`} sx={{ fontSize: 10.5 }} />
                    </Stack>
                  </Box>

                  <Tabs
                    value={inspectorTab}
                    onChange={(_e, val) => setInspectorTab(val as InspectorTab)}
                    variant="scrollable"
                    scrollButtons="auto"
                    sx={{
                      minHeight: 38,
                      px: 1.5,
                      borderBottom: `1px solid ${muiTheme.palette.surface.borderSubtle}`,
                      '& .MuiTab-root': { minHeight: 38, py: 0.5, fontSize: 12, textTransform: 'none' },
                    }}
                  >
                    <Tab value="attributes" label={`Attributes (${selectedSpan.tags.length})`} />
                    <Tab value="resource" label={`Resource (${selectedSpan.processTags.length})`} />
                    <Tab value="events" label={`Events (${selectedSpan.logs?.length ?? 0})`} />
                    <Tab value="json" label="Raw JSON" />
                  </Tabs>

                  <Box sx={{ flex: 1, overflowY: 'auto', p: 2 }}>
                    {inspectorTab === 'attributes' && (
                      <TagKeyValueTable
                        tags={selectedSpan.tags}
                        emptyMessage="No span attributes recorded on this span."
                      />
                    )}

                    {inspectorTab === 'resource' && (
                      <TagKeyValueTable
                        tags={selectedSpan.processTags}
                        emptyMessage="No process/resource attributes recorded on this span."
                      />
                    )}

                    {inspectorTab === 'events' && (
                      !selectedSpan.logs || selectedSpan.logs.length === 0 ? (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', py: 1.5 }}>
                          No span events or logs attached to this span.
                        </Typography>
                      ) : (
                        <Stack spacing={1.5}>
                          {selectedSpan.logs.map((ev, idx) => {
                            const offsetUs = Math.max(0, ev.timestampUs - (activeTraceDetail.startTimeUs || ev.timestampUs));
                            return (
                              <Box
                                key={idx}
                                sx={{
                                  p: 1.25,
                                  borderRadius: 1,
                                  border: `1px solid ${muiTheme.palette.surface.borderSubtle}`,
                                  bgcolor: muiTheme.palette.surface.bgSubtle,
                                }}
                              >
                                <Typography variant="caption" fontWeight={700} sx={{ fontFamily: 'monospace', display: 'block', mb: 0.75 }}>
                                  Event #{idx + 1} · +{formatDurationUs(offsetUs)}
                                </Typography>
                                <TagKeyValueTable tags={ev.fields} emptyMessage="Empty event payload." />
                              </Box>
                            );
                          })}
                        </Stack>
                      )
                    )}

                    {inspectorTab === 'json' && (
                      <Box>
                        <Stack direction="row" justifyContent="flex-end" sx={{ mb: 1 }}>
                          <Button
                            size="small"
                            variant="outlined"
                            startIcon={copiedJson ? <Check fontSize="small" /> : <ContentCopy fontSize="small" />}
                            onClick={handleCopyJson}
                          >
                            {copiedJson ? 'Copied JSON' : 'Copy JSON'}
                          </Button>
                        </Stack>
                        <Box
                          component="pre"
                          sx={{
                            m: 0,
                            p: 1.5,
                            borderRadius: 1,
                            bgcolor: muiTheme.palette.surface.bgSubtle,
                            border: `1px solid ${muiTheme.palette.surface.borderSubtle}`,
                            fontFamily: 'monospace',
                            fontSize: 11,
                            overflowX: 'auto',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                          }}
                        >
                          {JSON.stringify(selectedSpan, null, 2)}
                        </Box>
                      </Box>
                    )}
                  </Box>
                </>
              )}
            </Box>
          </Box>
        )}
      </Box>
    </Drawer>
  );
}
