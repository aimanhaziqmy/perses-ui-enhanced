import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Switch,
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
import type { GlobalDatasourceResource } from '@perses-dev/client';
import { getResourceDisplayName } from '@perses-dev/components';
import AlertCircle from 'mdi-material-ui/AlertCircle';
import CheckCircle from 'mdi-material-ui/CheckCircle';
import Refresh from 'mdi-material-ui/Refresh';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';

import type { DatasourceProbeResult } from '../api/persesClient';
import { fetchGlobalDatasources, probeGlobalDatasource } from '../api/persesClient';
import { PALETTE_TOKENS } from '../theme/persesTheme';
import { PrometheusBrandIcon, VictoriaLogsBrandIcon } from './BrandIcons';

export function DatasourcesView() {
  const muiTheme = useTheme();
  const mode = muiTheme.palette.mode;
  const tokens = PALETTE_TOKENS[mode];

  const {
    data: datasources = [],
    isLoading,
    error,
    refetch,
  } = useQuery<GlobalDatasourceResource[], Error>({
    queryKey: ['perses', 'globaldatasources'],
    queryFn: fetchGlobalDatasources,
  });

  const [searchText, setSearchText] = useState<string>('');
  const [probing, setProbing] = useState(false);
  const [probes, setProbes] = useState<Record<string, DatasourceProbeResult>>({});
  const [inspectedProbe, setInspectedProbe] = useState<DatasourceProbeResult | null>(null);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);

  const runProbes = useCallback(async (items: GlobalDatasourceResource[]) => {
    setProbing(true);
    try {
      const results = await Promise.all(items.map((ds) => probeGlobalDatasource(ds)));
      const map: Record<string, DatasourceProbeResult> = {};
      for (const r of results) {
        map[r.name] = r;
      }
      setProbes(map);
    } finally {
      setProbing(false);
    }
  }, []);

  useEffect(() => {
    if (datasources.length > 0) {
      void runProbes(datasources);
    }
  }, [datasources, runProbes]);

  const filtered = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    if (!q) return datasources;
    return datasources.filter((ds) =>
      `${ds.metadata.name} ${getResourceDisplayName(ds)} ${ds.spec.plugin.kind}`.toLowerCase().includes(q),
    );
  }, [datasources, searchText]);

  const paged = useMemo(() => {
    const start = page * rowsPerPage;
    return filtered.slice(start, start + rowsPerPage);
  }, [filtered, page, rowsPerPage]);

  if (isLoading) {
    return (
      <Stack alignItems="center" justifyContent="center" sx={{ py: 8 }}>
        <CircularProgress />
      </Stack>
    );
  }

  if (error) {
    return <Alert severity="error">Failed to fetch GlobalDatasources: {error.message}</Alert>;
  }

  return (
    <Stack spacing={1.5}>
      <Card>
        {/* Top Search & Action Bar matching Screenshot 6 */}
        <Box
          sx={{
            p: 1.75,
            borderBottom: `1px solid ${tokens.borderSubtle}`,
            display: 'flex',
            flexWrap: 'wrap',
            gap: 1.5,
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <TextField
            size="small"
            placeholder="Please enter search keywords..."
            value={searchText}
            onChange={(e) => {
              setSearchText(e.target.value);
              setPage(0);
            }}
            sx={{ width: { xs: '100%', sm: 290 }, '& .MuiInputBase-input': { fontSize: 13, py: 0.75 } }}
          />

          <Button
            size="small"
            variant="outlined"
            startIcon={<Refresh />}
            disabled={probing}
            onClick={async () => {
              const refreshed = await refetch();
              if (refreshed.data) {
                await runProbes(refreshed.data);
              }
            }}
          >
            {probing ? 'Probing...' : 'Test connectivity'}
          </Button>
        </Box>

        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell width={190}>Type ↑</TableCell>
                <TableCell>Data source name</TableCell>
                <TableCell>Upstream Perses proxy URL</TableCell>
                <TableCell>Live probe</TableCell>
                <TableCell width={110}>Enabled</TableCell>
                <TableCell align="right" width={120}>
                  Operations
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {paged.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} align="center" sx={{ py: 5 }}>
                    <Typography variant="body2" color="text.secondary">
                      No GlobalDatasources provisioned on the Perses backend.
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                paged.map((ds) => {
                  const probe = probes[ds.metadata.name];
                  const isProm = ds.spec.plugin.kind === 'PrometheusDatasource';
                  const typeLabel = isProm ? 'Prometheus' : ds.spec.plugin.kind.replace('Datasource', '');
                  const proxyUrl =
                    (ds.spec.plugin.spec as { proxy?: { spec?: { url?: string } } })?.proxy?.spec?.url ??
                    'Direct / Unknown';

                  return (
                    <TableRow key={ds.metadata.name} hover>
                      <TableCell>
                        <Stack direction="row" spacing={1} alignItems="center">
                          {isProm ? <PrometheusBrandIcon size={18} /> : <VictoriaLogsBrandIcon size={18} />}
                          <Typography variant="body2" fontWeight={500}>
                            {typeLabel}
                          </Typography>
                        </Stack>
                      </TableCell>

                      <TableCell>
                        <Stack direction="row" spacing={0.75} alignItems="center">
                          <Typography
                            variant="body2"
                            fontWeight={600}
                            color="primary.main"
                            sx={{ cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}
                            onClick={() => probe && setInspectedProbe(probe)}
                          >
                            {ds.metadata.name}
                          </Typography>
                          {ds.spec.default && (
                            <Tooltip title="Default GlobalDatasource for this plugin type">
                              <CheckCircle sx={{ fontSize: 15, color: 'primary.main' }} />
                            </Tooltip>
                          )}
                        </Stack>
                        <Typography variant="caption" color="text.secondary">
                          {getResourceDisplayName(ds)}
                        </Typography>
                      </TableCell>

                      <TableCell sx={{ fontFamily: 'monospace', fontSize: 12, color: 'text.secondary' }}>
                        {proxyUrl}
                      </TableCell>

                      <TableCell>
                        {probe ? (
                          <Chip
                            size="small"
                            icon={probe.ok ? <CheckCircle fontSize="small" /> : <AlertCircle fontSize="small" />}
                            color={probe.ok ? 'success' : 'error'}
                            variant="outlined"
                            label={probe.ok ? `OK · ${probe.latencyMs} ms` : `HTTP ${probe.statusCode}`}
                            sx={{ height: 22, fontSize: 11.5 }}
                          />
                        ) : (
                          <Typography variant="caption" color="text.secondary">
                            Probing...
                          </Typography>
                        )}
                      </TableCell>

                      <TableCell>
                        <Switch size="small" checked={true} color="primary" readOnly />
                      </TableCell>

                      <TableCell align="right">
                        <Tooltip title="Inspect proxy probe response">
                          <IconButton
                            size="small"
                            disabled={!probe}
                            onClick={() => probe && setInspectedProbe(probe)}
                          >
                            <Typography variant="caption" color="primary.main" fontWeight={600}>
                              Inspect
                            </Typography>
                          </IconButton>
                        </Tooltip>
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
          count={filtered.length}
          page={page}
          onPageChange={(_, p) => setPage(p)}
          rowsPerPage={rowsPerPage}
          onRowsPerPageChange={(e) => {
            setRowsPerPage(parseInt(e.target.value, 10));
            setPage(0);
          }}
          rowsPerPageOptions={[10, 20]}
        />
      </Card>

      <Dialog open={Boolean(inspectedProbe)} onClose={() => setInspectedProbe(null)} maxWidth="md" fullWidth>
        <DialogTitle>
          Datasource Proxy Probe: {inspectedProbe?.name} ({inspectedProbe?.kind})
        </DialogTitle>
        <DialogContent dividers>
          {inspectedProbe && (
            <Stack spacing={1.5}>
              <Typography variant="body2">
                <strong>Status:</strong> {inspectedProbe.ok ? 'Connected' : 'Failed'} (HTTP {inspectedProbe.statusCode},{' '}
                {inspectedProbe.latencyMs} ms)
              </Typography>
              <Box
                component="pre"
                sx={{
                  m: 0,
                  p: 1.5,
                  borderRadius: 1,
                  bgcolor: tokens.bgSubtle,
                  fontFamily: 'monospace',
                  fontSize: 12,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  maxHeight: 360,
                  overflow: 'auto',
                }}
              >
                {inspectedProbe.detail}
              </Box>
            </Stack>
          )}
        </DialogContent>
      </Dialog>
    </Stack>
  );
}
