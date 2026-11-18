import { Box, Chip, Collapse, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { EChart, useChartsTheme } from '@perses-dev/components';
import { BarChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import type React from 'react';
import { useCallback, useMemo, useRef } from 'react';

import type { HistogramGroupBy, LogLevel, VictoriaLogGroupHitBucket, VictoriaLogHitBucket } from '@/api/persesClient';
import { ALL_LOG_LEVELS } from '@/api/persesClient';

echarts.use([BarChart, GridComponent, TooltipComponent, CanvasRenderer]);

export const LOG_LEVEL_META: Record<LogLevel, { label: string; short: string; color: string }> = {
  error: { label: 'Error', short: 'ERR', color: '#EF4444' },
  warning: { label: 'Warning', short: 'WARN', color: '#F59E0B' },
  info: { label: 'Info', short: 'INFO', color: '#3B82F6' },
  debug: { label: 'Debug', short: 'DBG', color: '#8B5CF6' },
  other: { label: 'Other', short: 'OTHER', color: '#64748B' },
};

const STACKED_LEVELS: LogLevel[] = ['error', 'warning', 'info', 'debug', 'other'];

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatStreamLabel(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    return raw;
  }
  const labels: Record<string, string> = {};
  const pairRegex = /([a-zA-Z0-9_.-]+)="((?:[^"\\]|\\.)*)"/g;
  let match: RegExpExecArray | null;
  while ((match = pairRegex.exec(trimmed)) !== null) {
    labels[match[1]] = match[2].replace(/\\"/g, '"');
  }
  const container =
    labels['kubernetes.container_name'] ||
    labels['container_name'] ||
    labels['container'] ||
    labels['k8s.container.name'];
  const namespace =
    labels['kubernetes.pod_namespace'] ||
    labels['kubernetes.namespace_name'] ||
    labels['namespace'] ||
    labels['k8s.namespace.name'];
  const pod =
    labels['kubernetes.pod_name'] ||
    labels['pod_name'] ||
    labels['pod'] ||
    labels['k8s.pod.name'];
  const app = labels['kubernetes.labels.app'] || labels['app'] || labels['service.name'] || labels['job'];

  if (container) {
    const location = [namespace, pod].filter(Boolean).join('/');
    return location ? `${container} · ${location}` : container;
  }
  const fallbackParts = [app, namespace, pod].filter(Boolean);
  if (fallbackParts.length > 0) {
    return fallbackParts.join(' · ');
  }
  const entries = Object.entries(labels);
  return entries.length > 0 ? entries.map(([k, v]) => `${k}=${v}`).join(', ') : raw;
}

const GROUP_PALETTE = [
  '#38BDF8',
  '#34D399',
  '#FBBF24',
  '#A78BFA',
  '#FB7185',
  '#2DD4BF',
  '#F97316',
  '#60A5FA',
  '#EC4899',
  '#94A3B8',
];

export interface LogsHistogramChartProps {
  buckets: VictoriaLogHitBucket[];
  groupBuckets?: VictoriaLogGroupHitBucket[];
  groupSeriesKeys?: string[];
  groupBy: HistogramGroupBy;
  onChangeGroupBy: (next: HistogramGroupBy) => void;
  levelTotals: Record<LogLevel, number>;
  maxBucketCount: number;
  startLabel: string;
  endLabel: string;
  showChart: boolean;
  onToggleShowChart: () => void;
  onZoomToBucket: (bucket: { timestamp: string; endTimestamp: string }) => void;
}

export function LogsHistogramChart({
  buckets,
  groupBuckets = [],
  groupSeriesKeys = [],
  groupBy,
  onChangeGroupBy,
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

  const isGrouped = groupBy !== 'level';
  const activeBuckets = isGrouped ? groupBuckets : buckets;
  const totalLogs = useMemo(() => {
    if (isGrouped) {
      return groupBuckets.reduce((sum, b) => sum + b.count, 0);
    }
    return Object.values(levelTotals).reduce((sum, n) => sum + n, 0);
  }, [isGrouped, groupBuckets, levelTotals]);

  const activePeak = useMemo(() => {
    if (!isGrouped) return maxBucketCount;
    return groupBuckets.reduce((m, b) => Math.max(m, b.count), 0);
  }, [isGrouped, groupBuckets, maxBucketCount]);

  const option = useMemo(() => {
    const labels = activeBuckets.map((b) => b.label);
    const axisLabelColor = theme.palette.text.secondary;
    const splitLineColor = theme.palette.surface.borderSubtle;

    const series = isGrouped
      ? groupSeriesKeys.map((key, idx) => ({
          name: key,
          type: 'bar',
          stack: 'logs',
          barWidth: '82%',
          itemStyle: { color: GROUP_PALETTE[idx % GROUP_PALETTE.length] },
          data: groupBuckets.map((b) => b.groups[key] ?? 0),
        }))
      : STACKED_LEVELS.map((lvl) => ({
          name: LOG_LEVEL_META[lvl].label,
          type: 'bar',
          stack: 'logs',
          barWidth: '82%',
          itemStyle: { color: LOG_LEVEL_META[lvl].color },
          data: buckets.map((b) => b.counts[lvl] ?? 0),
        }));

    return {
      animation: false,
      grid: {
        top: 8,
        right: 8,
        bottom: 4,
        left: 6,
        containLabel: true,
      },
      tooltip: {
        trigger: 'axis',
        confine: false,
        appendToBody: true,
        axisPointer: { type: 'shadow' },
        formatter: (params: Array<{ dataIndex?: number; seriesName?: string; value?: number; color?: string }>) => {
          const idx = params?.[0]?.dataIndex;
          if (typeof idx !== 'number' || !activeBuckets[idx]) return '';
          const b = activeBuckets[idx];
          const fmt = (iso: string) => {
            const d = new Date(iso);
            if (Number.isNaN(d.getTime())) return iso;
            const pad = (n: number) => String(n).padStart(2, '0');
            return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
          };
          const rows = isGrouped
            ? params
                .filter((p) => (p.value ?? 0) > 0)
                .sort((a, bItem) => (bItem.value ?? 0) - (a.value ?? 0))
                .slice(0, 10)
                .map((p) => {
                  const rawName = p.seriesName ?? 'other';
                  const displayName = groupBy === 'stream' ? formatStreamLabel(rawName) : rawName;
                  return `<div style="display:flex;justify-content:space-between;gap:14px;align-items:flex-start;line-height:1.5;">
                    <span style="max-width:420px;overflow-wrap:anywhere;"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color ?? '#94A3B8'};margin-right:6px;"></span>${escapeHtml(displayName)}</span>
                    <span style="font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap;">${Number(p.value ?? 0).toLocaleString()}</span>
                  </div>`;
                })
                .join('')
            : ALL_LOG_LEVELS.map((lvl) => {
                const count = (b as VictoriaLogHitBucket).counts?.[lvl] ?? 0;
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
        show: true,
        axisLine: { lineStyle: { color: splitLineColor } },
        axisTick: { show: false },
        axisLabel: { color: axisLabelColor, fontSize: 10 },
      },
      yAxis: {
        type: 'value',
        show: true,
        splitNumber: 3,
        axisLabel: {
          color: axisLabelColor,
          fontSize: 10,
          formatter: (val: number) => (val >= 1000 ? `${(val / 1000).toFixed(val >= 10000 ? 0 : 1)}k` : String(val)),
        },
        splitLine: { lineStyle: { color: splitLineColor, type: 'dashed' } },
      },
      series,
    };
  }, [activeBuckets, buckets, groupBuckets, groupBy, groupSeriesKeys, isGrouped, theme.palette.surface.borderSubtle, theme.palette.text.secondary]);

  const handleChartClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const chartEl = chartWrapRef.current?.querySelector('[_echarts_instance_]') as HTMLElement | null;
      const instance = chartEl ? echarts.getInstanceByDom(chartEl) : undefined;
      if (!instance || !chartEl) return;
      const rect = chartEl.getBoundingClientRect();
      const point = instance.convertFromPixel({ seriesIndex: 0 }, [e.clientX - rect.left, e.clientY - rect.top]);
      const idx = Array.isArray(point) ? Math.round(point[0]) : -1;
      if (idx >= 0 && idx < activeBuckets.length) {
        onZoomToBucket(activeBuckets[idx]);
      }
    },
    [activeBuckets, onZoomToBucket],
  );

  return (
    <Box sx={{ mt: 2 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1} sx={{ mb: 1 }}>
        <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap">
          <Typography variant="caption" fontWeight={600} color="text.secondary">
            All log statistics
          </Typography>
          <Chip
            size="small"
            variant="outlined"
            label={`Total: ${totalLogs.toLocaleString()} logs`}
            sx={{ height: 20, fontSize: 11, fontFamily: 'monospace' }}
          />
          <Typography variant="caption" fontSize={11} color="text.secondary">
            (click any bar to zoom)
          </Typography>
        </Stack>
        <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap">
          <ToggleButtonGroup
            size="small"
            exclusive
            value={groupBy}
            onChange={(_e, val) => {
              if (val) onChangeGroupBy(val as HistogramGroupBy);
            }}
            sx={{ '& .MuiToggleButton-root': { py: 0.2, px: 1, fontSize: 11, textTransform: 'none' } }}
          >
            <ToggleButton value="level">By Level</ToggleButton>
            <ToggleButton value="container">By Container</ToggleButton>
            <ToggleButton value="stream">By Stream</ToggleButton>
          </ToggleButtonGroup>
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
          <Box ref={chartWrapRef} onClick={handleChartClick} sx={{ height: 112, width: '100%', cursor: 'pointer' }}>
            <EChart
              option={option}
              theme={chartsTheme.echartsTheme}
              style={{ width: '100%', height: 112 }}
            />
          </Box>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 0.75 }} flexWrap="wrap" gap={1}>
            <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap">
              {isGrouped
                ? groupSeriesKeys.slice(0, 8).map((key, idx) => {
                    const displayLabel = groupBy === 'stream' ? formatStreamLabel(key) : key;
                    return (
                      <Stack key={key} direction="row" spacing={0.5} alignItems="center" title={key}>
                        <Box
                          sx={{
                            width: 8,
                            height: 8,
                            borderRadius: 0.5,
                            flexShrink: 0,
                            bgcolor: GROUP_PALETTE[idx % GROUP_PALETTE.length],
                          }}
                        />
                        <Typography
                          variant="caption"
                          fontSize={10.5}
                          color="text.secondary"
                          sx={{ maxWidth: 340, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        >
                          {displayLabel}
                        </Typography>
                      </Stack>
                    );
                  })
                : ALL_LOG_LEVELS.map((lvl) => (
                    <Stack key={lvl} direction="row" spacing={0.5} alignItems="center">
                      <Box sx={{ width: 8, height: 8, borderRadius: 0.5, bgcolor: LOG_LEVEL_META[lvl].color }} />
                      <Typography variant="caption" fontSize={10.5} color="text.secondary">
                        {LOG_LEVEL_META[lvl].label}: {levelTotals[lvl].toLocaleString()}
                      </Typography>
                    </Stack>
                  ))}
              <Typography variant="caption" fontSize={10.5} color="text.secondary">
                · Peak bucket: {activePeak.toLocaleString()}
              </Typography>
            </Stack>
          </Stack>
        </Box>
      </Collapse>
    </Box>
  );
}
