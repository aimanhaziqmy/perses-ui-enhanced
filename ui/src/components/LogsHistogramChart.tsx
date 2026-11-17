import { Box, Collapse, Stack, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { EChart, useChartsTheme } from '@perses-dev/components';
import { BarChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { useMemo } from 'react';

import type { LogLevel, VictoriaLogHitBucket } from '../api/persesClient';
import { ALL_LOG_LEVELS } from '../api/persesClient';

echarts.use([BarChart, GridComponent, TooltipComponent, CanvasRenderer]);

export const LOG_LEVEL_META: Record<LogLevel, { label: string; short: string; color: string }> = {
  error: { label: 'Error', short: 'ERR', color: '#EF4444' },
  warning: { label: 'Warning', short: 'WARN', color: '#F59E0B' },
  info: { label: 'Info', short: 'INFO', color: '#3B82F6' },
  debug: { label: 'Debug', short: 'DBG', color: '#8B5CF6' },
  other: { label: 'Other', short: 'OTHER', color: '#64748B' },
};

const STACKED_LEVELS: LogLevel[] = ['error', 'warning', 'info', 'debug', 'other'];

export interface LogsHistogramChartProps {
  buckets: VictoriaLogHitBucket[];
  levelTotals: Record<LogLevel, number>;
  maxBucketCount: number;
  startLabel: string;
  endLabel: string;
  showChart: boolean;
  onToggleShowChart: () => void;
  onZoomToBucket: (bucket: VictoriaLogHitBucket) => void;
}

export function LogsHistogramChart({
  buckets,
  levelTotals,
  maxBucketCount,
  startLabel,
  endLabel,
  showChart,
  onToggleShowChart,
  onZoomToBucket,
}: LogsHistogramChartProps) {
  const theme = useTheme();
  const chartsTheme = useChartsTheme();

  const option = useMemo(() => {
    const labels = buckets.map((b) => b.label);
    return {
      animation: false,
      grid: {
        top: 6,
        right: 6,
        bottom: 4,
        left: 6,
        containLabel: false,
      },
      tooltip: {
        trigger: 'axis',
        confine: true,
        axisPointer: { type: 'shadow' },
      },
      xAxis: {
        type: 'category',
        data: labels,
        show: false,
      },
      yAxis: {
        type: 'value',
        show: false,
      },
      series: STACKED_LEVELS.map((lvl) => ({
        name: LOG_LEVEL_META[lvl].label,
        type: 'bar',
        stack: 'logs',
        barMaxWidth: 18,
        itemStyle: { color: LOG_LEVEL_META[lvl].color },
        data: buckets.map((b) => b.counts[lvl] ?? 0),
      })),
    };
  }, [buckets]);

  const onEvents = useMemo(
    () => ({
      click: (params: { dataIndex?: number }) => {
        if (typeof params.dataIndex === 'number' && buckets[params.dataIndex]) {
          onZoomToBucket(buckets[params.dataIndex]);
        }
      },
    }),
    [buckets, onZoomToBucket],
  );

  return (
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
            {startLabel} ~ {endLabel}
          </Typography>
          <Typography
            variant="caption"
            color="primary.main"
            sx={{ cursor: 'pointer', fontWeight: 600 }}
            onClick={onToggleShowChart}
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
            bgcolor: theme.palette.surface.bgSubtle,
            border: `1px solid ${theme.palette.surface.borderSubtle}`,
          }}
        >
          <Box sx={{ height: 84, width: '100%', cursor: 'pointer' }}>
            <EChart
              option={option}
              theme={chartsTheme.echartsTheme}
              onEvents={onEvents}
              style={{ width: '100%', height: 84 }}
            />
          </Box>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 0.75 }} flexWrap="wrap" gap={1}>
            <Typography variant="caption" fontSize={10.5} color="text.secondary">
              {buckets[0]?.label ?? ''}
            </Typography>
            <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap">
              {ALL_LOG_LEVELS.map((lvl) => (
                <Stack key={lvl} direction="row" spacing={0.5} alignItems="center">
                  <Box sx={{ width: 8, height: 8, borderRadius: 0.5, bgcolor: LOG_LEVEL_META[lvl].color }} />
                  <Typography variant="caption" fontSize={10.5} color="text.secondary">
                    {LOG_LEVEL_META[lvl].label}: {levelTotals[lvl]}
                  </Typography>
                </Stack>
              ))}
              <Typography variant="caption" fontSize={10.5} color="text.secondary">
                · Peak bucket: {maxBucketCount}
              </Typography>
            </Stack>
            <Typography variant="caption" fontSize={10.5} color="text.secondary">
              {buckets[buckets.length - 1]?.label ?? ''}
            </Typography>
          </Stack>
        </Box>
      </Collapse>
    </Box>
  );
}
