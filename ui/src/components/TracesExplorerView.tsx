import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Drawer,
  FormControl,
  IconButton,
  InputLabel,
  LinearProgress,
  MenuItem,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useQuery } from '@tanstack/react-query';
import Check from 'mdi-material-ui/Check';
import Close from 'mdi-material-ui/Close';
import ContentCopy from 'mdi-material-ui/ContentCopy';
import Magnify from 'mdi-material-ui/Magnify';
import Plus from 'mdi-material-ui/Plus';
import Refresh from 'mdi-material-ui/Refresh';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  type TraceDetail,
  type TraceSpan,
  datasourceTargetKey,
  fetchTraceById,
  fetchTraceOperations,
  fetchTraceServices,
  searchTraces,
  useDatasourceTargets,
} from '../api/persesClient';
import { PALETTE_TOKENS } from '../theme/persesTheme';

const TIME_RANGES = [
  { label: 'Last 15 minutes', minutes: 15 },
  { label: 'Last 1 hour', minutes: 60 },
  { label: 'Last 6 hours', minutes: 360 },
  { label: 'Last 24 hours', minutes: 1440 },
];

const SERVICE_COLORS = ['#6366F1', '#10B981', '#F59E0B', '#EC4899', '#06B6D4', '#8B5CF6', '#14B8A6'];

function serviceColor(service: string): string {
  let hash = 0;
  for (let i = 0; i < service.length; i++) {
    hash = (hash * 31 + service.charCodeAt(i)) | 0;
  }
  return SERVICE_COLORS[Math.abs(hash) % SERVICE_COLORS.length];
}

function formatDurationUs(us: number): string {
  if (us < 1000) return `${Math.round(us)} µs`;
  if (us < 1_000_000) return `${(us / 1000).toFixed(2)} ms`;
  return `${(us / 1_000_000).toFixed(2)} s`;
}

function formatTraceTime(us: number): string {
  if (!us) return '—';
  const d = new Date(Math.floor(us / 1000));
  if (Number.isNaN(d.getTime())) return '—';
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

export function TracesExplorerView() {
  const muiTheme = useTheme();
  const tokens = PALETTE_TOKENS[muiTheme.palette.mode];
  const navigate = useNavigate();

  const { targets: allDatasources, isLoading: loadingDatasources } = useDatasourceTargets();
  const traceTargets = useMemo(
    () => allDatasources.filter((t) => t.pluginKind === 'JaegerDatasource' || t.pluginKind === 'TempoDatasource'),
    [allDatasources],
  );

  const [selectedTargetKey, setSelectedTargetKey] = useState<string>('');
  useEffect(() => {
    if (traceTargets.length === 0) {
      setSelectedTargetKey('');
      return;
    }
    if (!selectedTargetKey || !traceTargets.some((t) => datasourceTargetKey(t) === selectedTargetKey)) {
      setSelectedTargetKey(datasourceTargetKey(traceTargets[0]));
    }
  }, [traceTargets, selectedTargetKey]);

  const activeTarget = useMemo(
    () => traceTargets.find((t) => datasourceTargetKey(t) === selectedTargetKey) ?? traceTargets[0] ?? null,
    [traceTargets, selectedTargetKey],
  );

  const [service, setService] = useState<string>('');
  const [operation, setOperation] = useState<string>('');
  const [minDuration, setMinDuration] = useState<string>('');
  const [maxDuration, setMaxDuration] = useState<string>('');
  const [tags, setTags] = useState<string>('');
  const [rangeMinutes, setRangeMinutes] = useState<number>(60);
  const [limit, setLimit] = useState<number>(20);
  const [searchNonce, setSearchNonce] = useState<number>(1);
  const [page, setPage] = useState<number>(0);
  const [rowsPerPage, setRowsPerPage] = useState<number>(15);

  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [selectedSpan, setSelectedSpan] = useState<TraceSpan | null>(null);
  const [copiedId, setCopiedId] = useState<boolean>(false);

  const { data: services = [], isLoading: loadingServices } = useQuery<string[], Error>({
    queryKey: ['traces', 'services', selectedTargetKey],
    queryFn: () => fetchTraceServices(activeTarget!),
    enabled: Boolean(activeTarget),
  });

  useEffect(() => {
    if (services.length > 0 && (!service || !services.includes(service))) {
      setService(services[0]);
      setOperation('');
    }
  }, [services, service]);

  const { data: operations = [] } = useQuery<string[], Error>({
    queryKey: ['traces', 'operations', selectedTargetKey, service],
    queryFn: () => fetchTraceOperations(activeTarget!, service),
    enabled: Boolean(activeTarget && service),
  });

  const timeBounds = useMemo(() => {
    const end = new Date();
    const start = new Date(end.getTime() - rangeMinutes * 60 * 1000);
    return { startIso: start.toISOString(), endIso: end.toISOString() };
  }, [rangeMinutes, searchNonce]);

  const {
    data: traces = [],
    isInitialLoading: loadingTraces,
    isFetching: fetchingTraces,
    error: tracesError,
  } = useQuery<TraceDetail[], Error>({
    queryKey: [
      'traces',
      'search',
      selectedTargetKey,
      service,
      operation,
      minDuration,
      maxDuration,
      tags,
      rangeMinutes,
      limit,
      searchNonce,
    ],
    queryFn: () =>
      searchTraces(activeTarget!, {
        service: service || undefined,
        operation: operation || undefined,
        startIso: timeBounds.startIso,
        endIso: timeBounds.endIso,
        minDuration,
        maxDuration,
        tags,
        limit,
      }),
    enabled: Boolean(activeTarget && (service || activeTarget.pluginKind === 'TempoDatasource')),
  });

  const selectedTraceSummary = useMemo(
    () => traces.find((t) => t.traceId === selectedTraceId) ?? null,
    [traces, selectedTraceId],
  );

  const { data: fetchedTraceDetail, isFetching: loadingTraceDetail } = useQuery<TraceDetail, Error>({
    queryKey: ['traces', 'detail', selectedTargetKey, selectedTraceId],
    queryFn: () => fetchTraceById(activeTarget!, selectedTraceId!),
    enabled: Boolean(
      activeTarget &&
        selectedTraceId &&
        (!selectedTraceSummary || selectedTraceSummary.spans.length === 0),
    ),
  });

  const activeTraceDetail =
    selectedTraceSummary && selectedTraceSummary.spans.length > 0 ? selectedTraceSummary : fetchedTraceDetail ?? null;

  useEffect(() => {
    if (activeTraceDetail && activeTraceDetail.spans.length > 0) {
      setSelectedSpan(activeTraceDetail.spans[0]);
    } else {
      setSelectedSpan(null);
    }
  }, [activeTraceDetail?.traceId]);

  const maxTraceDurationUs = useMemo(
    () => Math.max(1, ...traces.map((t) => t.durationUs)),
    [traces],
  );

  const pagedTraces = useMemo(() => {
    const start = page * rowsPerPage;
    return traces.slice(start, start + rowsPerPage);
  }, [traces, page, rowsPerPage]);

  const copyTraceId = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 1800);
    } catch {
      // Ignore clipboard issues
    }
  };

  if (!loadingDatasources && traceTargets.length === 0) {
    return (
      <Card>
        <CardContent sx={{ py: 6, textAlign: 'center' }}>
          <Stack spacing={1.5} alignItems="center">
            <Typography variant="subtitle1" fontWeight={700}>
              No Trace Data Source Configured
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 520 }}>
              Add an Apache 2.0 trace backend such as <strong>Jaeger</strong> or <strong>VictoriaTraces</strong>{' '}
              (<code>JaegerDatasource</code>) or <strong>Tempo</strong> (<code>TempoDatasource</code>) in{' '}
              <strong>Integrations → Data sources</strong> to search traces and inspect span waterfalls.
            </Typography>
            <Button variant="contained" startIcon={<Plus />} onClick={() => navigate('/datasources')}>
              Add Trace Data Source
            </Button>
          </Stack>
        </CardContent>
      </Card>
    );
  }

  return (
    <Stack spacing={1.75} sx={{ height: '100%' }}>
      {/* Search Toolbar */}
      <Card>
        <CardContent sx={{ pb: '14px !important' }}>
          <Stack spacing={1.5}>
            <Stack direction={{ xs: 'column', lg: 'row' }} spacing={1.25} alignItems={{ xs: 'stretch', lg: 'center' }}>
              <FormControl size="small" sx={{ minWidth: 210 }}>
                <InputLabel id="trace-ds-label">Trace Data Source</InputLabel>
                <Select
                  labelId="trace-ds-label"
                  label="Trace Data Source"
                  value={selectedTargetKey}
                  onChange={(e) => {
                    setSelectedTargetKey(e.target.value);
                    setService('');
                    setOperation('');
                    setPage(0);
                  }}
                >
                  {traceTargets.map((t) => (
                    <MenuItem key={datasourceTargetKey(t)} value={datasourceTargetKey(t)}>
                      {t.displayName || t.name} ({t.pluginKind.replace('Datasource', '')})
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <FormControl size="small" sx={{ minWidth: 200 }} disabled={loadingServices || services.length === 0}>
                <InputLabel id="trace-service-label">Service</InputLabel>
                <Select
                  labelId="trace-service-label"
                  label="Service"
                  value={service}
                  onChange={(e) => {
                    setService(e.target.value);
                    setOperation('');
                    setPage(0);
                  }}
                >
                  {services.map((svc) => (
                    <MenuItem key={svc} value={svc}>
                      {svc}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <FormControl size="small" sx={{ minWidth: 200 }} disabled={operations.length === 0}>
                <InputLabel id="trace-op-label">Operation</InputLabel>
                <Select
                  labelId="trace-op-label"
                  label="Operation"
                  value={operation}
                  onChange={(e) => {
                    setOperation(e.target.value);
                    setPage(0);
                  }}
                >
                  <MenuItem value="">All Operations</MenuItem>
                  {operations.map((op) => (
                    <MenuItem key={op} value={op}>
                      {op}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <FormControl size="small" sx={{ minWidth: 155 }}>
                <InputLabel id="trace-range-label">Time Range</InputLabel>
                <Select
                  labelId="trace-range-label"
                  label="Time Range"
                  value={rangeMinutes}
                  onChange={(e) => {
                    setRangeMinutes(Number(e.target.value));
                    setPage(0);
                  }}
                >
                  {TIME_RANGES.map((r) => (
                    <MenuItem key={r.minutes} value={r.minutes}>
                      {r.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <Button
                variant="contained"
                startIcon={<Magnify />}
                onClick={() => {
                  setPage(0);
                  setSearchNonce((n) => n + 1);
                }}
                sx={{ flexShrink: 0 }}
              >
                Find Traces
              </Button>
            </Stack>

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25} alignItems="center">
              <TextField
                size="small"
                label="Tags"
                placeholder="e.g. http.status_code=500 error=true"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                fullWidth
              />
              <TextField
                size="small"
                label="Min Duration"
                placeholder="e.g. 10ms"
                value={minDuration}
                onChange={(e) => setMinDuration(e.target.value)}
                sx={{ width: { xs: '100%', sm: 150 } }}
              />
              <TextField
                size="small"
                label="Max Duration"
                placeholder="e.g. 5s"
                value={maxDuration}
                onChange={(e) => setMaxDuration(e.target.value)}
                sx={{ width: { xs: '100%', sm: 150 } }}
              />
              <FormControl size="small" sx={{ width: { xs: '100%', sm: 110 } }}>
                <InputLabel id="trace-limit-label">Limit</InputLabel>
                <Select
                  labelId="trace-limit-label"
                  label="Limit"
                  value={limit}
                  onChange={(e) => setLimit(Number(e.target.value))}
                >
                  {[20, 50, 100].map((val) => (
                    <MenuItem key={val} value={val}>
                      {val}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Tooltip title="Refresh services & traces">
                <IconButton
                  size="small"
                  onClick={() => setSearchNonce((n) => n + 1)}
                  sx={{ border: `1px solid ${tokens.borderSubtle}`, borderRadius: 1 }}
                >
                  <Refresh fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      {tracesError && (
        <Alert severity="error">Failed to query traces: {tracesError.message}</Alert>
      )}

      {/* Trace Results Table */}
      <Card sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {fetchingTraces && <LinearProgress />}
        <TableContainer sx={{ flex: 1, overflowX: 'auto' }}>
          <Table size="small" stickyHeader sx={{ minWidth: 880 }}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ minWidth: 140 }}>Trace ID</TableCell>
                <TableCell sx={{ minWidth: 260 }}>Root Service &amp; Operation</TableCell>
                <TableCell sx={{ minWidth: 180 }}>Services</TableCell>
                <TableCell sx={{ width: 90 }}>Spans</TableCell>
                <TableCell sx={{ minWidth: 180 }}>Duration</TableCell>
                <TableCell sx={{ minWidth: 165, whiteSpace: 'nowrap' }}>Start Time</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loadingTraces ? (
                <TableRow>
                  <TableCell colSpan={6} align="center" sx={{ py: 6 }}>
                    <CircularProgress size={26} />
                  </TableCell>
                </TableRow>
              ) : pagedTraces.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} align="center" sx={{ py: 6 }}>
                    <Typography variant="body2" color="text.secondary">
                      {services.length === 0
                        ? 'No services reported by this trace backend yet.'
                        : 'No traces matched the selected filters in this time range.'}
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                pagedTraces.map((tr) => {
                  const pct = Math.max(4, Math.round((tr.durationUs / maxTraceDurationUs) * 100));
                  return (
                    <TableRow
                      key={tr.traceId}
                      hover
                      onClick={() => setSelectedTraceId(tr.traceId)}
                      sx={{ cursor: 'pointer' }}
                    >
                      <TableCell>
                        <Typography variant="caption" sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
                          {tr.traceId.slice(0, 12)}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Box
                            sx={{
                              width: 8,
                              height: 8,
                              borderRadius: '50%',
                              bgcolor: serviceColor(tr.rootService),
                              flexShrink: 0,
                            }}
                          />
                          <Box sx={{ minWidth: 0 }}>
                            <Typography variant="body2" fontWeight={600} noWrap>
                              {tr.rootService}: {tr.rootOperation}
                            </Typography>
                          </Box>
                          {tr.errorCount > 0 && (
                            <Chip
                              size="small"
                              color="error"
                              label={`${tr.errorCount} err`}
                              sx={{ height: 18, fontSize: 10.5 }}
                            />
                          )}
                        </Stack>
                      </TableCell>
                      <TableCell>
                        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                          {tr.services.slice(0, 3).map((s) => (
                            <Chip
                              key={s}
                              size="small"
                              variant="outlined"
                              label={s}
                              sx={{ height: 20, fontSize: 11, borderColor: serviceColor(s) }}
                            />
                          ))}
                          {tr.services.length > 3 && (
                            <Chip size="small" label={`+${tr.services.length - 3}`} sx={{ height: 20, fontSize: 11 }} />
                          )}
                        </Stack>
                      </TableCell>
                      <TableCell>
                        <Chip size="small" variant="outlined" label={tr.spanCount} sx={{ height: 20, fontSize: 11 }} />
                      </TableCell>
                      <TableCell>
                        <Stack spacing={0.25}>
                          <Typography variant="caption" fontWeight={600} sx={{ fontFamily: 'monospace' }}>
                            {formatDurationUs(tr.durationUs)}
                          </Typography>
                          <LinearProgress
                            variant="determinate"
                            value={pct}
                            color={tr.errorCount > 0 ? 'error' : 'primary'}
                            sx={{ height: 5, borderRadius: 1 }}
                          />
                        </Stack>
                      </TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>
                        <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                          {formatTraceTime(tr.startTimeUs)}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </TableContainer>

        <TablePagination
          component="div"
          count={traces.length}
          page={page}
          onPageChange={(_, p) => setPage(p)}
          rowsPerPage={rowsPerPage}
          onRowsPerPageChange={(e) => {
            setRowsPerPage(parseInt(e.target.value, 10));
            setPage(0);
          }}
          rowsPerPageOptions={[15, 30, 50]}
        />
      </Card>

      {/* Span Waterfall Detail Drawer */}
      <Drawer
        anchor="right"
        open={Boolean(selectedTraceId)}
        onClose={() => setSelectedTraceId(null)}
        PaperProps={{ sx: { width: { xs: '100%', md: '74%' }, maxWidth: 1120 } }}
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <Box
            sx={{
              px: 2.5,
              py: 1.75,
              borderBottom: `1px solid ${tokens.borderSubtle}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 1.5,
            }}
          >
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="subtitle1" fontWeight={700} noWrap>
                {activeTraceDetail
                  ? `${activeTraceDetail.rootService}: ${activeTraceDetail.rootOperation}`
                  : `Trace ${selectedTraceId}`}
              </Typography>
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
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
                      onClick={() => void copyTraceId(selectedTraceId)}
                    >
                      {copiedId ? 'Copied' : 'Copy ID'}
                    </Button>
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<Magnify fontSize="small" />}
                      onClick={() => navigate(`/explore/logs?query=${encodeURIComponent(selectedTraceId)}`)}
                    >
                      Search in Logs
                    </Button>
                  </>
                )}
              </Stack>
            </Box>
            <IconButton onClick={() => setSelectedTraceId(null)}>
              <Close />
            </IconButton>
          </Box>

          {loadingTraceDetail ? (
            <Stack alignItems="center" justifyContent="center" sx={{ flex: 1 }}>
              <CircularProgress />
            </Stack>
          ) : !activeTraceDetail || activeTraceDetail.spans.length === 0 ? (
            <Box sx={{ p: 3 }}>
              <Alert severity="info">
                Span waterfall details are not available for this trace (Tempo search summaries require clicking a trace
                ID supported by `/api/traces/{'{traceId}'}`).
              </Alert>
            </Box>
          ) : (
            <Box sx={{ flex: 1, overflowY: 'auto', p: 2.5 }}>
              <Stack spacing={2}>
                {/* Waterfall Timeline */}
                <Box
                  sx={{
                    border: `1px solid ${tokens.borderSubtle}`,
                    borderRadius: 1.5,
                    overflow: 'hidden',
                  }}
                >
                  {activeTraceDetail.spans.map((span) => {
                    const totalUs = Math.max(1, activeTraceDetail.durationUs);
                    const leftPct = Math.min(98, (span.relativeStartUs / totalUs) * 100);
                    const widthPct = Math.max(1.2, Math.min(100 - leftPct, (span.durationUs / totalUs) * 100));
                    const isSelected = selectedSpan?.spanId === span.spanId;
                    const color = span.hasError ? '#EF4444' : serviceColor(span.serviceName);

                    return (
                      <Box
                        key={span.spanId}
                        onClick={() => setSelectedSpan(span)}
                        sx={{
                          display: 'grid',
                          gridTemplateColumns: { xs: '1fr', sm: '300px 1fr 84px' },
                          alignItems: 'center',
                          gap: 1,
                          px: 1.5,
                          py: 0.75,
                          cursor: 'pointer',
                          borderBottom: `1px solid ${tokens.borderSubtle}`,
                          bgcolor: isSelected ? tokens.bgSubtle : 'transparent',
                          '&:hover': { bgcolor: tokens.bgSubtle },
                        }}
                      >
                        <Box sx={{ pl: Math.min(span.depth * 1.75, 10), minWidth: 0 }}>
                          <Stack direction="row" spacing={0.75} alignItems="center">
                            <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: color, flexShrink: 0 }} />
                            <Typography variant="caption" fontWeight={700} noWrap>
                              {span.serviceName}
                            </Typography>
                            <Typography variant="caption" color="text.secondary" noWrap>
                              {span.operationName}
                            </Typography>
                          </Stack>
                        </Box>

                        <Box sx={{ position: 'relative', height: 14, bgcolor: tokens.bgSubtle, borderRadius: 0.75 }}>
                          <Box
                            sx={{
                              position: 'absolute',
                              left: `${leftPct}%`,
                              width: `${widthPct}%`,
                              top: 2,
                              bottom: 2,
                              bgcolor: color,
                              borderRadius: 0.5,
                            }}
                          />
                        </Box>

                        <Typography
                          variant="caption"
                          align="right"
                          sx={{ fontFamily: 'monospace', fontWeight: 600, color: span.hasError ? 'error.main' : 'text.secondary' }}
                        >
                          {formatDurationUs(span.durationUs)}
                        </Typography>
                      </Box>
                    );
                  })}
                </Box>

                {/* Selected Span Attributes */}
                {selectedSpan && (
                  <Card variant="outlined">
                    <CardContent>
                      <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
                        Span Details: {selectedSpan.serviceName} · {selectedSpan.operationName}
                      </Typography>
                      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1.5 }}>
                        <Chip size="small" label={`Span ID: ${selectedSpan.spanId}`} sx={{ fontFamily: 'monospace', fontSize: 11 }} />
                        {selectedSpan.parentSpanId && (
                          <Chip size="small" label={`Parent: ${selectedSpan.parentSpanId}`} sx={{ fontFamily: 'monospace', fontSize: 11 }} />
                        )}
                        <Chip size="small" label={`Offset: +${formatDurationUs(selectedSpan.relativeStartUs)}`} sx={{ fontSize: 11 }} />
                        <Chip size="small" label={`Duration: ${formatDurationUs(selectedSpan.durationUs)}`} sx={{ fontSize: 11 }} />
                      </Stack>

                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell sx={{ width: 240 }}>Attribute</TableCell>
                            <TableCell>Value</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {[...selectedSpan.tags, ...selectedSpan.processTags].length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={2}>
                                <Typography variant="caption" color="text.secondary">
                                  No tags or resource attributes recorded on this span.
                                </Typography>
                              </TableCell>
                            </TableRow>
                          ) : (
                            [...selectedSpan.tags, ...selectedSpan.processTags].map((tag, idx) => (
                              <TableRow key={`${tag.key}-${idx}`}>
                                <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{tag.key}</TableCell>
                                <TableCell sx={{ fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all' }}>
                                  {tag.value}
                                </TableCell>
                              </TableRow>
                            ))
                          )}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                )}
              </Stack>
            </Box>
          )}
        </Box>
      </Drawer>
    </Stack>
  );
}
