import type { DatasourceTarget } from './datasources';
import { UnauthorizedError, persesFetchFn, toProxyBasePath } from './http';

export interface PrometheusVectorSample {
  metric: Record<string, string>;
  value: [number, string];
}

interface PrometheusQueryResponse {
  status: 'success' | 'error';
  error?: string;
  data?: {
    resultType?: string;
    result?: PrometheusVectorSample[];
  };
}

export async function queryPrometheusInstant(
  expr: string,
  target: DatasourceTarget | string,
): Promise<PrometheusVectorSample[]> {
  const params = new URLSearchParams({ query: expr });
  const basePath = toProxyBasePath(target);
  const url = `${basePath}/api/v1/query?${params.toString()}`;
  const res = await persesFetchFn(url, {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  if (res.status === 401) {
    throw new UnauthorizedError('Session expired while querying metrics datasource');
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Metrics datasource HTTP ${res.status}: ${body || res.statusText}`);
  }
  const payload = (await res.json()) as PrometheusQueryResponse;
  if (payload.status !== 'success') {
    throw new Error(payload.error || 'Metrics query failed');
  }
  return payload.data?.result ?? [];
}

export interface LiveHostGpuInfo {
  model: string;
  utilizationPct: number | null;
  temperatureC: number | null;
}

export interface LiveHostRecord {
  hostname: string;
  ip: string;
  os: string;
  arch: string;
  cores: number;
  online: boolean;
  kubeletVersion: string;
  kernelVersion: string;
  osImage: string;
  memoryPct: number | null;
  memoryTotalBytes: number | null;
  cpuPct: number | null;
  uptimeSeconds: number | null;
  roles: string[];
  gpus: LiveHostGpuInfo[];
  tags: string[];
  groups: string[];
}

export function parseNumericSample(sample: PrometheusVectorSample | undefined): number | null {
  if (!sample) return null;
  const val = Number(sample.value?.[1]);
  return Number.isFinite(val) ? val : null;
}

export function resolveSampleNode(metric: Record<string, string>): string {
  return metric.node || metric.nodename || metric.Hostname || metric.instance?.split(':')[0] || '';
}

function settledValue(result: PromiseSettledResult<PrometheusVectorSample[]>): PrometheusVectorSample[] {
  return result.status === 'fulfilled' ? result.value : [];
}

export async function fetchLiveClusterHosts(target: DatasourceTarget | string): Promise<LiveHostRecord[]> {
  const results = await Promise.allSettled([
    queryPrometheusInstant('kube_node_info', target),
    queryPrometheusInstant('kube_node_role', target),
    queryPrometheusInstant('node_uname_info', target),
    queryPrometheusInstant('count by (node, nodename, instance) (node_cpu_seconds_total{mode="idle"})', target),
    queryPrometheusInstant(
      '100 - (avg by (node, nodename, instance) (rate(node_cpu_seconds_total{mode="idle"}[2m])) * 100)',
      target,
    ),
    queryPrometheusInstant('100 * (1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes))', target),
    queryPrometheusInstant('node_memory_MemTotal_bytes', target),
    queryPrometheusInstant('time() - node_boot_time_seconds', target),
    queryPrometheusInstant('up', target),
    queryPrometheusInstant('DCGM_FI_DEV_GPU_UTIL', target),
    queryPrometheusInstant('DCGM_FI_DEV_GPU_TEMP', target),
  ]);

  // If an auth error occurred on any query, propagate immediately
  for (const r of results) {
    if (r.status === 'rejected' && r.reason instanceof UnauthorizedError) {
      throw r.reason;
    }
  }

  // If every single query failed, surface the first error
  if (results.every((r) => r.status === 'rejected')) {
    const firstErr = (results[0] as PromiseRejectedResult).reason;
    throw firstErr instanceof Error ? firstErr : new Error(String(firstErr));
  }

  const [
    kubeNodeInfo,
    kubeNodeRoles,
    unameInfo,
    cpuCores,
    cpuUsage,
    memUsage,
    memTotal,
    uptimeSamples,
    allUpSamples,
    gpuUtil,
    gpuTemp,
  ] = results.map(settledValue);

  const map = new Map<string, LiveHostRecord>();

  const ensureHost = (name: string): LiveHostRecord => {
    const existing = map.get(name);
    if (existing) return existing;
    const created: LiveHostRecord = {
      hostname: name,
      ip: '-',
      os: 'linux',
      arch: '-',
      cores: 0,
      online: false,
      kubeletVersion: '-',
      kernelVersion: '-',
      osImage: '-',
      memoryPct: null,
      memoryTotalBytes: null,
      cpuPct: null,
      uptimeSeconds: null,
      roles: [],
      gpus: [],
      tags: [],
      groups: ['Kubernetes Cluster - Core Infrastructure'],
    };
    map.set(name, created);
    return created;
  };

  for (const s of kubeNodeInfo) {
    const name = s.metric.node;
    if (!name) continue;
    const host = ensureHost(name);
    host.ip = s.metric.internal_ip || host.ip;
    host.kubeletVersion = s.metric.kubelet_version || host.kubeletVersion;
    host.kernelVersion = s.metric.kernel_version || host.kernelVersion;
    host.osImage = s.metric.os_image || host.osImage;
    host.online = true;
  }

  for (const s of kubeNodeRoles) {
    const name = s.metric.node;
    const role = s.metric.role;
    if (!name || !role) continue;
    const host = ensureHost(name);
    if (!host.roles.includes(role)) {
      host.roles.push(role);
    }
  }

  for (const s of unameInfo) {
    const name = resolveSampleNode(s.metric);
    if (!name) continue;
    const host = ensureHost(name);
    host.os = (s.metric.sysname || 'linux').toLowerCase();
    host.arch = s.metric.machine || host.arch;
    host.online = true;
    if (host.kernelVersion === '-' && s.metric.release) {
      host.kernelVersion = s.metric.release;
    }
  }

  for (const s of cpuCores) {
    const name = resolveSampleNode(s.metric);
    const val = parseNumericSample(s);
    if (!name || val === null) continue;
    ensureHost(name).cores = Math.round(val);
  }

  for (const s of cpuUsage) {
    const name = resolveSampleNode(s.metric);
    const val = parseNumericSample(s);
    if (!name || val === null) continue;
    ensureHost(name).cpuPct = Math.max(0, Math.min(100, val));
  }

  for (const s of memUsage) {
    const name = resolveSampleNode(s.metric);
    const val = parseNumericSample(s);
    if (!name || val === null) continue;
    ensureHost(name).memoryPct = Math.max(0, Math.min(100, val));
  }

  for (const s of memTotal) {
    const name = resolveSampleNode(s.metric);
    const val = parseNumericSample(s);
    if (!name || val === null) continue;
    ensureHost(name).memoryTotalBytes = val;
  }

  for (const s of uptimeSamples) {
    const name = resolveSampleNode(s.metric);
    const val = parseNumericSample(s);
    if (!name || val === null) continue;
    ensureHost(name).uptimeSeconds = val;
  }

  // Auto-discover node exporter / node health from `up` without hardcoding job="node-exporter"
  for (const s of allUpSamples) {
    const job = (s.metric.job || '').toLowerCase();
    const isNodeJob = job.includes('node') || job.includes('host') || job.includes('unix');
    if (!isNodeJob) continue;
    const name = resolveSampleNode(s.metric);
    const val = parseNumericSample(s);
    if (!name || val === null) continue;
    ensureHost(name).online = val === 1;
  }

  const tempByKey = new Map<string, number>();
  for (const s of gpuTemp) {
    const name = resolveSampleNode(s.metric);
    const val = parseNumericSample(s);
    if (!name || val === null) continue;
    const key = `${name}::${s.metric.gpu || s.metric.UUID || '0'}`;
    tempByKey.set(key, val);
  }

  for (const s of gpuUtil) {
    const name = resolveSampleNode(s.metric);
    if (!name) continue;
    const host = ensureHost(name);
    const key = `${name}::${s.metric.gpu || s.metric.UUID || '0'}`;
    host.gpus.push({
      model: s.metric.modelName || 'NVIDIA GPU',
      utilizationPct: parseNumericSample(s),
      temperatureC: tempByKey.get(key) ?? null,
    });
  }

  for (const host of map.values()) {
    const tags: string[] = [];
    if (host.roles.length > 0) {
      tags.push(`role=${host.roles.join(',')}`);
    }
    if (host.osImage !== '-') {
      tags.push(`os=${host.osImage}`);
    }
    if (host.gpus.length > 0) {
      const models = Array.from(new Set(host.gpus.map((g) => g.model))).join(',');
      tags.push(`gpu=${host.gpus.length}x ${models}`);
      host.groups.push('Kubernetes Cluster - GPU Compute');
    }
    if (host.roles.some((r) => r.includes('control-plane') || r.includes('master'))) {
      host.groups.push('Kubernetes Cluster - Control Plane');
    } else {
      host.groups.push('Kubernetes Cluster - Worker Nodes');
    }
    host.tags = tags;
  }

  return Array.from(map.values()).sort((a, b) => a.hostname.localeCompare(b.hostname));
}
