import {
  Box,
  Button,
  Chip,
  Drawer,
  IconButton,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableRow,
  Tabs,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';

import type { LogLevel, VictoriaLogEntry } from '@/api/persesClient';
import { classifyLogLevel } from '@/api/persesClient';
import { JsonViewer } from '@/components/ui/JsonViewer';
import { LOG_LEVEL_META } from './LogsHistogramChart';

function formatDrawerWidth(size: 'small' | 'medium' | 'large'): string {
  if (size === 'small') return '440px';
  if (size === 'large') return '820px';
  return '620px';
}

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

function LevelBadge({ level }: { level: LogLevel }) {
  const meta = LOG_LEVEL_META[level];
  return (
    <Chip
      size="small"
      label={meta.short}
      sx={{
        height: 20,
        fontSize: 10.5,
        fontWeight: 700,
        fontFamily: 'monospace',
        bgcolor: `${meta.color}1A`,
        color: meta.color,
        border: `1px solid ${meta.color}4D`,
      }}
    />
  );
}

export interface LogDetailDrawerProps {
  selectedEntry: VictoriaLogEntry | null;
  selectedIndex: number | null;
  totalCount: number;
  drawerSize: 'small' | 'medium' | 'large';
  drawerTab: 'table' | 'json';
  copiedJson: boolean;
  onClose: () => void;
  onChangeSize: (size: 'small' | 'medium' | 'large') => void;
  onChangeTab: (tab: 'table' | 'json') => void;
  onCopyJson: () => void;
  onAppendFieldFilter: (field: string, value: string) => void;
}

export function LogDetailDrawer({
  selectedEntry,
  selectedIndex,
  totalCount,
  drawerSize,
  drawerTab,
  copiedJson,
  onClose,
  onChangeSize,
  onChangeTab,
  onCopyJson,
  onAppendFieldFilter,
}: LogDetailDrawerProps) {
  const theme = useTheme();

  return (
    <Drawer
      anchor="right"
      open={Boolean(selectedEntry)}
      onClose={onClose}
      PaperProps={{
        sx: {
          width: { xs: '100vw', sm: formatDrawerWidth(drawerSize) },
          maxWidth: '100vw',
          bgcolor: theme.palette.surface.bgSurface,
          display: 'flex',
          flexDirection: 'column',
        },
      }}
    >
      {selectedEntry && (
        <>
          <Box
            sx={{
              px: 2.5,
              py: 1.5,
              borderBottom: `1px solid ${theme.palette.surface.borderSubtle}`,
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
                  if (val) onChangeSize(val);
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
              <IconButton size="small" onClick={onClose} aria-label="Close detail drawer">
                ✕
              </IconButton>
            </Stack>
          </Box>

          <Box sx={{ flex: 1, overflowY: 'auto', p: 2.5 }}>
            <Stack spacing={1.25} sx={{ mb: 2 }}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
                <Box
                  sx={{
                    flex: 1,
                    p: 1.25,
                    borderRadius: 1,
                    border: `1px solid ${theme.palette.surface.borderSubtle}`,
                    bgcolor: theme.palette.surface.bgSubtle,
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
                    border: `1px solid ${theme.palette.surface.borderSubtle}`,
                    bgcolor: theme.palette.surface.bgSubtle,
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
                    border: `1px solid ${theme.palette.surface.borderSubtle}`,
                    bgcolor: theme.palette.surface.bgSubtle,
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
                    border: `1px solid ${theme.palette.surface.borderSubtle}`,
                    bgcolor: theme.palette.surface.bgSubtle,
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
                borderBottom: `1px solid ${theme.palette.surface.borderSubtle}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                mb: 1.25,
              }}
            >
              <Tabs
                value={drawerTab}
                onChange={(_, v: 'table' | 'json') => onChangeTab(v)}
                sx={{ minHeight: 36, '& .MuiTab-root': { minHeight: 36, py: 0.5, fontSize: 13 } }}
              >
                <Tab value="table" label="Table" />
                <Tab value="json" label="JSON" />
              </Tabs>

              <Button size="small" variant="text" onClick={onCopyJson} sx={{ fontSize: 12 }}>
                {copiedJson ? '✓ Copied!' : '❐ Copy to clipboard'}
              </Button>
            </Box>

            {drawerTab === 'table' ? (
              <Table size="small" sx={{ tableLayout: 'fixed', width: '100%' }}>
                <TableBody>
                  {Object.entries(selectedEntry)
                    .filter(([k]) => !k.startsWith('_'))
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([k, v]) => (
                      <TableRow key={k} hover>
                        <TableCell
                          sx={{
                            width: '38%',
                            fontFamily: 'monospace',
                            fontSize: 12,
                            color: 'text.secondary',
                            verticalAlign: 'top',
                            wordBreak: 'break-word',
                            overflowWrap: 'anywhere',
                          }}
                        >
                          {k}
                        </TableCell>
                        <TableCell
                          sx={{
                            width: '62%',
                            fontFamily: 'monospace',
                            fontSize: 12,
                            wordBreak: 'break-word',
                            overflowWrap: 'anywhere',
                            whiteSpace: 'pre-wrap',
                          }}
                        >
                          <Stack direction="row" spacing={1} alignItems="flex-start" justifyContent="space-between">
                            <Box component="span" sx={{ minWidth: 0, flex: 1, overflowWrap: 'anywhere' }}>
                              {String(v)}
                            </Box>
                            <Tooltip title={`Filter by ${k}:="${String(v)}"`}>
                              <Chip
                                size="small"
                                label="+ filter"
                                variant="outlined"
                                onClick={() => onAppendFieldFilter(k, String(v))}
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
              <JsonViewer value={selectedEntry} title="Log Record JSON" maxHeight="100%" />
            )}
          </Box>

          <Box
            sx={{
              px: 2.5,
              py: 1,
              borderTop: `1px solid ${theme.palette.surface.borderSubtle}`,
              bgcolor: theme.palette.surface.bgSubtle,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11.5 }}>
              Use ↑ / ↓ to view previous/next log, Esc to close
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace', fontSize: 11.5 }}>
              {selectedIndex !== null ? `${selectedIndex + 1} / ${totalCount}` : ''}
            </Typography>
          </Box>
        </>
      )}
    </Drawer>
  );
}
