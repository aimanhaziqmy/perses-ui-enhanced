import type { DatasourceTarget } from './datasources';
import {
  type LogLevel,
  type VictoriaLogEntry,
  classifyLogLevel,
  hasCustomLimitOrTransformPipe,
  queryVictoriaLogs,
} from './logs';

export interface NormalizedLogEntry {
  id: string;
  timestamp: string;
  timestampMs: number;
  severity: LogLevel;
  message: string;
  namespace: string;
  pod: string;
  container: string;
  stream: string;
  labels: Record<string, string>;
  raw: Record<string, unknown>;
}

export interface LogQueryParams {
  query: string;
  limit: number;
  startIso?: string;
  endIso?: string;
  sortDesc?: boolean;
  signal?: AbortSignal;
}

export interface LogQueryResult {
  entries: NormalizedLogEntry[];
  durationMs: number;
  malformedLines?: number;
}

export interface LiveTailOptions {
  query: string;
  pollIntervalMs?: number;
  initialLookbackSeconds?: number;
  limitPerPoll?: number;
  onEntries: (entries: NormalizedLogEntry[]) => void;
  onError?: (err: Error) => void;
}

export interface LiveTailHandle {
  stop: () => void;
}

export interface LogDatasourceAdapter {
  readonly id: string;
  readonly name: string;
  readonly providerKind: 'victorialogs' | 'logging-operator' | 'otlp' | 'custom';
  queryLogs(params: LogQueryParams): Promise<LogQueryResult>;
  startLiveTail(options: LiveTailOptions): LiveTailHandle;
}

function asNonEmptyString(val: unknown): string {
  if (typeof val === 'string') return val.trim();
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  return '';
}

function readNestedField(obj: Record<string, unknown>, path: string[]): string {
  let curr: unknown = obj;
  for (const key of path) {
    if (!curr || typeof curr !== 'object') return '';
    curr = (curr as Record<string, unknown>)[key];
  }
  return asNonEmptyString(curr);
}

function pickFirstString(obj: Record<string, unknown>, candidates: Array<string | string[]>): string {
  for (const candidate of candidates) {
    const val = Array.isArray(candidate)
      ? readNestedField(obj, candidate)
      : asNonEmptyString(obj[candidate]);
    if (val) return val;
  }
  return '';
}

function parseTimestampMs(ts: string): number {
  if (!ts) return 0;
  const ms = Date.parse(ts);
  if (!Number.isNaN(ms)) return ms;
  const numeric = Number(ts);
  if (!Number.isNaN(numeric) && numeric > 0) {
    // Handle seconds vs milliseconds vs nanoseconds epoch
    if (numeric > 1e15) return Math.floor(numeric / 1e6);
    if (numeric > 1e12) return Math.floor(numeric);
    return Math.floor(numeric * 1000);
  }
  return 0;
}

const RESERVED_MESSAGE_FIELDS = new Set([
  '_time',
  '_msg',
  '_stream_id',
  'time',
  'timestamp',
  '@timestamp',
  'ts',
  'log',
  'message',
  'msg',
  'body',
]);

function flattenLabels(raw: Record<string, unknown>): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const [key, val] of Object.entries(raw)) {
    if (RESERVED_MESSAGE_FIELDS.has(key)) continue;
    if (val === null || val === undefined) continue;
    if (typeof val === 'object' && !Array.isArray(val)) {
      for (const [subKey, subVal] of Object.entries(val as Record<string, unknown>)) {
        const str = asNonEmptyString(subVal);
        if (str) labels[`${key}.${subKey}`] = str;
      }
    } else {
      const str = Array.isArray(val) ? JSON.stringify(val) : asNonEmptyString(val);
      if (str) labels[key] = str;
    }
  }
  return labels;
}

/**
 * Normalizes log records from VictoriaLogs (_time, _msg, _stream) as well as
 * CNCF Logging Operator / Fluent Bit / Fluentd / Syslog-ng / OTel pipelines
 * (kubernetes.namespace_name, kubernetes.pod_name, kubernetes.container_name, log, level, time).
 */
export function normalizeLogRecord(
  rawRecord: Record<string, unknown>,
  indexHint = 0,
): NormalizedLogEntry {
  const timestamp =
    pickFirstString(rawRecord, ['_time', 'time', 'timestamp', '@timestamp', 'ts']) ||
    new Date().toISOString();
  const timestampMs = parseTimestampMs(timestamp);

  let message = pickFirstString(rawRecord, ['_msg', 'log', 'message', 'msg', 'body']);
  if (!message && rawRecord.log && typeof rawRecord.log === 'object') {
    message = JSON.stringify(rawRecord.log);
  }

  const namespace = pickFirstString(rawRecord, [
    ['kubernetes', 'namespace_name'],
    ['kubernetes', 'pod_namespace'],
    'kubernetes.namespace_name',
    'kubernetes.pod_namespace',
    'k8s.namespace.name',
    'k8s_namespace_name',
    'namespace_name',
    'namespace',
  ]);

  const pod = pickFirstString(rawRecord, [
    ['kubernetes', 'pod_name'],
    'kubernetes.pod_name',
    'k8s.pod.name',
    'k8s_pod_name',
    'pod_name',
    'pod',
  ]);

  const container = pickFirstString(rawRecord, [
    ['kubernetes', 'container_name'],
    'kubernetes.container_name',
    'k8s.container.name',
    'k8s_container_name',
    'container_name',
    'container',
  ]);

  const stream =
    pickFirstString(rawRecord, ['_stream', 'stream', 'tag', 'source']) ||
    [namespace, pod, container].filter(Boolean).join('/');

  const severitySource: VictoriaLogEntry = {
    _time: timestamp,
    _msg: message,
    _stream: stream,
    level: pickFirstString(rawRecord, ['level', 'log.level', ['log', 'level']]),
    severity: pickFirstString(rawRecord, ['severity', 'severity_text', 'SeverityText']),
    lvl: pickFirstString(rawRecord, ['lvl']),
    type: pickFirstString(rawRecord, ['type']),
  };
  const severity = classifyLogLevel(severitySource);

  const labels = flattenLabels(rawRecord);
  const stableIdSeed = `${timestamp}|${stream}|${pod}|${message.slice(0, 96)}|${indexHint}`;

  return {
    id: stableIdSeed,
    timestamp,
    timestampMs,
    severity,
    message,
    namespace,
    pod,
    container,
    stream,
    labels,
    raw: rawRecord,
  };
}

/**
 * Converts a NormalizedLogEntry into a flat VictoriaLogEntry-compatible record
 * for detail drawers, JSON viewers, and structured field tables.
 */
export function toFlatLogRecord(entry: NormalizedLogEntry): VictoriaLogEntry {
  return {
    _time: entry.timestamp,
    _msg: entry.message,
    _stream: entry.stream,
    ...entry.labels,
  };
}

export class VictoriaLogsDatasourceAdapter implements LogDatasourceAdapter {
  readonly id: string;
  readonly name: string;
  readonly providerKind = 'victorialogs' as const;
  private readonly target: DatasourceTarget | string;

  constructor(target: DatasourceTarget | string) {
    this.target = target;
    if (typeof target === 'string') {
      this.id = target;
      this.name = target;
    } else {
      this.id = `${target.scope}:${target.project ?? ''}:${target.name}`;
      this.name = target.name;
    }
  }

  async queryLogs(params: LogQueryParams): Promise<LogQueryResult> {
    const res = await queryVictoriaLogs(
      params.query,
      params.limit,
      params.startIso,
      params.endIso,
      this.target,
      { sortDesc: params.sortDesc ?? true, signal: params.signal },
    );
    return {
      entries: res.entries.map((raw, idx) => normalizeLogRecord(raw, idx)),
      durationMs: res.durationMs,
      malformedLines: res.malformedLines,
    };
  }

  startLiveTail(options: LiveTailOptions): LiveTailHandle {
    const pollIntervalMs = Math.max(250, options.pollIntervalMs ?? 1000);
    const initialLookbackMs = (options.initialLookbackSeconds ?? 60) * 1000;
    const limitPerPoll = options.limitPerPoll ?? 500;

    let stopped = false;
    let timerId: number | null = null;
    let activeAbort: AbortController | null = null;
    let lastSeenIso = new Date(Date.now() - initialLookbackMs).toISOString();
    let seenAtLastTimestamp = new Set<string>();

    // Strip custom sort/limit pipes if present? Preserve filter part for live tail
    const baseQuery = hasCustomLimitOrTransformPipe(options.query)
      ? options.query
      : `${options.query.trim() || '*'} | sort by (_time asc)`;

    const pollOnce = async () => {
      if (stopped) return;
      activeAbort = new AbortController();
      const nowIso = new Date().toISOString();

      try {
        const res = await queryVictoriaLogs(
          baseQuery,
          limitPerPoll,
          lastSeenIso,
          nowIso,
          this.target,
          { sortDesc: false, signal: activeAbort.signal },
        );

        if (stopped) return;

        const normalized = res.entries
          .map((raw, idx) => normalizeLogRecord(raw, idx))
          .sort((a, b) => a.timestampMs - b.timestampMs || a.timestamp.localeCompare(b.timestamp));

        const fresh: NormalizedLogEntry[] = [];
        let maxIso = lastSeenIso;
        let maxMs = parseTimestampMs(lastSeenIso);

        for (const item of normalized) {
          const itemFingerprint = `${item.timestamp}|${item.stream}|${item.message}`;
          if (item.timestamp === lastSeenIso && seenAtLastTimestamp.has(itemFingerprint)) {
            continue;
          }
          if (item.timestampMs > 0 && maxMs > 0) {
            if (item.timestampMs < maxMs) continue;
            if (item.timestampMs === maxMs && item.timestamp < lastSeenIso) continue;
          }
          fresh.push(item);

          if (item.timestampMs > maxMs || (item.timestampMs === maxMs && item.timestamp > maxIso)) {
            maxMs = item.timestampMs;
            maxIso = item.timestamp;
            seenAtLastTimestamp = new Set([itemFingerprint]);
          } else if (item.timestamp === maxIso) {
            seenAtLastTimestamp.add(itemFingerprint);
          }
        }

        if (fresh.length > 0) {
          lastSeenIso = maxIso;
          options.onEntries(fresh);
        } else if (seenAtLastTimestamp.size === 0) {
          // Advance cursor slightly so empty windows don't repeatedly scan stale minutes
          lastSeenIso = nowIso;
        }
      } catch (err) {
        if (stopped) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        options.onError?.(err instanceof Error ? err : new Error(String(err)));
      } finally {
        activeAbort = null;
        if (!stopped) {
          timerId = window.setTimeout(() => {
            void pollOnce();
          }, pollIntervalMs);
        }
      }
    };

    void pollOnce();

    return {
      stop: () => {
        stopped = true;
        if (timerId !== null) {
          window.clearTimeout(timerId);
          timerId = null;
        }
        if (activeAbort) {
          activeAbort.abort();
          activeAbort = null;
        }
      },
    };
  }
}

export function createLogDatasourceAdapter(target: DatasourceTarget | string): LogDatasourceAdapter {
  return new VictoriaLogsDatasourceAdapter(target);
}
