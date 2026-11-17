import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Drawer,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import Check from 'mdi-material-ui/Check';
import Close from 'mdi-material-ui/Close';
import ContentCopy from 'mdi-material-ui/ContentCopy';
import Magnify from 'mdi-material-ui/Magnify';

import type { TraceDetail, TraceSpan } from '../api/persesClient';
import { ViewLoadingState } from './ViewStates';

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

  return (
    <Drawer
      anchor="right"
      open={Boolean(selectedTraceId)}
      onClose={onClose}
      PaperProps={{ sx: { width: { xs: '100%', md: '74%' }, maxWidth: 1120 } }}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <Box
          sx={{
            px: 2.5,
            py: 1.75,
            borderBottom: `1px solid ${muiTheme.palette.surface.borderSubtle}`,
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
          </Box>
          <IconButton onClick={onClose}>
            <Close />
          </IconButton>
        </Box>

        {loadingTraceDetail ? (
          <ViewLoadingState message="Loading trace waterfall..." minHeight="100%" />
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
                  border: `1px solid ${muiTheme.palette.surface.borderSubtle}`,
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
                      onClick={() => onSelectSpan(span)}
                      sx={{
                        display: 'grid',
                        gridTemplateColumns: { xs: '1fr', sm: '300px 1fr 84px' },
                        alignItems: 'center',
                        gap: 1,
                        px: 1.5,
                        py: 0.75,
                        cursor: 'pointer',
                        borderBottom: `1px solid ${muiTheme.palette.surface.borderSubtle}`,
                        bgcolor: isSelected ? muiTheme.palette.surface.bgSubtle : 'transparent',
                        '&:hover': { bgcolor: muiTheme.palette.surface.bgSubtle },
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

                      <Box sx={{ position: 'relative', height: 14, bgcolor: muiTheme.palette.surface.bgSubtle, borderRadius: 0.75 }}>
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
  );
}
