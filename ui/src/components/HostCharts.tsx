import { Box, Card, CardContent, Stack, Typography } from '@mui/material';
import { EChart, useChartsTheme } from '@perses-dev/components';
import { PieChart } from 'echarts/charts';
import { TooltipComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { useMemo } from 'react';

echarts.use([PieChart, TooltipComponent, CanvasRenderer]);

export interface HistogramBucket {
  label: string;
  count: number;
  color: string;
}

export function buildUsageHistogram(values: Array<number | null>): HistogramBucket[] {
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

export function MiniHistogramCard({ title, buckets }: { title: string; buckets: HistogramBucket[] }) {
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

export function PercentRing({ pct, color, label }: { pct: number; color: string; label: string }) {
  const chartsTheme = useChartsTheme();
  const clamped = Math.max(0, Math.min(100, pct));

  const option = useMemo(
    () => ({
      animation: false,
      series: [
        {
          type: 'pie',
          radius: ['70%', '92%'],
          center: ['50%', '50%'],
          silent: true,
          label: { show: false },
          labelLine: { show: false },
          startAngle: 90,
          data: [
            { value: clamped, itemStyle: { color, borderRadius: 4 } },
            { value: Math.max(0, 100 - clamped), itemStyle: { color: 'rgba(148,163,184,0.22)' } },
          ],
        },
      ],
    }),
    [clamped, color],
  );

  return (
    <Box sx={{ position: 'relative', width: 42, height: 42, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
      <EChart
        option={option}
        theme={chartsTheme.echartsTheme}
        style={{ width: 42, height: 42 }}
      />
      <Typography variant="caption" fontSize={10} fontWeight={700} sx={{ position: 'absolute', pointerEvents: 'none' }}>
        {label}
      </Typography>
    </Box>
  );
}

export interface VersionSlice {
  version: string;
  count: number;
  color: string;
}

export function VersionDistributionCard({ versionSlices }: { versionSlices: VersionSlice[] }) {
  const chartsTheme = useChartsTheme();

  const option = useMemo(
    () => ({
      tooltip: {
        trigger: 'item',
        confine: true,
        formatter: '{b}: {c} ({d}%)',
      },
      series: [
        {
          type: 'pie',
          radius: ['48%', '88%'],
          center: ['50%', '50%'],
          label: { show: false },
          labelLine: { show: false },
          data:
            versionSlices.length > 0
              ? versionSlices.map((s) => ({
                  name: s.version,
                  value: s.count,
                  itemStyle: { color: s.color },
                }))
              : [{ name: 'No data', value: 1, itemStyle: { color: '#4353FF' } }],
        },
      ],
    }),
    [versionSlices],
  );

  return (
    <Card>
      <CardContent sx={{ p: 2, '&:last-child': { pb: 1.5 } }}>
        <Typography variant="caption" color="text.secondary" fontWeight={600} display="block" sx={{ mb: 1 }}>
          Version distribution
        </Typography>
        <Stack direction="row" alignItems="center" justifyContent="center" spacing={1.5} sx={{ pt: 0.5 }}>
          <Box sx={{ width: 76, height: 76, flexShrink: 0 }}>
            <EChart
              option={option}
              theme={chartsTheme.echartsTheme}
              style={{ width: 76, height: 76 }}
            />
          </Box>
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
  );
}
