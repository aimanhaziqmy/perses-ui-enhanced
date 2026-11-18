import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Collapse,
  FormControl,
  IconButton,
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
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import Refresh from 'mdi-material-ui/Refresh';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import type { LiveHostRecord } from '../api/persesClient';
import {
  datasourceTargetKey,
  fetchLiveClusterHosts,
  useDatasourceTargets,
} from '../api/persesClient';
import { OsBadgeIcon } from './BrandIcons';
import {
  MiniHistogramCard,
  PercentRing,
  VersionDistributionCard,
  buildUsageHistogram,
} from './HostCharts';
import { formatBytesIEC, formatDuration, formatPercent } from '../utils/unitFormatter';

function usageColor(pct: number | null): string {
  if (pct === null) return '#94A3B8';
  if (pct >= 80) return '#EF4444';
  if (pct >= 60) return '#F59E0B';
  return '#22C55E';
}

const BUSINESS_GROUPS = [
  'All hosts',
  'Kubernetes Cluster - Core Infrastructure',
  'Kubernetes Cluster - Control Plane',
  'Kubernetes Cluster - Worker Nodes',
  'Kubernetes Cluster - GPU Compute',
];

export function HostsView() {
  const theme = useTheme();
  const mode = theme.palette.mode;
  const navigate = useNavigate();

  const {
    targets: promTargets,
    isLoading: loadingDatasources,
  } = useDatasourceTargets('PrometheusDatasource');

  const [selectedTargetKey, setSelectedTargetKey] = useState<string>('');

  useEffect(() => {
    if (promTargets.length === 0) {
      setSelectedTargetKey('');
      return;
    }
    if (!selectedTargetKey || !promTargets.some((t) => datasourceTargetKey(t) === selectedTargetKey)) {
      const def = promTargets.find((t) => t.isDefault) ?? promTargets[0];
      setSelectedTargetKey(datasourceTargetKey(def));
    }
  }, [promTargets, selectedTargetKey]);

  const activeTarget = useMemo(
    () => promTargets.find((t) => datasourceTargetKey(t) === selectedTargetKey) ?? promTargets[0] ?? null,
    [promTargets, selectedTargetKey],
  );

  const {
    data: hosts = [],
    isInitialLoading: isLoading,
    isFetching,
    error,
    refetch,
  } = useQuery<LiveHostRecord[], Error>({
    queryKey: ['vm', 'live-cluster-hosts', selectedTargetKey],
    queryFn: () => fetchLiveClusterHosts(activeTarget!),
    enabled: Boolean(activeTarget),
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

  if (loadingDatasources || (Boolean(activeTarget) && isLoading)) {
    return (
      <Stack alignItems="center" justifyContent="center" spacing={1.5} sx={{ py: 10 }}>
        <CircularProgress size={30} />
        <Typography variant="body2" color="text.secondary">
          Querying live cluster host metrics...
        </Typography>
      </Stack>
    );
  }

  if (!activeTarget) {
    return (
      <Card>
        <Box sx={{ p: 4, textAlign: 'center' }}>
          <Stack spacing={1.5} alignItems="center">
            <Typography variant="subtitle1" fontWeight={700}>
              No Prometheus / VictoriaMetrics data source configured
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Add a PrometheusDatasource in Integrations → Data sources to inspect cluster nodes, CPU, memory, and GPU
              telemetry.
            </Typography>
            <Button variant="contained" onClick={() => navigate('/datasources')}>
              Add data source
            </Button>
          </Stack>
        </Box>
      </Card>
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
        Failed to query live cluster hosts from {activeTarget.name}: {error.message}
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
                bgcolor: selectedGroup === 'All hosts' ? theme.palette.surface.bgActiveNav : 'transparent',
                color: selectedGroup === 'All hosts' ? 'primary.main' : 'text.primary',
                '&:hover': { bgcolor: theme.palette.surface.bgHover },
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
                      bgcolor: selected ? theme.palette.surface.bgActiveNav : 'transparent',
                      color: selected ? 'primary.main' : 'text.secondary',
                      '&:hover': { bgcolor: theme.palette.surface.bgHover },
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
                        bgcolor: theme.palette.surface.bgSubtle,
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
                        bgcolor: theme.palette.surface.bgSubtle,
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
              <VersionDistributionCard versionSlices={versionSlices} />
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
        <Card sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <Box
            sx={{
              p: 1.5,
              borderBottom: `1px solid ${theme.palette.surface.borderSubtle}`,
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
                sx={{ border: `1px solid ${theme.palette.surface.borderSubtle}`, borderRadius: 1 }}
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
              {promTargets.length > 1 && (
                <FormControl size="small" sx={{ minWidth: 180 }}>
                  <Select value={selectedTargetKey} onChange={(e) => setSelectedTargetKey(e.target.value)}>
                    {promTargets.map((t) => (
                      <MenuItem key={datasourceTargetKey(t)} value={datasourceTargetKey(t)}>
                        {t.displayName} ({t.scope === 'global' ? 'Global' : t.project})
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}
              <Chip
                size="small"
                variant="outlined"
                color="primary"
                label={`Source: ${activeTarget.name} (${filteredHosts.length} nodes)`}
              />
            </Stack>
          </Box>

          <TableContainer sx={{ flex: 1, overflowX: 'auto' }}>
            <Table size="small" stickyHeader sx={{ minWidth: 1080 }}>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ minWidth: 230, whiteSpace: 'nowrap' }}>Identifier</TableCell>
                  <TableCell sx={{ minWidth: 100, whiteSpace: 'nowrap' }}>Status</TableCell>
                  <TableCell sx={{ minWidth: 130, whiteSpace: 'nowrap' }}>Kubelet / Agent</TableCell>
                  <TableCell sx={{ minWidth: 180, whiteSpace: 'nowrap' }}>Reported tags</TableCell>
                  <TableCell sx={{ minWidth: 170, whiteSpace: 'nowrap' }}>Business groups</TableCell>
                  <TableCell sx={{ minWidth: 100, whiteSpace: 'nowrap' }}>Updated at</TableCell>
                  <TableCell sx={{ minWidth: 135, whiteSpace: 'nowrap' }}>Memory</TableCell>
                  <TableCell sx={{ minWidth: 135, whiteSpace: 'nowrap' }}>CPU</TableCell>
                  <TableCell sx={{ minWidth: 100, whiteSpace: 'nowrap' }}>Uptime</TableCell>
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
                      <TableCell sx={{ minWidth: 230 }}>
                        <Typography variant="body2" fontWeight={600} noWrap>
                          {host.hostname}
                        </Typography>
                        <Stack direction="row" spacing={1.25} alignItems="center" sx={{ mt: 0.25, whiteSpace: 'nowrap' }}>
                          <Typography variant="caption" color="text.secondary">
                            IP {host.ip}
                          </Typography>
                          <Stack direction="row" spacing={0.5} alignItems="center">
                            <OsBadgeIcon os={host.os} osImage={host.osImage} size={13} />
                            <Typography variant="caption" color="text.secondary">
                              {host.os} {host.cores > 0 ? `${host.cores} Cores` : ''} {host.arch}
                            </Typography>
                          </Stack>
                        </Stack>
                      </TableCell>

                      <TableCell sx={{ whiteSpace: 'nowrap' }}>
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

                      <TableCell sx={{ whiteSpace: 'nowrap' }}>
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
                        <Stack direction="column" spacing={0.4} alignItems="flex-start">
                          {host.groups.map((grp) => (
                            <Chip
                              key={grp}
                              size="small"
                              label={grp.replace(/^Kubernetes Cluster - /, '')}
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

                      <TableCell sx={{ whiteSpace: 'nowrap' }}>
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
                                {formatPercent(host.memoryPct)}
                              </Typography>
                              {host.memoryTotalBytes && (
                                <Typography variant="caption" fontSize={10.5} color="text.secondary">
                                  {formatBytesIEC(host.memoryTotalBytes)}
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
                                bgcolor: theme.palette.surface.bgSubtle,
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
                              {formatPercent(host.cpuPct)}
                            </Typography>
                            <LinearProgress
                              variant="determinate"
                              value={host.cpuPct}
                              sx={{
                                height: 4,
                                borderRadius: 2,
                                mt: 0.4,
                                bgcolor: theme.palette.surface.bgSubtle,
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

                      <TableCell sx={{ whiteSpace: 'nowrap' }}>
                        <Stack direction="row" spacing={0.75} alignItems="center">
                          <Box sx={{ width: 3, height: 14, borderRadius: 1, bgcolor: '#22C55E' }} />
                          <Typography variant="caption" fontWeight={500}>
                            {formatDuration(host.uptimeSeconds, 's')}
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

