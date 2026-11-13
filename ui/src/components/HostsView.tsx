import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Collapse,
  IconButton,
  LinearProgress,
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
import Refresh from 'mdi-material-ui/Refresh';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import type { LiveHostRecord } from '../api/persesClient';
import { fetchLiveClusterHosts } from '../api/persesClient';
import { PALETTE_TOKENS } from '../theme/persesTheme';
import { LinuxBadgeIcon } from './BrandIcons';

function formatUptime(seconds: number | null): string {
  if (seconds === null || seconds < 0) return '-';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  if (days > 0) return `${days}d ${hours}h`;
  const mins = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${mins}m`;
}

function formatGiB(bytes: number | null): string {
  if (!bytes) return '';
  return `${(bytes / 1024 ** 3).toFixed(0)} GiB`;
}

function usageColor(pct: number | null): string {
  if (pct === null) return '#94A3B8';
  if (pct >= 80) return '#EF4444';
  if (pct >= 60) return '#F59E0B';
  return '#22C55E';
}

interface HistogramBucket {
  label: string;
  count: number;
  color: string;
}

function buildUsageHistogram(values: Array<number | null>): HistogramBucket[] {
  const counts = [0, 0, 0, 0, 0, 0];
  for (const v of values) {
    if (v === null || !Number.isFinite(v)) {
      counts[0] += 1;
    } else if (v < 20) {
      counts[1] += 1;
    } else if (v < 40) {
      counts[2] += 1;
    } else if (v < 60) {
      counts[3] += 1;
    } else if (v < 80) {
      counts[4] += 1;
    } else {
      counts[5] += 1;
    }
  }
  return [
    { label: 'Unknown', count: counts[0], color: '#94A3B8' },
    { label: '0-20%', count: counts[1], color: '#86EFAC' },
    { label: '20-40%', count: counts[2], color: '#4ADE80' },
    { label: '40-60%', count: counts[3], color: '#22C55E' },
    { label: '60-80%', count: counts[4], color: '#FB923C' },
    { label: '80%+', count: counts[5], color: '#F87171' },
  ];
}

function MiniHistogramCard({ title, buckets }: { title: string; buckets: HistogramBucket[] }) {
  const maxCount = Math.max(1, ...buckets.map((b) => b.count));

  return (
    <Card sx={{ height: '100%' }}>
      <CardContent sx={{ p: 2, '&:last-child': { pb: 1.5 } }}>
        <Typography variant="caption" color="text.secondary" fontWeight={600} display="block" sx={{ mb: 1.5 }}>
          {title}
        </Typography>
        <Stack direction="row" spacing={1} alignItems="flex-end" sx={{ height: 78, px: 0.5 }}>
          {buckets.map((bucket) => {
            const barHeight = bucket.count > 0 ? Math.max(10, Math.round((bucket.count / maxCount) * 44)) : 2;
            return (
              <Stack key={bucket.label} alignItems="center" sx={{ flex: 1 }} spacing={0.25}>
                <Typography variant="caption" fontSize={11} fontWeight={600} color="text.primary">
                  {bucket.count}
                </Typography>
                <Box
                  sx={{
                    width: '100%',
                    maxWidth: 34,
                    height: barHeight,
                    borderRadius: '3px 3px 0 0',
                    bgcolor: bucket.count > 0 ? bucket.color : 'divider',
                    transition: 'height 0.2s ease',
                  }}
                />
                <Typography variant="caption" fontSize={10} color="text.secondary" noWrap>
                  {bucket.label}
                </Typography>
              </Stack>
            );
          })}
        </Stack>
      </CardContent>
    </Card>
  );
}

function PercentRing({ pct, color, label }: { pct: number; color: string; label: string }) {
  const radius = 16;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, pct));
  const offset = circumference - (clamped / 100) * circumference;

  return (
    <Box sx={{ position: 'relative', width: 42, height: 42, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
      <svg width={42} height={42} viewBox="0 0 42 42">
        <circle cx={21} cy={21} r={radius} fill="none" stroke="rgba(148,163,184,0.22)" strokeWidth={4} />
        <circle
          cx={21}
          cy={21}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={4}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform="rotate(-90 21 21)"
        />
      </svg>
      <Typography variant="caption" fontSize={10} fontWeight={700} sx={{ position: 'absolute' }}>
        {label}
      </Typography>
    </Box>
  );
}

const BUSINESS_GROUPS = [
  'All hosts',
  'Kubernetes Cluster - Core Infrastructure',
  'Kubernetes Cluster - Control Plane',
  'Kubernetes Cluster - Worker Nodes',
  'Kubernetes Cluster - GPU Compute',
];

export function HostsView() {
  const muiTheme = useTheme();
  const mode = muiTheme.palette.mode;
  const tokens = PALETTE_TOKENS[mode];

  const {
    data: hosts = [],
    isLoading,
    isFetching,
    error,
    refetch,
  } = useQuery<LiveHostRecord[], Error>({
    queryKey: ['vm', 'live-cluster-hosts'],
    queryFn: () => fetchLiveClusterHosts('VictoriaMetrics'),
    refetchInterval: 30000,
  });

  const [selectedGroup, setSelectedGroup] = useState<string>('All hosts');
  const [groupFilterText, setGroupFilterText] = useState<string>('');
  const [searchText, setSearchText] = useState<string>('');
  const [showSummaryCards, setShowSummaryCards] = useState<boolean>(true);
  const [page, setPage] = useState<number>(0);
  const [rowsPerPage, setRowsPerPage] = useState<number>(10);

  const visibleGroups = useMemo(() => {
    const q = groupFilterText.trim().toLowerCase();
    if (!q) return BUSINESS_GROUPS;
    return BUSINESS_GROUPS.filter((g) => g.toLowerCase().includes(q));
  }, [groupFilterText]);

  const filteredHosts = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return hosts.filter((host) => {
      if (selectedGroup !== 'All hosts' && !host.groups.includes(selectedGroup)) {
        return false;
      }
      if (!q) return true;
      const haystack = [
        host.hostname,
        host.ip,
        host.kubeletVersion,
        host.osImage,
        ...host.tags,
        ...host.groups,
      ]
        .join(' ')
        .toLowerCase();
      return q.split(/\s+/).every((token) => haystack.includes(token));
    });
  }, [hosts, selectedGroup, searchText]);

  const aliveCount = filteredHosts.filter((h) => h.online).length;
  const deadCount = filteredHosts.length - aliveCount;
  const alivePct = filteredHosts.length > 0 ? Math.round((aliveCount / filteredHosts.length) * 100) : 0;
  const deadPct = filteredHosts.length > 0 ? 100 - alivePct : 0;

  const memBuckets = useMemo(() => buildUsageHistogram(filteredHosts.map((h) => h.memoryPct)), [filteredHosts]);
  const cpuBuckets = useMemo(() => buildUsageHistogram(filteredHosts.map((h) => h.cpuPct)), [filteredHosts]);

  const versionSlices = useMemo(() => {
    const counts = new Map<string, number>();
    for (const h of filteredHosts) {
      const ver = h.kubeletVersion || 'Unknown';
      counts.set(ver, (counts.get(ver) ?? 0) + 1);
    }
    const palette = ['#4353FF', '#0EA5E9', '#10B981', '#F59E0B', '#EC4899'];
    return Array.from(counts.entries()).map(([version, count], idx) => ({
      version,
      count,
      color: palette[idx % palette.length],
    }));
  }, [filteredHosts]);

  const pagedHosts = useMemo(() => {
    const start = page * rowsPerPage;
    return filteredHosts.slice(start, start + rowsPerPage);
  }, [filteredHosts, page, rowsPerPage]);

  if (isLoading) {
    return (
      <Stack alignItems="center" justifyContent="center" spacing={1.5} sx={{ py: 10 }}>
        <CircularProgress size={30} />
        <Typography variant="body2" color="text.secondary">
          Querying live cluster host metrics from VictoriaMetrics...
        </Typography>
      </Stack>
    );
  }

  if (error) {
    return (
      <Alert
        severity="error"
        action={
          <Button color="inherit" size="small" onClick={() => void refetch()}>
            Retry
          </Button>
        }
      >
        Failed to query live cluster hosts from VictoriaMetrics: {error.message}
      </Alert>
    );
  }

  return (
    <Box sx={{ display: 'flex', gap: 2, alignItems: 'stretch', minHeight: 'calc(100vh - 110px)' }}>
      {/* Left Preset & Business Groups Panel (Nightingale Hosts pattern) */}
      <Card sx={{ width: 224, flexShrink: 0, display: { xs: 'none', md: 'flex' }, flexDirection: 'column' }}>
        <CardContent sx={{ p: 1.75 }}>
          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
            Preset filters
          </Typography>
          <Stack spacing={0.5} sx={{ mb: 2 }}>
            <Box
              onClick={() => {
                setSelectedGroup('All hosts');
                setPage(0);
              }}
              sx={{
                px: 1.25,
                py: 0.75,
                borderRadius: 1,
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: selectedGroup === 'All hosts' ? 600 : 400,
                bgcolor: selectedGroup === 'All hosts' ? tokens.bgActiveNav : 'transparent',
                color: selectedGroup === 'All hosts' ? 'primary.main' : 'text.primary',
                '&:hover': { bgcolor: tokens.bgHover },
              }}
            >
              All hosts ({hosts.length})
            </Box>
          </Stack>

          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
            Business groups
          </Typography>
          <TextField
            size="small"
            fullWidth
            placeholder="Filter groups..."
            value={groupFilterText}
            onChange={(e) => setGroupFilterText(e.target.value)}
            sx={{ mb: 1.25, '& .MuiInputBase-input': { fontSize: 12.5, py: 0.75 } }}
          />
          <Stack spacing={0.4}>
            {visibleGroups
              .filter((g) => g !== 'All hosts')
              .map((group) => {
                const shortLabel = group.replace('Kubernetes Cluster - ', '');
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
                    {shortLabel}
                  </Box>
                );
              })}
          </Stack>
        </CardContent>
      </Card>

      {/* Main Content Area */}
      <Stack spacing={2} sx={{ flex: 1, minWidth: 0 }}>
        {/* Collapsible Top 4 Summary Cards */}
        <Box>
          <Collapse in={showSummaryCards}>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: {
                  xs: '1fr',
                  sm: 'repeat(2, 1fr)',
                  lg: '1.05fr 1.25fr 1.25fr 0.9fr',
                },
                gap: 1.75,
              }}
            >
              {/* Total Hosts Card */}
              <Card>
                <CardContent sx={{ p: 2, '&:last-child': { pb: 1.5 } }}>
                  <Typography variant="caption" color="text.secondary" fontWeight={600}>
                    Total hosts
                  </Typography>
                  <Typography variant="h4" fontWeight={700} sx={{ my: 0.5 }}>
                    {filteredHosts.length}
                  </Typography>
                  <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                    <Stack
                      direction="row"
                      alignItems="center"
                      justifyContent="space-between"
                      sx={{
                        flex: 1,
                        p: 1,
                        borderRadius: 1.5,
                        bgcolor: tokens.bgSubtle,
                      }}
                    >
                      <Box>
                        <Typography variant="caption" color="text.secondary" display="block">
                          Alive
                        </Typography>
                        <Typography variant="subtitle2" fontWeight={700}>
                          {aliveCount}
                        </Typography>
                      </Box>
                      <PercentRing pct={alivePct} color="#22C55E" label={`${alivePct}%`} />
                    </Stack>

                    <Stack
                      direction="row"
                      alignItems="center"
                      justifyContent="space-between"
                      sx={{
                        flex: 1,
                        p: 1,
                        borderRadius: 1.5,
                        bgcolor: tokens.bgSubtle,
                      }}
                    >
                      <Box>
                        <Typography variant="caption" color="text.secondary" display="block">
                          Dead
                        </Typography>
                        <Typography variant="subtitle2" fontWeight={700}>
                          {deadCount}
                        </Typography>
                      </Box>
                      <PercentRing
                        pct={deadPct}
                        color={deadCount > 0 ? '#EF4444' : '#94A3B8'}
                        label={`${deadPct}%`}
                      />
                    </Stack>
                  </Stack>
                </CardContent>
              </Card>

              {/* Memory Usage Distribution */}
              <MiniHistogramCard title="Memory usage distribution (hosts)" buckets={memBuckets} />

              {/* CPU Usage Distribution */}
              <MiniHistogramCard title="CPU usage distribution (hosts)" buckets={cpuBuckets} />

              {/* Kubelet / OS Version Distribution */}
              <Card>
                <CardContent sx={{ p: 2, '&:last-child': { pb: 1.5 } }}>
                  <Typography variant="caption" color="text.secondary" fontWeight={600} display="block" sx={{ mb: 1 }}>
                    Version distribution
                  </Typography>
                  <Stack direction="row" alignItems="center" justifyContent="center" spacing={1.5} sx={{ pt: 0.5 }}>
                    <Tooltip
                      title={
                        versionSlices.length > 0
                          ? versionSlices.map((s) => `${s.version}: ${s.count}`).join(', ')
                          : 'No data'
                      }
                    >
                      <svg width={76} height={76} viewBox="0 0 76 76">
                        {versionSlices.length <= 1 ? (
                          <circle cx={38} cy={38} r={32} fill={versionSlices[0]?.color ?? '#4353FF'} />
                        ) : (
                          (() => {
                            const total = versionSlices.reduce((acc, s) => acc + s.count, 0) || 1;
                            let offset = 0;
                            const r = 24;
                            const c = 2 * Math.PI * r;
                            return versionSlices.map((slice) => {
                              const seg = (slice.count / total) * c;
                              const el = (
                                <circle
                                  key={slice.version}
                                  cx={38}
                                  cy={38}
                                  r={r}
                                  fill="none"
                                  stroke={slice.color}
                                  strokeWidth={16}
                                  strokeDasharray={`${seg} ${c - seg}`}
                                  strokeDashoffset={-offset}
                                  transform="rotate(-90 38 38)"
                                />
                              );
                              offset += seg;
                              return el;
                            });
                          })()
                        )}
                      </svg>
                    </Tooltip>
                    <Stack spacing={0.5} sx={{ minWidth: 0 }}>
                      {versionSlices.map((slice) => (
                        <Stack key={slice.version} direction="row" spacing={0.75} alignItems="center">
                          <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: slice.color, flexShrink: 0 }} />
                          <Typography variant="caption" fontSize={11} noWrap>
                            {slice.version} ({slice.count})
                          </Typography>
                        </Stack>
                      ))}
                    </Stack>
                  </Stack>
                </CardContent>
              </Card>
            </Box>
          </Collapse>

          <Stack alignItems="center" sx={{ mt: 0.5 }}>
            <Button
              size="small"
              variant="text"
              onClick={() => setShowSummaryCards((prev) => !prev)}
              sx={{ fontSize: 11, py: 0, color: 'text.secondary' }}
            >
              {showSummaryCards ? '▲ Hide host summary' : '▼ Show host summary'}
            </Button>
          </Stack>
        </Box>

        {/* Host Filter & Table Card */}
        <Card sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
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
            <Stack direction="row" spacing={1} alignItems="center" sx={{ flex: 1, minWidth: 260 }}>
              <IconButton
                size="small"
                onClick={() => void refetch()}
                disabled={isFetching}
                sx={{ border: `1px solid ${tokens.borderSubtle}`, borderRadius: 1 }}
              >
                <Refresh fontSize="small" />
              </IconButton>
              <TextField
                size="small"
                placeholder="Search multiple keywords with spaces (host, IP, role, GPU)..."
                value={searchText}
                onChange={(e) => {
                  setSearchText(e.target.value);
                  setPage(0);
                }}
                sx={{ width: { xs: '100%', sm: 380 }, '& .MuiInputBase-input': { fontSize: 13, py: 0.75 } }}
              />
            </Stack>

            <Stack direction="row" spacing={1} alignItems="center">
              <Chip
                size="small"
                variant="outlined"
                color="primary"
                label={`Source: VictoriaMetrics (${filteredHosts.length} nodes)`}
              />
            </Stack>
          </Box>

          <TableContainer sx={{ flex: 1 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell>Identifier</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Kubelet / Agent</TableCell>
                  <TableCell>Reported tags</TableCell>
                  <TableCell>Business groups</TableCell>
                  <TableCell>Updated at</TableCell>
                  <TableCell sx={{ minWidth: 130 }}>Memory</TableCell>
                  <TableCell sx={{ minWidth: 130 }}>CPU</TableCell>
                  <TableCell>Uptime</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {pagedHosts.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} align="center" sx={{ py: 5 }}>
                      <Typography variant="body2" color="text.secondary">
                        No cluster hosts matched the current filter.
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  pagedHosts.map((host) => (
                    <TableRow key={host.hostname} hover>
                      <TableCell>
                        <Typography variant="body2" fontWeight={600}>
                          {host.hostname}
                        </Typography>
                        <Stack direction="row" spacing={1.25} alignItems="center" sx={{ mt: 0.25 }}>
                          <Typography variant="caption" color="text.secondary">
                            IP {host.ip}
                          </Typography>
                          <Stack direction="row" spacing={0.5} alignItems="center">
                            <LinuxBadgeIcon size={13} />
                            <Typography variant="caption" color="text.secondary">
                              {host.os} {host.cores > 0 ? `${host.cores} Cores` : ''} {host.arch}
                            </Typography>
                          </Stack>
                        </Stack>
                      </TableCell>

                      <TableCell>
                        <Chip
                          size="small"
                          label={host.online ? '● Online' : '● Offline'}
                          sx={{
                            height: 22,
                            fontSize: 11.5,
                            fontWeight: 600,
                            bgcolor: host.online
                              ? mode === 'light'
                                ? '#DCFCE7'
                                : 'rgba(34, 197, 94, 0.16)'
                              : mode === 'light'
                                ? '#FEE2E2'
                                : 'rgba(239, 68, 68, 0.16)',
                            color: host.online ? '#16A34A' : '#EF4444',
                          }}
                        />
                      </TableCell>

                      <TableCell>
                        <Chip
                          size="small"
                          label={host.kubeletVersion}
                          sx={{
                            height: 22,
                            fontSize: 11.5,
                            bgcolor: mode === 'light' ? '#ECFDF5' : 'rgba(16, 185, 129, 0.14)',
                            color: mode === 'light' ? '#15803D' : '#34D399',
                          }}
                        />
                      </TableCell>

                      <TableCell>
                        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                          {host.tags.map((tag) => (
                            <Chip
                              key={tag}
                              size="small"
                              variant="outlined"
                              label={tag}
                              sx={{ height: 22, fontSize: 11 }}
                            />
                          ))}
                        </Stack>
                      </TableCell>

                      <TableCell>
                        <Stack direction="column" spacing={0.4}>
                          {host.groups.map((grp) => (
                            <Chip
                              key={grp}
                              size="small"
                              label={grp}
                              sx={{
                                height: 20,
                                fontSize: 11,
                                bgcolor: mode === 'light' ? '#EEF2FF' : 'rgba(99, 102, 241, 0.16)',
                                color: mode === 'light' ? '#4338CA' : '#A5B4FC',
                              }}
                            />
                          ))}
                        </Stack>
                      </TableCell>

                      <TableCell>
                        <Stack direction="row" spacing={0.75} alignItems="center">
                          <Box sx={{ width: 3, height: 14, borderRadius: 1, bgcolor: host.online ? '#22C55E' : '#EF4444' }} />
                          <Typography variant="caption" color="text.secondary">
                            Just now
                          </Typography>
                        </Stack>
                      </TableCell>

                      <TableCell>
                        {host.memoryPct !== null ? (
                          <Box>
                            <Stack direction="row" justifyContent="space-between" alignItems="center">
                              <Typography variant="caption" fontWeight={600}>
                                {host.memoryPct.toFixed(1)} %
                              </Typography>
                              {host.memoryTotalBytes && (
                                <Typography variant="caption" fontSize={10.5} color="text.secondary">
                                  {formatGiB(host.memoryTotalBytes)}
                                </Typography>
                              )}
                            </Stack>
                            <LinearProgress
                              variant="determinate"
                              value={host.memoryPct}
                              sx={{
                                height: 4,
                                borderRadius: 2,
                                mt: 0.4,
                                bgcolor: tokens.bgSubtle,
                                '& .MuiLinearProgress-bar': {
                                  bgcolor: usageColor(host.memoryPct),
                                },
                              }}
                            />
                          </Box>
                        ) : (
                          <Typography variant="caption" color="text.secondary">
                            -
                          </Typography>
                        )}
                      </TableCell>

                      <TableCell>
                        {host.cpuPct !== null ? (
                          <Box>
                            <Typography variant="caption" fontWeight={600}>
                              {host.cpuPct.toFixed(1)} %
                            </Typography>
                            <LinearProgress
                              variant="determinate"
                              value={host.cpuPct}
                              sx={{
                                height: 4,
                                borderRadius: 2,
                                mt: 0.4,
                                bgcolor: tokens.bgSubtle,
                                '& .MuiLinearProgress-bar': {
                                  bgcolor: usageColor(host.cpuPct),
                                },
                              }}
                            />
                          </Box>
                        ) : (
                          <Typography variant="caption" color="text.secondary">
                            -
                          </Typography>
                        )}
                      </TableCell>

                      <TableCell>
                        <Stack direction="row" spacing={0.75} alignItems="center">
                          <Box sx={{ width: 3, height: 14, borderRadius: 1, bgcolor: '#22C55E' }} />
                          <Typography variant="caption" fontWeight={500}>
                            {formatUptime(host.uptimeSeconds)}
                          </Typography>
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
            count={filteredHosts.length}
            page={page}
            onPageChange={(_, newPage) => setPage(newPage)}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={(e) => {
              setRowsPerPage(parseInt(e.target.value, 10));
              setPage(0);
            }}
            rowsPerPageOptions={[10, 20, 50]}
          />
        </Card>
      </Stack>
    </Box>
  );
}

