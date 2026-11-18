import type { DatasourceTarget } from './datasources';
import {
  UnauthorizedError,
  fetchGlobalJsonConfig,
  persesFetchFn,
  saveGlobalJsonConfig,
  toProxyBasePath,
} from '@/lib/api/http';
import { splitFirstUnquotedPipe } from './workspace';

export type LogLevel = 'error' | 'warning' | 'info' | 'debug' | 'other';

export const ALL_LOG_LEVELS: LogLevel[] = ['error', 'warning', 'info', 'debug', 'other'];

export interface VictoriaLogEntry {
  _time: string;
  _msg: string;
  _stream: string;
  [field: string]: string;
}

export interface VictoriaLogsQueryResult {
  entries: VictoriaLogEntry[];
  durationMs: number;
  malformedLines?: number;
}

export interface VictoriaLogHitBucket {
  timestamp: string;
  endTimestamp: string;
  label: string;
  count: number;
  counts: Record<LogLevel, number>;
}

function safeParseNdjsonLine<T>(line: string): T | null {
  try {
    const parsed = JSON.parse(line) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as T) : null;
  } catch {
    return null;
  }
}

const ERR_FIELDS_LOGSQL =
  '(level:~"(?i)(err|fatal|crit|panic)" OR severity:~"(?i)(err|fatal|crit|panic)" OR lvl:~"(?i)(err|fatal|crit|panic)" OR log.level:~"(?i)(err|fatal|crit|panic)" OR type:~"(?i)(err|fatal|crit|panic)")';
const WARN_FIELDS_LOGSQL =
  '(level:~"(?i)(warn|warning)" OR severity:~"(?i)(warn|warning)" OR lvl:~"(?i)(warn|warning)" OR log.level:~"(?i)(warn|warning)" OR type:~"(?i)(warn|warning)")';
const DEBUG_FIELDS_LOGSQL =
  '(level:~"(?i)(debug|trace)" OR severity:~"(?i)(debug|trace)" OR lvl:~"(?i)(debug|trace)" OR log.level:~"(?i)(debug|trace)" OR type:~"(?i)(debug|trace)")';
const INFO_FIELDS_LOGSQL =
  '(level:~"(?i)(info|information|notice|normal)" OR severity:~"(?i)(info|information|notice|normal)" OR lvl:~"(?i)(info|information|notice|normal)" OR log.level:~"(?i)(info|information|notice|normal)" OR type:~"(?i)(info|normal)")';

const ERR_LOGSQL = `(${ERR_FIELDS_LOGSQL.slice(1, -1)} OR _msg:i(error) OR _msg:i(err) OR _msg:i(fatal) OR _msg:i(critical) OR _msg:i(panic) OR _msg:i(oomkilled) OR _msg:i(exception))`;
const WARN_LOGSQL = `(${WARN_FIELDS_LOGSQL.slice(1, -1)} OR _msg:i(warn) OR _msg:i(warning))`;
const DEBUG_LOGSQL = `(${DEBUG_FIELDS_LOGSQL.slice(1, -1)} OR _msg:i(debug) OR _msg:i(trace))`;
const INFO_LOGSQL = `(${INFO_FIELDS_LOGSQL.slice(1, -1)} OR _msg:i(info) OR _msg:i(information))`;

export function classifyLogLevel(entry: VictoriaLogEntry): LogLevel {
  const structured = [entry.level, entry.severity, entry.lvl, entry['log.level'], entry.type]
    .filter((v) => typeof v === 'string' && v.trim().length > 0)
    .join(' ')
    .toLowerCase();

  if (structured) {
    if (/(err|fatal|crit|panic)/.test(structured)) return 'error';
    if (/(warn)/.test(structured)) return 'warning';
    if (/(debug|trace)/.test(structured)) return 'debug';
    if (/(info|notice|normal)/.test(structured)) return 'info';
  }

  const msg = String(entry._msg ?? '');
  if (/\b(error|err|fatal|critical|panic|oomkilled|exception)\b/i.test(msg)) return 'error';
  if (/\b(warn|warning)\b/i.test(msg)) return 'warning';
  if (/\b(debug|trace)\b/i.test(msg)) return 'debug';
  if (/\b(info|information)\b/i.test(msg)) return 'info';

  return 'other';
}

export function buildLogsQLLevelFilter(selectedLevels: LogLevel[]): string | null {
  const unique = Array.from(new Set(selectedLevels));
  if (unique.length === 0 || unique.length >= ALL_LOG_LEVELS.length) {
    return null;
  }

  const selected = new Set(unique);
  const priorityOrder: Array<{ level: Exclude<LogLevel, 'other'>; expr: string }> = [
    { level: 'error', expr: ERR_LOGSQL },
    { level: 'warning', expr: WARN_LOGSQL },
    { level: 'debug', expr: DEBUG_LOGSQL },
    { level: 'info', expr: INFO_LOGSQL },
  ];

  if (selected.has('other')) {
    const unselectedKnown = priorityOrder.filter((p) => !selected.has(p.level));
    if (unselectedKnown.length === 0) return null;
    const excludedUnion =
      unselectedKnown.length === 1
        ? unselectedKnown[0].expr
        : `(${unselectedKnown.map((p) => p.expr).join(' OR ')})`;
    return `NOT ${excludedUnion}`;
  }

  const clauses: string[] = [];
  for (let i = 0; i < priorityOrder.length; i++) {
    const { level, expr } = priorityOrder[i];
    if (!selected.has(level)) continue;
    const unselectedHigher = priorityOrder.slice(0, i).filter((p) => !selected.has(p.level));
    if (unselectedHigher.length === 0) {
      clauses.push(expr);
    } else if (unselectedHigher.length === 1) {
      clauses.push(`(${expr} AND NOT ${unselectedHigher[0].expr})`);
    } else {
      clauses.push(`(${expr} AND NOT (${unselectedHigher.map((p) => p.expr).join(' OR ')}))`);
    }
  }

  return clauses.length === 1 ? clauses[0] : `(${clauses.join(' OR ')})`;
}

export function injectLogsQLFilter(baseQuery: string, filterExpr: string | null): string {
  const trimmed = baseQuery.trim() || '*';
  if (!filterExpr) return trimmed;
  const { filterPart, pipePart } = splitFirstUnquotedPipe(trimmed);
  const nextFilter =
    !filterPart || filterPart === '*' ? filterExpr : `(${filterPart}) AND (${filterExpr})`;
  return pipePart ? `${nextFilter} ${pipePart}` : nextFilter;
}

export function hasCustomLimitOrTransformPipe(query: string): boolean {
  const { pipePart } = splitFirstUnquotedPipe(query.trim() || '*');
  if (!pipePart) return false;
  return /\|\s*(stats|limit|top|uniq|count_uniq|histogram|sort|offset)\b/i.test(pipePart);
}

function buildSortedQueryIfEligible(query: string, limit: number, sortDesc: boolean): {
  effectiveQuery: string;
  limitParam: string;
} {
  const trimmed = query.trim() || '*';
  if (!sortDesc || hasCustomLimitOrTransformPipe(trimmed)) {
    return { effectiveQuery: trimmed, limitParam: String(limit) };
  }
  return {
    effectiveQuery: `${trimmed} | sort by (_time desc) limit ${limit}`,
    limitParam: String(limit),
  };
}

export async function queryVictoriaLogs(
  query: string,
  limit = 100,
  startIso?: string,
  endIso?: string,
  target: DatasourceTarget | string = '',
  options?: { sortDesc?: boolean; signal?: AbortSignal },
): Promise<VictoriaLogsQueryResult> {
  if (!target) {
    throw new Error('No VictoriaLogs datasource configured.');
  }
  const sortDesc = options?.sortDesc ?? true;
  const { effectiveQuery, limitParam } = buildSortedQueryIfEligible(query, limit, sortDesc);
  const params = new URLSearchParams({
    query: effectiveQuery,
    limit: limitParam,
  });
  if (startIso) params.set('start', startIso);
  if (endIso) params.set('end', endIso);

  const started = performance.now();
  const basePath = toProxyBasePath(target);
  const url = `${basePath}/select/logsql/query?${params.toString()}`;
  const res = await persesFetchFn(url, {
    method: 'GET',
    credentials: 'include',
    signal: options?.signal,
    headers: { Accept: 'application/stream+json, application/json, text/plain' },
  });
  const durationMs = Math.round(performance.now() - started);

  if (res.status === 401) {
    throw new UnauthorizedError('Session expired while querying VictoriaLogs');
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`VictoriaLogs HTTP ${res.status}: ${body || res.statusText}`);
  }

  const text = await res.text();
  const entries: VictoriaLogEntry[] = [];
  let malformedLines = 0;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parsed = safeParseNdjsonLine<VictoriaLogEntry>(trimmed);
    if (parsed) {
      entries.push(parsed);
    } else {
      malformedLines += 1;
    }
  }
  return { entries, durationMs, malformedLines };
}

export interface VictoriaLogsChunkedExportResult {
  rawLines?: string[];
  entries?: VictoriaLogEntry[];
  count: number;
  truncatedByMax: boolean;
}

export async function fetchVictoriaLogsChunked(options: {
  query: string;
  startIso: string;
  endIso: string;
  target: DatasourceTarget | string;
  maxRows: number;
  chunkSize?: number;
  rawLinesOnly?: boolean;
  signal?: AbortSignal;
  onProgress?: (count: number) => void;
}): Promise<VictoriaLogsChunkedExportResult> {
  const {
    query,
    startIso,
    endIso,
    target,
    maxRows,
    chunkSize = 1000,
    rawLinesOnly = false,
    signal,
    onProgress,
  } = options;
  const basePath = toProxyBasePath(target);
  const trimmed = query.trim() || '*';
  const hasCustomPipe = hasCustomLimitOrTransformPipe(trimmed);

  let cursorEnd = endIso;
  let total = 0;
  const rawLines: string[] = [];
  const entries: VictoriaLogEntry[] = [];
  let truncatedByMax = false;

  while (total < maxRows) {
    if (signal?.aborted) {
      throw new DOMException('Export cancelled by user', 'AbortError');
    }
    const batchLimit = Math.min(chunkSize, maxRows - total);
    const effectiveQuery = hasCustomPipe ? trimmed : `${trimmed} | sort by (_time desc) limit ${batchLimit}`;
    const params = new URLSearchParams({
      query: effectiveQuery,
      limit: String(batchLimit),
      start: startIso,
      end: cursorEnd,
    });
    const res = await persesFetchFn(`${basePath}/select/logsql/query?${params.toString()}`, {
      method: 'GET',
      credentials: 'include',
      signal,
      headers: { Accept: 'application/stream+json, application/json, text/plain' },
    });
    if (res.status === 401) {
      throw new UnauthorizedError('Session expired while exporting VictoriaLogs');
    }
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`VictoriaLogs export HTTP ${res.status}: ${body || res.statusText}`);
    }

    const text = await res.text();
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    if (lines.length === 0) break;

    if (rawLinesOnly) {
      for (const line of lines) {
        rawLines.push(line);
      }
    } else {
      for (const line of lines) {
        const parsed = safeParseNdjsonLine<VictoriaLogEntry>(line);
        if (parsed) entries.push(parsed);
      }
    }

    total += lines.length;
    onProgress?.(total);

    if (hasCustomPipe || lines.length < batchLimit) {
      break;
    }

    let oldestTs = '';
    const lastObj = safeParseNdjsonLine<{ _time?: string }>(lines[lines.length - 1]);
    oldestTs = String(lastObj?._time ?? '').trim();
    if (!oldestTs || oldestTs === cursorEnd || oldestTs <= startIso) {
      break;
    }
    cursorEnd = oldestTs;
    if (total >= maxRows) {
      truncatedByMax = true;
      break;
    }
  }

  return rawLinesOnly
    ? { rawLines, count: total, truncatedByMax }
    : { entries, count: total, truncatedByMax };
}

export async function queryVictoriaLogsHits(
  query: string,
  startIso: string,
  endIso: string,
  stepSeconds: number,
  target: DatasourceTarget | string,
  signal?: AbortSignal,
): Promise<VictoriaLogHitBucket[]> {
  const params = new URLSearchParams({
    query: query.trim() || '*',
    start: startIso,
    end: endIso,
    step: `${stepSeconds}s`,
  });
  const basePath = toProxyBasePath(target);
  const url = `${basePath}/select/logsql/hits?${params.toString()}`;
  const res = await persesFetchFn(url, {
    method: 'GET',
    credentials: 'include',
    signal,
    headers: { Accept: 'application/json' },
  });
  if (res.status === 401) {
    throw new UnauthorizedError('Session expired while fetching VictoriaLogs hits');
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`VictoriaLogs hits HTTP ${res.status}: ${body || res.statusText}`);
  }
  const payload = (await res.json()) as {
    hits?: Array<{ timestamps?: string[]; values?: number[] }>;
  };

  const bucketsByTs = new Map<string, number>();
  for (const series of payload.hits ?? []) {
    const tsList = series.timestamps ?? [];
    const valList = series.values ?? [];
    for (let i = 0; i < tsList.length; i++) {
      const ts = tsList[i];
      bucketsByTs.set(ts, (bucketsByTs.get(ts) ?? 0) + (valList[i] ?? 0));
    }
  }

  const sorted = Array.from(bucketsByTs.entries()).sort(([a], [b]) => a.localeCompare(b));
  return sorted.map(([timestamp, count], idx) => {
    const d = new Date(timestamp);
    const nextTs = sorted[idx + 1]?.[0];
    const endDate =
      nextTs && !Number.isNaN(new Date(nextTs).getTime())
        ? new Date(nextTs)
        : new Date(d.getTime() + stepSeconds * 1000);
    const label = Number.isNaN(d.getTime())
      ? timestamp
      : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    return {
      timestamp,
      endTimestamp: Number.isNaN(endDate.getTime()) ? timestamp : endDate.toISOString(),
      label,
      count,
      counts: { error: 0, warning: 0, info: 0, debug: 0, other: count },
    };
  });
}

export type HistogramGroupBy = 'level' | 'container' | 'stream';

export interface VictoriaLogGroupHitBucket {
  timestamp: string;
  endTimestamp: string;
  label: string;
  count: number;
  groups: Record<string, number>;
}

export async function queryVictoriaLogsFieldHistogram(
  query: string,
  startIso: string,
  endIso: string,
  stepSeconds: number,
  target: DatasourceTarget | string,
  field: 'kubernetes.container_name' | '_stream',
  fieldsLimit = 10,
  signal?: AbortSignal,
): Promise<{ buckets: VictoriaLogGroupHitBucket[]; seriesKeys: string[] }> {
  const safeStep = Math.max(1, stepSeconds);
  const params = new URLSearchParams({
    query: query.trim() || '*',
    start: startIso,
    end: endIso,
    step: `${safeStep}s`,
    field,
    fields_limit: String(fieldsLimit),
  });
  const basePath = toProxyBasePath(target);
  const url = `${basePath}/select/logsql/hits?${params.toString()}`;
  const res = await persesFetchFn(url, {
    method: 'GET',
    credentials: 'include',
    signal,
    headers: { Accept: 'application/json' },
  });
  if (res.status === 401) {
    throw new UnauthorizedError('Session expired while fetching VictoriaLogs grouped hits');
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`VictoriaLogs grouped hits HTTP ${res.status}: ${body || res.statusText}`);
  }
  const payload = (await res.json()) as {
    hits?: Array<{ fields?: Record<string, string>; timestamps?: string[]; values?: number[] }>;
  };

  const bucketsByTs = new Map<string, Record<string, number>>();
  const totalsByKey = new Map<string, number>();

  for (const series of payload.hits ?? []) {
    const rawVal = series.fields?.[field]?.trim() || 'other';
    const key = rawVal === '{}' ? 'other' : rawVal;
    const tsList = series.timestamps ?? [];
    const valList = series.values ?? [];
    for (let i = 0; i < tsList.length; i++) {
      const ts = tsList[i];
      const v = valList[i] ?? 0;
      let bucket = bucketsByTs.get(ts);
      if (!bucket) {
        bucket = {};
        bucketsByTs.set(ts, bucket);
      }
      bucket[key] = (bucket[key] ?? 0) + v;
      totalsByKey.set(key, (totalsByKey.get(key) ?? 0) + v);
    }
  }

  const seriesKeys = Array.from(totalsByKey.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k);

  const sorted = Array.from(bucketsByTs.entries()).sort(([a], [b]) => a.localeCompare(b));
  const buckets = sorted.map(([timestamp, groups], idx) => {
    const d = new Date(timestamp);
    const nextTs = sorted[idx + 1]?.[0];
    const endDate =
      nextTs && !Number.isNaN(new Date(nextTs).getTime())
        ? new Date(nextTs)
        : new Date(d.getTime() + safeStep * 1000);
    const label = Number.isNaN(d.getTime())
      ? timestamp
      : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const count = Object.values(groups).reduce((sum, n) => sum + n, 0);
    return {
      timestamp,
      endTimestamp: Number.isNaN(endDate.getTime()) ? timestamp : endDate.toISOString(),
      label,
      count,
      groups,
    };
  });

  return { buckets, seriesKeys };
}

function hasUnsupportedHistogramPipe(pipePart: string): boolean {
  if (!pipePart) return false;
  return /\|\s*(stats|limit|top|uniq|count_uniq|histogram|fields|drop|rename|extract|unpack_json|unpack_syslog)\b/i.test(
    pipePart,
  );
}

function stripTrailingSortPipes(pipePart: string): string {
  if (!pipePart) return '';
  return pipePart.replace(/\|\s*sort\b[^|]*/gi, '').trim();
}

function scopeBucketCountsToSelectedLevels(
  counts: Record<LogLevel, number>,
  selectedLevels?: LogLevel[],
): Record<LogLevel, number> {
  if (!selectedLevels || selectedLevels.length === 0 || selectedLevels.length >= ALL_LOG_LEVELS.length) {
    return counts;
  }

  const activeSet = new Set(selectedLevels);
  const next: Record<LogLevel, number> = {
    error: activeSet.has('error') ? counts.error : 0,
    warning: activeSet.has('warning') ? counts.warning : 0,
    info: activeSet.has('info') ? counts.info : 0,
    debug: activeSet.has('debug') ? counts.debug : 0,
    other: activeSet.has('other') ? counts.other : 0,
  };

  if (!activeSet.has('other') && counts.other > 0) {
    const activeKnown = ALL_LOG_LEVELS.filter((l): l is Exclude<LogLevel, 'other'> => l !== 'other' && activeSet.has(l));
    if (activeKnown.length === 1) {
      next[activeKnown[0]] += counts.other;
    } else if (activeKnown.length > 1) {
      const knownSum = activeKnown.reduce((acc, l) => acc + next[l], 0);
      if (knownSum > 0) {
        let distributed = 0;
        for (let i = 0; i < activeKnown.length; i++) {
          const lvl = activeKnown[i];
          const share =
            i === activeKnown.length - 1
              ? counts.other - distributed
              : Math.round((counts.other * next[lvl]) / knownSum);
          next[lvl] += share;
          distributed += share;
        }
      } else {
        next[activeKnown[0]] += counts.other;
      }
    }
  }

  return next;
}

export async function queryVictoriaLogsLevelHistogram(
  query: string,
  startIso: string,
  endIso: string,
  stepSeconds: number,
  target: DatasourceTarget | string,
  selectedLevels?: LogLevel[],
  signal?: AbortSignal,
): Promise<{ buckets: VictoriaLogHitBucket[]; stacked: boolean }> {
  const safeStep = Math.max(1, stepSeconds);
  const startMs = new Date(startIso).getTime();
  const endMs = new Date(endIso).getTime();

  const { filterPart, pipePart } = splitFirstUnquotedPipe(query.trim() || '*');

  if (!hasUnsupportedHistogramPipe(pipePart)) {
    const baseFilter = filterPart || '*';
    const extraPipes = stripTrailingSortPipes(pipePart);
    const prefix = extraPipes ? `${baseFilter} ${extraPipes}` : baseFilter;
    const statsQuery =
      `${prefix} | stats by (_time:${safeStep}s) count() switch(` +
      `case (${ERR_FIELDS_LOGSQL}) as error, ` +
      `case (${WARN_FIELDS_LOGSQL}) as warning, ` +
      `case (${DEBUG_FIELDS_LOGSQL}) as debug, ` +
      `case (${INFO_FIELDS_LOGSQL}) as info, ` +
      `default as other)`;

    try {
      const params = new URLSearchParams({
        query: statsQuery,
        start: startIso,
        end: endIso,
        limit: '500',
      });
      const basePath = toProxyBasePath(target);
      const url = `${basePath}/select/logsql/query?${params.toString()}`;
      const res = await persesFetchFn(url, {
        method: 'GET',
        credentials: 'include',
        signal,
        headers: { Accept: 'application/stream+json, application/json, text/plain' },
      });
      if (res.status === 401) {
        throw new UnauthorizedError('Session expired while fetching VictoriaLogs level histogram');
      }
      if (res.ok) {
        const text = await res.text();
        const rowsBySlot = new Map<number, Record<LogLevel, number>>();
        const stepMs = safeStep * 1000;
        const alignedStart = Math.floor(startMs / stepMs) * stepMs;

        for (const line of text.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          const row = safeParseNdjsonLine<Record<string, string | number>>(trimmed);
          if (!row) continue;
          const tsRaw = String(row._time ?? '');
          const tsMs = new Date(tsRaw).getTime();
          if (!Number.isFinite(tsMs)) continue;
          const slot = Math.floor(tsMs / stepMs) * stepMs;
          const error = Math.max(0, Number(row.error ?? 0) || 0);
          const warning = Math.max(0, Number(row.warning ?? 0) || 0);
          const debug = Math.max(0, Number(row.debug ?? 0) || 0);
          const info = Math.max(0, Number(row.info ?? 0) || 0);
          const hasExplicitOther = row.other !== undefined;
          const other = hasExplicitOther
            ? Math.max(0, Number(row.other ?? 0) || 0)
            : Math.max(0, (Number(row.total ?? 0) || 0) - error - warning - debug - info);

          const prev = rowsBySlot.get(slot) ?? { error: 0, warning: 0, info: 0, debug: 0, other: 0 };
          rowsBySlot.set(slot, {
            error: prev.error + error,
            warning: prev.warning + warning,
            info: prev.info + info,
            debug: prev.debug + debug,
            other: prev.other + other,
          });
        }

        const buckets: VictoriaLogHitBucket[] = [];
        for (let slot = alignedStart; slot <= endMs; slot += stepMs) {
          const d = new Date(slot);
          const dEnd = new Date(Math.min(endMs, slot + stepMs));
          const rawCounts = rowsBySlot.get(slot) ?? { error: 0, warning: 0, info: 0, debug: 0, other: 0 };
          const counts = scopeBucketCountsToSelectedLevels(rawCounts, selectedLevels);
          const count = counts.error + counts.warning + counts.info + counts.debug + counts.other;
          buckets.push({
            timestamp: new Date(Math.max(startMs, slot)).toISOString(),
            endTimestamp: dEnd.toISOString(),
            label: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
            count,
            counts,
          });
        }

        if (buckets.length > 0) {
          return { buckets, stacked: true };
        }
      }
    } catch (err) {
      if (err instanceof UnauthorizedError) throw err;
      if (signal?.aborted || (err instanceof DOMException && err.name === 'AbortError')) throw err;
    }
  }

  const hits = await queryVictoriaLogsHits(query, startIso, endIso, safeStep, target, signal);
  return { buckets: hits, stacked: false };
}

export interface LogPresetItem {
  id: string;
  label: string;
  query: string;
  description?: string;
}

export const DEFAULT_LOG_PRESETS: LogPresetItem[] = [
  { id: 'all-logs', label: 'All logs (*)', query: '*' },
  { id: 'k8s-events', label: 'K8s Events', query: 'stream:="k8s_events"' },
  {
    id: 'k8s-audit-mutations',
    label: 'K8s Audit (Mutations)',
    query: 'stream:="k8s_audit" verb:~"create|update|patch|delete"',
  },
  {
    id: 'k8s-audit-crd-rbac',
    label: 'K8s CRD & RBAC Audit',
    query:
      'stream:="k8s_audit" objectRef.resource:~"customresourcedefinitions|clusterroles|clusterrolebindings|roles|rolebindings"',
  },
  {
    id: 'perses-api-audit',
    label: 'Perses UI / Auth Audit',
    query: 'audit_type:="perses_api" method:~"POST|PUT|PATCH|DELETE"',
  },
  { id: 'errors-warnings', label: 'Errors / Warnings', query: 'error OR warn OR OOMKilled' },
  { id: 'pod-restarts', label: 'Pod BackOff / OOM', query: 'CrashLoopBackOff OR ImagePullBackOff OR OOMKilled' },
];

const LOG_PRESETS_VAR_NAME = 'log_presets_config';
const LOG_PRESETS_STORAGE_KEY = 'perses-log-presets-config';

function normalizeLogPresets(raw: unknown): LogPresetItem[] {
  if (!Array.isArray(raw)) return DEFAULT_LOG_PRESETS;
  const items = raw
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    .map((item, idx) => ({
      id: typeof item.id === 'string' && item.id.trim() ? item.id.trim() : `preset-${idx + 1}`,
      label: typeof item.label === 'string' && item.label.trim() ? item.label.trim() : `Preset ${idx + 1}`,
      query: typeof item.query === 'string' && item.query.trim() ? item.query : '*',
      description: typeof item.description === 'string' ? item.description : undefined,
    }));
  return items.length > 0 ? items : DEFAULT_LOG_PRESETS;
}

export function fetchLogPresetsConfig(): Promise<LogPresetItem[]> {
  return fetchGlobalJsonConfig(
    LOG_PRESETS_VAR_NAME,
    LOG_PRESETS_STORAGE_KEY,
    normalizeLogPresets,
    DEFAULT_LOG_PRESETS,
  );
}

export function setLocalLogPresets(presets: LogPresetItem[]): void {
  try {
    window.localStorage.setItem(LOG_PRESETS_STORAGE_KEY, JSON.stringify(presets));
  } catch {
    // Ignore storage quota errors
  }
}

export function saveLogPresetsConfig(presets: LogPresetItem[]): Promise<LogPresetItem[]> {
  return saveGlobalJsonConfig(
    LOG_PRESETS_VAR_NAME,
    LOG_PRESETS_STORAGE_KEY,
    presets,
    'Log Explorer Presets',
    'Cluster-wide shared VictoriaLogs LogsQL query presets.',
  );
}
