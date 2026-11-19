import { Box } from '@mui/material';

import type { LogLevel, VictoriaLogHitBucket } from '@/lib/api/logs';
import type { NormalizedLogEntry } from './api/logDatasource';

export interface QueryTabState {
  id: string;
  label: string;
  query: string;
  rangeMinutes: number;
  selectedLevels: LogLevel[];
  customStartIso?: string;
  customEndIso?: string;
}

export const LOG_BATCH_SIZE = 200;

export const TIME_RANGES = [
  { label: 'Last 15 minutes', minutes: 15 },
  { label: 'Last 1 hour', minutes: 60 },
  { label: 'Last 6 hours', minutes: 360 },
  { label: 'Last 24 hours', minutes: 1440 },
];

export const LEVEL_META: Record<LogLevel, { label: string; short: string; color: string }> = {
  error: { label: 'Error', short: 'ERR', color: '#EF4444' },
  warning: { label: 'Warning', short: 'WARN', color: '#F59E0B' },
  info: { label: 'Info', short: 'INFO', color: '#3B82F6' },
  debug: { label: 'Debug', short: 'DBG', color: '#8B5CF6' },
  other: { label: 'Other', short: 'OTHER', color: '#64748B' },
};

export function formatCompactTs(ts: string): string {
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

export function formatFullTs(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  const ms = String(date.getMilliseconds()).padStart(3, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}.${ms}`;
}

export function buildFallbackBuckets(
  entries: NormalizedLogEntry[],
  startMs: number,
  endMs: number,
): VictoriaLogHitBucket[] {
  const bucketCount = 48;
  const span = Math.max(1000, endMs - startMs);
  const stepMs = span / bucketCount;
  const bucketsCounts: Array<Record<LogLevel, number>> = Array.from({ length: bucketCount }, () => ({
    error: 0,
    warning: 0,
    info: 0,
    debug: 0,
    other: 0,
  }));

  for (const entry of entries) {
    const t = entry.timestampMs || new Date(entry.timestamp).getTime();
    if (!Number.isFinite(t)) continue;
    const idx = Math.min(bucketCount - 1, Math.max(0, Math.floor((t - startMs) / stepMs)));
    bucketsCounts[idx][entry.severity] += 1;
  }

  return bucketsCounts.map((counts, i) => {
    const d = new Date(startMs + i * stepMs);
    const dEnd = new Date(startMs + (i + 1) * stepMs);
    const count = counts.error + counts.warning + counts.info + counts.debug + counts.other;
    return {
      timestamp: d.toISOString(),
      endTimestamp: dEnd.toISOString(),
      label: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
      count,
      counts,
    };
  });
}

export function LevelBadge({ level }: { level: LogLevel }) {
  const meta = LEVEL_META[level];
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        px: 0.75,
        py: 0.15,
        borderRadius: 0.75,
        fontSize: 10.5,
        fontWeight: 700,
        fontFamily: 'monospace',
        letterSpacing: '0.03em',
        color: '#FFFFFF',
        bgcolor: meta.color,
        minWidth: 46,
        lineHeight: 1.4,
      }}
    >
      {meta.short}
    </Box>
  );
}
