import type { DatasourceTarget } from './datasources';
import { UnauthorizedError, persesFetchFn, toProxyBasePath } from './http';

export interface TraceTag {
  key: string;
  value: string;
}

export interface TraceSpan {
  spanId: string;
  parentSpanId?: string;
  operationName: string;
  serviceName: string;
  startTimeUs: number;
  durationUs: number;
  relativeStartUs: number;
  depth: number;
  hasError: boolean;
  tags: TraceTag[];
  processTags: TraceTag[];
}

export interface TraceSummary {
  traceId: string;
  rootService: string;
  rootOperation: string;
  startTimeUs: number;
  durationUs: number;
  spanCount: number;
  errorCount: number;
  services: string[];
}

export interface TraceDetail extends TraceSummary {
  spans: TraceSpan[];
}

interface RawJaegerSpan {
  spanID?: string;
  operationName?: string;
  startTime?: number;
  duration?: number;
  processID?: string;
  references?: Array<{ refType?: string; spanID?: string }>;
  tags?: Array<{ key?: string; value?: unknown }>;
}

interface RawJaegerTrace {
  traceID?: string;
  spans?: RawJaegerSpan[];
  processes?: Record<string, { serviceName?: string; tags?: Array<{ key?: string; value?: unknown }> }>;
}

export function normalizeJaegerTrace(raw: RawJaegerTrace): TraceDetail {
  const traceId = String(raw.traceID ?? '');
  const processes = raw.processes ?? {};
  const rawSpans = Array.isArray(raw.spans) ? raw.spans : [];

  let minStartUs = Number.POSITIVE_INFINITY;
  let maxEndUs = 0;

  const flatSpans: TraceSpan[] = rawSpans.map((s) => {
    const startUs = Number(s.startTime ?? 0);
    const durUs = Math.max(0, Number(s.duration ?? 0));
    if (startUs < minStartUs) minStartUs = startUs;
    if (startUs + durUs > maxEndUs) maxEndUs = startUs + durUs;

    const proc = s.processID ? processes[s.processID] : undefined;
    const serviceName = proc?.serviceName || 'unknown';
    const childOf = (s.references ?? []).find((r) => r.refType === 'CHILD_OF' || !r.refType);
    const tags: TraceTag[] = (s.tags ?? [])
      .filter((t) => Boolean(t.key))
      .map((t) => ({ key: String(t.key), value: String(t.value ?? '') }));
    const processTags: TraceTag[] = (proc?.tags ?? [])
      .filter((t) => Boolean(t.key))
      .map((t) => ({ key: String(t.key), value: String(t.value ?? '') }));

    const hasError = tags.some(
      (t) =>
        (t.key === 'error' && t.value === 'true') ||
        (t.key === 'otel.status_code' && t.value.toUpperCase() === 'ERROR') ||
        (t.key === 'http.status_code' && Number(t.value) >= 500),
    );

    return {
      spanId: String(s.spanID ?? ''),
      parentSpanId: childOf?.spanID,
      operationName: String(s.operationName ?? 'unknown'),
      serviceName,
      startTimeUs: startUs,
      durationUs: durUs,
      relativeStartUs: 0,
      depth: 0,
      hasError,
      tags,
      processTags,
    };
  });

  return finalizeTraceDetail(traceId, flatSpans, minStartUs, maxEndUs);
}

function finalizeTraceDetail(
  traceId: string,
  flatSpans: TraceSpan[],
  minStartUs: number,
  maxEndUs: number,
): TraceDetail {
  if (!Number.isFinite(minStartUs)) minStartUs = 0;
  const byId = new Map<string, TraceSpan>();
  const childrenByParent = new Map<string, TraceSpan[]>();
  for (const sp of flatSpans) {
    sp.relativeStartUs = Math.max(0, sp.startTimeUs - minStartUs);
    byId.set(sp.spanId, sp);
  }
  const roots: TraceSpan[] = [];
  for (const sp of flatSpans) {
    if (sp.parentSpanId && byId.has(sp.parentSpanId)) {
      const list = childrenByParent.get(sp.parentSpanId) ?? [];
      list.push(sp);
      childrenByParent.set(sp.parentSpanId, list);
    } else {
      roots.push(sp);
    }
  }

  roots.sort((a, b) => a.startTimeUs - b.startTimeUs);
  const ordered: TraceSpan[] = [];
  const visit = (node: TraceSpan, depth: number, visited: Set<string>) => {
    if (visited.has(node.spanId)) return;
    visited.add(node.spanId);
    node.depth = depth;
    ordered.push(node);
    const kids = (childrenByParent.get(node.spanId) ?? []).sort((a, b) => a.startTimeUs - b.startTimeUs);
    for (const k of kids) {
      visit(k, depth + 1, visited);
    }
  };
  const visited = new Set<string>();
  for (const r of roots) visit(r, 0, visited);
  for (const sp of flatSpans) {
    if (!visited.has(sp.spanId)) visit(sp, 0, visited);
  }

  const root = ordered[0];
  const services = Array.from(new Set(ordered.map((s) => s.serviceName)));
  const errorCount = ordered.filter((s) => s.hasError).length;

  return {
    traceId,
    rootService: root?.serviceName ?? services[0] ?? 'unknown',
    rootOperation: root?.operationName ?? 'unknown',
    startTimeUs: minStartUs,
    durationUs: Math.max(0, maxEndUs - minStartUs),
    spanCount: ordered.length,
    errorCount,
    services,
    spans: ordered,
  };
}

interface RawOtlpAttr {
  key?: string;
  value?: {
    stringValue?: string;
    intValue?: string | number;
    doubleValue?: number;
    boolValue?: boolean;
  };
}

interface RawOtlpSpan {
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  name?: string;
  startTimeUnixNano?: string | number;
  endTimeUnixNano?: string | number;
  attributes?: RawOtlpAttr[];
  status?: { code?: number | string; message?: string };
}

export interface RawOtlpResourceSpans {
  resource?: { attributes?: RawOtlpAttr[] };
  scopeSpans?: Array<{ spans?: RawOtlpSpan[] }>;
}

function otlpAttrsToTags(attrs?: RawOtlpAttr[]): TraceTag[] {
  return (attrs ?? [])
    .filter((a) => Boolean(a.key))
    .map((a) => {
      const v = a.value ?? {};
      const str =
        v.stringValue !== undefined
          ? v.stringValue
          : v.intValue !== undefined
            ? String(v.intValue)
            : v.doubleValue !== undefined
              ? String(v.doubleValue)
              : v.boolValue !== undefined
                ? String(v.boolValue)
                : '';
      return { key: String(a.key), value: str };
    });
}

export function normalizeOtlpResourceSpans(resourceSpans: RawOtlpResourceSpans[]): TraceDetail[] {
  const byTrace = new Map<string, { spans: TraceSpan[]; minStartUs: number; maxEndUs: number }>();

  for (const rs of resourceSpans ?? []) {
    const processTags = otlpAttrsToTags(rs.resource?.attributes);
    const serviceName = processTags.find((t) => t.key === 'service.name')?.value || 'unknown';

    for (const ss of rs.scopeSpans ?? []) {
      for (const s of ss.spans ?? []) {
        const traceId = String(s.traceId ?? '');
        if (!traceId) continue;
        const startUs = Math.floor(Number(s.startTimeUnixNano ?? 0) / 1000);
        const endUs = Math.floor(Number(s.endTimeUnixNano ?? 0) / 1000);
        const durUs = Math.max(0, endUs - startUs);
        const tags = otlpAttrsToTags(s.attributes);
        const statusCode = s.status?.code;
        const statusErr = statusCode === 2 || String(statusCode ?? '').toUpperCase() === 'STATUS_CODE_ERROR';
        const hasError =
          statusErr ||
          tags.some(
            (t) =>
              (t.key === 'error' && t.value === 'true') ||
              (t.key === 'otel.status_code' && t.value.toUpperCase() === 'ERROR') ||
              (t.key === 'http.status_code' && Number(t.value) >= 500),
          );

        let bucket = byTrace.get(traceId);
        if (!bucket) {
          bucket = { spans: [], minStartUs: Number.POSITIVE_INFINITY, maxEndUs: 0 };
          byTrace.set(traceId, bucket);
        }
        if (startUs < bucket.minStartUs) bucket.minStartUs = startUs;
        if (startUs + durUs > bucket.maxEndUs) bucket.maxEndUs = startUs + durUs;

        bucket.spans.push({
          spanId: String(s.spanId ?? ''),
          parentSpanId: s.parentSpanId ? String(s.parentSpanId) : undefined,
          operationName: String(s.name ?? 'unknown'),
          serviceName,
          startTimeUs: startUs,
          durationUs: durUs,
          relativeStartUs: 0,
          depth: 0,
          hasError,
          tags,
          processTags,
        });
      }
    }
  }

  return Array.from(byTrace.entries()).map(([traceId, bucket]) =>
    finalizeTraceDetail(traceId, bucket.spans, bucket.minStartUs, bucket.maxEndUs),
  );
}

export function parseJaegerV3TracesResponse(rawText: string): TraceDetail[] {
  const allResourceSpans: RawOtlpResourceSpans[] = [];
  for (const line of rawText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const chunk = JSON.parse(trimmed) as {
        result?: { resourceSpans?: RawOtlpResourceSpans[] };
        resourceSpans?: RawOtlpResourceSpans[];
      };
      const rs = chunk.result?.resourceSpans ?? chunk.resourceSpans ?? [];
      if (Array.isArray(rs) && rs.length > 0) {
        allResourceSpans.push(...rs);
      }
    } catch {
      // Skip malformed NDJSON chunk
    }
  }
  return normalizeOtlpResourceSpans(allResourceSpans);
}

export function buildJaegerSearchParams(params: {
  service?: string;
  operation?: string;
  startIso: string;
  endIso: string;
  minDuration?: string;
  maxDuration?: string;
  tags?: string;
  limit?: number;
}): URLSearchParams {
  const qs = new URLSearchParams();
  if (params.service) qs.set('service', params.service);
  if (params.operation) qs.set('operation', params.operation);
  const startMs = new Date(params.startIso).getTime();
  const endMs = new Date(params.endIso).getTime();
  if (Number.isFinite(startMs)) qs.set('start', String(Math.floor(startMs * 1000)));
  if (Number.isFinite(endMs)) qs.set('end', String(Math.floor(endMs * 1000)));
  if (params.minDuration?.trim()) qs.set('minDuration', params.minDuration.trim());
  if (params.maxDuration?.trim()) qs.set('maxDuration', params.maxDuration.trim());
  if (params.tags?.trim()) {
    const tagMap: Record<string, string> = {};
    for (const part of params.tags.split(/\s+/)) {
      const idx = part.indexOf('=');
      if (idx > 0) {
        tagMap[part.slice(0, idx)] = part.slice(idx + 1);
      }
    }
    if (Object.keys(tagMap).length > 0) {
      qs.set('tags', JSON.stringify(tagMap));
    }
  }
  qs.set('limit', String(params.limit ?? 20));
  return qs;
}

export function buildJaegerV3SearchParams(params: {
  service?: string;
  operation?: string;
  startIso: string;
  endIso: string;
  minDuration?: string;
  maxDuration?: string;
  tags?: string;
  limit?: number;
}): URLSearchParams {
  const qs = new URLSearchParams();
  if (params.service) qs.set('query.service_name', params.service);
  if (params.operation) qs.set('query.operation_name', params.operation);
  const startDate = new Date(params.startIso);
  const endDate = new Date(params.endIso);
  if (!Number.isNaN(startDate.getTime())) qs.set('query.start_time_min', startDate.toISOString());
  if (!Number.isNaN(endDate.getTime())) qs.set('query.start_time_max', endDate.toISOString());
  if (params.minDuration?.trim()) qs.set('query.duration_min', params.minDuration.trim());
  if (params.maxDuration?.trim()) qs.set('query.duration_max', params.maxDuration.trim());
  if (params.tags?.trim()) {
    for (const part of params.tags.split(/\s+/)) {
      const idx = part.indexOf('=');
      if (idx > 0) {
        qs.set(`query.attributes[${part.slice(0, idx)}]`, part.slice(idx + 1));
      }
    }
  }
  qs.set('query.num_traces', String(params.limit ?? 20));
  return qs;
}

export async function fetchTraceServices(target: DatasourceTarget): Promise<string[]> {
  const basePath = toProxyBasePath(target);
  if (target.pluginKind === 'TempoDatasource') {
    const res = await persesFetchFn(`${basePath}/api/search/tag/service.name/values`, { credentials: 'include' });
    if (res.status === 401) throw new UnauthorizedError('Session expired while loading trace services');
    if (!res.ok) throw new Error(`Tempo services HTTP ${res.status}: ${await res.text()}`);
    const payload = (await res.json()) as { tagValues?: string[] };
    return (payload.tagValues ?? []).filter(Boolean).sort();
  }
  const res = await persesFetchFn(`${basePath}/api/services`, { credentials: 'include' });
  if (res.status === 401) throw new UnauthorizedError('Session expired while loading trace services');
  if (res.status === 404) {
    const v3Res = await persesFetchFn(`${basePath}/api/v3/services`, { credentials: 'include' });
    if (v3Res.status === 401) throw new UnauthorizedError('Session expired while loading trace services');
    if (!v3Res.ok) throw new Error(`Jaeger v3 services HTTP ${v3Res.status}: ${await v3Res.text()}`);
    const v3Payload = (await v3Res.json()) as { services?: string[] };
    return (v3Payload.services ?? []).filter(Boolean).sort();
  }
  if (!res.ok) throw new Error(`Jaeger services HTTP ${res.status}: ${await res.text()}`);
  const payload = (await res.json()) as { data?: string[] };
  return (payload.data ?? []).filter(Boolean).sort();
}

export async function fetchTraceOperations(target: DatasourceTarget, service: string): Promise<string[]> {
  if (!service || target.pluginKind === 'TempoDatasource') return [];
  const basePath = toProxyBasePath(target);
  const res = await persesFetchFn(`${basePath}/api/services/${encodeURIComponent(service)}/operations`, {
    credentials: 'include',
  });
  if (res.status === 401) throw new UnauthorizedError('Session expired while loading trace operations');
  if (res.status === 404) {
    const v3Res = await persesFetchFn(
      `${basePath}/api/v3/operations?service=${encodeURIComponent(service)}`,
      { credentials: 'include' },
    );
    if (v3Res.status === 401) throw new UnauthorizedError('Session expired while loading trace operations');
    if (!v3Res.ok) return [];
    const v3Payload = (await v3Res.json()) as { operations?: Array<{ name?: string }> };
    return Array.from(new Set((v3Payload.operations ?? []).map((o) => o.name ?? '').filter(Boolean))).sort();
  }
  if (!res.ok) return [];
  const payload = (await res.json()) as { data?: string[] };
  return (payload.data ?? []).filter(Boolean).sort();
}

export async function searchTraces(
  target: DatasourceTarget,
  params: {
    service?: string;
    operation?: string;
    startIso: string;
    endIso: string;
    minDuration?: string;
    maxDuration?: string;
    tags?: string;
    limit?: number;
  },
): Promise<TraceDetail[]> {
  const basePath = toProxyBasePath(target);
  if (target.pluginKind === 'TempoDatasource') {
    const qs = new URLSearchParams({
      start: String(Math.floor(new Date(params.startIso).getTime() / 1000)),
      end: String(Math.floor(new Date(params.endIso).getTime() / 1000)),
      limit: String(params.limit ?? 20),
    });
    if (params.minDuration?.trim()) qs.set('minDuration', params.minDuration.trim());
    if (params.maxDuration?.trim()) qs.set('maxDuration', params.maxDuration.trim());
    if (params.service) qs.set('tags', `service.name="${params.service}"`);
    const res = await persesFetchFn(`${basePath}/api/search?${qs.toString()}`, { credentials: 'include' });
    if (res.status === 401) throw new UnauthorizedError('Session expired while searching Tempo traces');
    if (!res.ok) throw new Error(`Tempo search HTTP ${res.status}: ${await res.text()}`);
    const payload = (await res.json()) as {
      traces?: Array<{
        traceID?: string;
        rootServiceName?: string;
        rootTraceName?: string;
        startTimeUnixNano?: string;
        durationMs?: number;
      }>;
    };
    return (payload.traces ?? []).map((t) => ({
      traceId: String(t.traceID ?? ''),
      rootService: String(t.rootServiceName ?? 'unknown'),
      rootOperation: String(t.rootTraceName ?? 'unknown'),
      startTimeUs: Math.floor(Number(t.startTimeUnixNano ?? 0) / 1000),
      durationUs: Math.max(0, Number(t.durationMs ?? 0) * 1000),
      spanCount: 1,
      errorCount: 0,
      services: [String(t.rootServiceName ?? 'unknown')],
      spans: [],
    }));
  }

  const qs = buildJaegerSearchParams(params);
  const res = await persesFetchFn(`${basePath}/api/traces?${qs.toString()}`, { credentials: 'include' });
  if (res.status === 401) throw new UnauthorizedError('Session expired while searching Jaeger traces');
  if (res.status === 404) {
    const v3Qs = buildJaegerV3SearchParams(params);
    const v3Res = await persesFetchFn(`${basePath}/api/v3/traces?${v3Qs.toString()}`, { credentials: 'include' });
    if (v3Res.status === 401) throw new UnauthorizedError('Session expired while searching Jaeger traces');
    if (v3Res.status === 404) {
      const body = await v3Res.text();
      if (body.toLowerCase().includes('no traces found')) return [];
      throw new Error(`Jaeger v3 search HTTP 404: ${body}`);
    }
    if (!v3Res.ok) throw new Error(`Jaeger v3 search HTTP ${v3Res.status}: ${await v3Res.text()}`);
    return parseJaegerV3TracesResponse(await v3Res.text()).sort((a, b) => b.startTimeUs - a.startTimeUs);
  }
  if (!res.ok) throw new Error(`Jaeger search HTTP ${res.status}: ${await res.text()}`);
  const payload = (await res.json()) as { data?: RawJaegerTrace[] };
  return (payload.data ?? []).map(normalizeJaegerTrace).sort((a, b) => b.startTimeUs - a.startTimeUs);
}

export async function fetchTraceById(target: DatasourceTarget, traceId: string): Promise<TraceDetail> {
  const basePath = toProxyBasePath(target);
  const res = await persesFetchFn(`${basePath}/api/traces/${encodeURIComponent(traceId)}`, {
    credentials: 'include',
  });
  if (res.status === 401) throw new UnauthorizedError('Session expired while loading trace detail');
  if (res.status === 404) {
    const v3Res = await persesFetchFn(`${basePath}/api/v3/traces/${encodeURIComponent(traceId)}`, {
      credentials: 'include',
    });
    if (v3Res.status === 401) throw new UnauthorizedError('Session expired while loading trace detail');
    if (!v3Res.ok) throw new Error(`Jaeger v3 trace fetch HTTP ${v3Res.status}: ${await v3Res.text()}`);
    const traces = parseJaegerV3TracesResponse(await v3Res.text());
    const firstV3 = traces[0];
    if (!firstV3) {
      throw new Error(`Trace "${traceId}" not found.`);
    }
    return firstV3;
  }
  if (!res.ok) throw new Error(`Trace fetch HTTP ${res.status}: ${await res.text()}`);
  const payload = (await res.json()) as { data?: RawJaegerTrace[] };
  const first = payload.data?.[0];
  if (!first) {
    throw new Error(`Trace "${traceId}" not found.`);
  }
  return normalizeJaegerTrace(first);
}
