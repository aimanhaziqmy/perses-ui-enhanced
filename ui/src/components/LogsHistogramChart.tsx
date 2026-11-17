import { Box, Collapse, Stack, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { EChart, useChartsTheme } from '@perses-dev/components';
import { BarChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import type React from 'react';
import { useCallback, useMemo, useRef } from 'react';

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
  const chartWrapRef = useRef<HTMLDivElement | null>(null);

  const option = useMemo(() => {
    const labels = buckets.map((b) => b.label);
    return {
      animation: false,
      grid: {
        top: 4,
        right: 2,
        bottom: 2,
        left: 2,
        containLabel: false,
      },
      tooltip: {
        trigger: 'axis',
        confine: false,
        appendToBody: true,
        axisPointer: { type: 'shadow' },
        formatter: (params: Array<{ dataIndex?: number }>) => {
          const idx = params?.[0]?.dataIndex;
          if (typeof idx !== 'number' || !buckets[idx]) return '';
          const b = buckets[idx];
          const fmt = (iso: string) => {
            const d = new Date(iso);
            if (Number.isNaN(d.getTime())) return iso;
            const pad = (n: number) => String(n).padStart(2, '0');
            return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
          };
          const rows = ALL_LOG_LEVELS.map((lvl) => {
            const count = b.counts[lvl] ?? 0;
            const meta = LOG_LEVEL_META[lvl];
            return `<div style="display:flex;justify-content:space-between;gap:14px;align-items:center;line-height:1.5;">
              <span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${meta.color};margin-right:6px;"></span>${meta.label}</span>
              <span style="font-weight:600;font-variant-numeric:tabular-nums;">${count.toLocaleString()}</span>
            </div>`;
          }).join('');
          return `<div style="font-size:12px;">
            <div style="font-weight:600;margin-bottom:4px;">${fmt(b.timestamp)} ~ ${fmt(b.endTimestamp).slice(11)}</div>
            <div style="display:flex;justify-content:space-between;gap:14px;margin-bottom:4px;padding-bottom:4px;border-bottom:1px solid rgba(148,163,184,0.25);">
              <span>Total</span>
              <span style="font-weight:700;font-variant-numeric:tabular-nums;">${b.count.toLocaleString()}</span>
            </div>
            ${rows}
          </div>`;
        },
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
        barWidth: '82%',
        itemStyle: { color: LOG_LEVEL_META[lvl].color },
        data: buckets.map((b) => b.counts[lvl] ?? 0),
      })),
    };
  }, [buckets]);

  const handleChartClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const chartEl = chartWrapRef.current?.querySelector('[_echarts_instance_]') as HTMLElement | null;
      const instance = chartEl ? echarts.getInstanceByDom(chartEl) : undefined;
      if (!instance || !chartEl) return;
      const rect = chartEl.getBoundingClientRect();
      const point = instance.convertFromPixel({ seriesIndex: 0 }, [e.clientX - rect.left, e.clientY - rect.top]);
      const idx = Array.isArray(point) ? Math.round(point[0]) : -1;
      if (idx >= 0 && idx < buckets.length) {
        onZoomToBucket(buckets[idx]);
      }
    },
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
          <Box ref={chartWrapRef} onClick={handleChartClick} sx={{ height: 76, width: '100%', cursor: 'pointer' }}>
            <EChart
              option={option}
              theme={chartsTheme.echartsTheme}
              style={{ width: '100%', height: 76 }}
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
