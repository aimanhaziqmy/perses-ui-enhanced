import type {
  DashboardResource,
  DatasourceApi,
  DatasourceResource,
  DatasourceSelector,
  GlobalDatasourceResource,
  ProjectResource,
} from '@perses-dev/client';
import { buildProxyUrl, fetch as persesFetch, fetchJson } from '@perses-dev/client';
import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

export interface PersesHealthResponse {
  buildTime?: string;
  version?: string;
  commit?: string;
  database?: boolean;
}

export interface PersesAuthProviderSummary {
  slug_id: string;
  name: string;
  auth_url?: string;
  issuer?: string;
}

export interface PersesFrontendConfig {
  security?: {
    enable_auth?: boolean;
    readonly?: boolean;
    authentication?: {
      disable_sign_up?: boolean;
      providers?: {
        enable_native?: boolean;
        oauth?: PersesAuthProviderSummary[];
        oidc?: PersesAuthProviderSummary[];
      };
    };
  };
  frontend?: {
    explorer?: { enable?: boolean };
    information?: string;
  };
}

export interface PersesUserResource {
  kind: 'User';
  metadata: {
    name: string;
    createdAt?: string;
    updatedAt?: string;
    version?: number;
  };
  spec?: {
    firstName?: string;
    lastName?: string;
    nativeProvider?: Record<string, unknown>;
    oauthProviders?: Array<{
      issuer?: string;
      email?: string;
      subject?: string;
    }>;
  };
}

export interface PersesPermission {
  actions: string[];
  scopes: string[];
}

export interface PersesGlobalRoleResource {
  kind: 'GlobalRole';
  metadata: {
    name: string;
    createdAt?: string;
    updatedAt?: string;
  };
  spec: {
    permissions: PersesPermission[];
  };
}

export interface PersesGlobalRoleBindingResource {
  kind: 'GlobalRoleBinding';
  metadata: {
    name: string;
    createdAt?: string;
    updatedAt?: string;
  };
  spec: {
    role: string;
    subjects: Array<{
      kind: string;
      name: string;
    }>;
  };
}

export interface PersesPluginModuleResource {
  kind?: string;
  metadata?: {
    name?: string;
    version?: string;
  };
  spec?: {
    plugins?: Array<{
      kind?: string;
      spec?: {
        name?: string;
        display?: {
          name?: string;
          description?: string;
        };
      };
    }>;
  };
}

export class UnauthorizedError extends Error {
  readonly status = 401;
  constructor(message = 'Authentication required') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

async function apiGetJson<T>(url: string): Promise<T> {
  const res = await persesFetch(url, {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  if (res.status === 401) {
    throw new UnauthorizedError('Perses session expired or unauthenticated');
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status} from ${url}: ${body || res.statusText}`);
  }
  return (await res.json()) as T;
}

export function fetchPersesHealth(): Promise<PersesHealthResponse> {
  return apiGetJson<PersesHealthResponse>('/api/v1/health');
}

export function fetchPersesConfig(): Promise<PersesFrontendConfig> {
  return apiGetJson<PersesFrontendConfig>('/api/v1/config');
}

export async function loginNative(login: string, password: string): Promise<void> {
  await fetchJson<void>('/api/auth/providers/native/login', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ login, password }),
  });
}

export async function refreshAuthSession(): Promise<boolean> {
  const res = await globalThis.fetch('/api/auth/refresh', {
    method: 'POST',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  return res.ok;
}

export async function logoutPerses(): Promise<void> {
  await globalThis.fetch('/api/auth/logout', {
    method: 'GET',
    credentials: 'include',
  });
}

export function fetchProjects(): Promise<ProjectResource[]> {
  return apiGetJson<ProjectResource[]>('/api/v1/projects');
}

export function fetchDashboards(project: string): Promise<DashboardResource[]> {
  return apiGetJson<DashboardResource[]>(`/api/v1/projects/${encodeURIComponent(project)}/dashboards`);
}

export function fetchDashboard(project: string, name: string): Promise<DashboardResource> {
  return apiGetJson<DashboardResource>(
    `/api/v1/projects/${encodeURIComponent(project)}/dashboards/${encodeURIComponent(name)}`,
  );
}

export function fetchGlobalDatasources(): Promise<GlobalDatasourceResource[]> {
  return apiGetJson<GlobalDatasourceResource[]>('/api/v1/globaldatasources');
}

export function fetchProjectDatasources(project: string): Promise<DatasourceResource[]> {
  return apiGetJson<DatasourceResource[]>(`/api/v1/projects/${encodeURIComponent(project)}/datasources`);
}

export function fetchPersesUsers(): Promise<PersesUserResource[]> {
  return apiGetJson<PersesUserResource[]>('/api/v1/users');
}

export function fetchPersesGlobalRoles(): Promise<PersesGlobalRoleResource[]> {
  return apiGetJson<PersesGlobalRoleResource[]>('/api/v1/globalroles');
}

export function fetchPersesGlobalRoleBindings(): Promise<PersesGlobalRoleBindingResource[]> {
  return apiGetJson<PersesGlobalRoleBindingResource[]>('/api/v1/globalrolebindings');
}

export function fetchPersesPlugins(): Promise<PersesPluginModuleResource[]> {
  return apiGetJson<PersesPluginModuleResource[]>('/api/v1/plugins');
}

export interface DatasourceProbeResult {
  name: string;
  kind: string;
  ok: boolean;
  statusCode: number;
  latencyMs: number;
  detail: string;
}

export async function probeGlobalDatasource(ds: GlobalDatasourceResource): Promise<DatasourceProbeResult> {
  const name = ds.metadata.name;
  const kind = ds.spec.plugin.kind;
  const started = performance.now();

  if (kind === 'PrometheusDatasource') {
    const url = `/proxy/globaldatasources/${encodeURIComponent(name)}/api/v1/status/buildinfo`;
    const res = await globalThis.fetch(url, { credentials: 'include' });
    const latencyMs = Math.round(performance.now() - started);
    const text = await res.text();
    if (!res.ok) {
      return { name, kind, ok: false, statusCode: res.status, latencyMs, detail: text || res.statusText };
    }
    return { name, kind, ok: true, statusCode: res.status, latencyMs, detail: text };
  }

  if (kind === 'VictoriaLogsDatasource') {
    const url = `/proxy/globaldatasources/${encodeURIComponent(name)}/select/logsql/query?query=*&limit=1`;
    const res = await globalThis.fetch(url, { credentials: 'include' });
    const latencyMs = Math.round(performance.now() - started);
    const text = await res.text();
    if (!res.ok) {
      return { name, kind, ok: false, statusCode: res.status, latencyMs, detail: text || res.statusText };
    }
    return {
      name,
      kind,
      ok: true,
      statusCode: res.status,
      latencyMs,
      detail: text.trim() || 'Connected (0 matching records in latest slice)',
    };
  }

  const latencyMs = Math.round(performance.now() - started);
  return {
    name,
    kind,
    ok: false,
    statusCode: 0,
    latencyMs,
    detail: `Unsupported probe plugin kind: ${kind}`,
  };
}

// -----------------------------------------------------------------------------
// Prometheus / VictoriaMetrics Instant & Cluster Host Telemetry Queries
// -----------------------------------------------------------------------------

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
  datasourceName = 'VictoriaMetrics',
): Promise<PrometheusVectorSample[]> {
  const params = new URLSearchParams({ query: expr });
  const url = `/proxy/globaldatasources/${encodeURIComponent(datasourceName)}/api/v1/query?${params.toString()}`;
  const res = await globalThis.fetch(url, {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  if (res.status === 401) {
    throw new UnauthorizedError('Session expired while querying VictoriaMetrics');
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`VictoriaMetrics HTTP ${res.status}: ${body || res.statusText}`);
  }
  const payload = (await res.json()) as PrometheusQueryResponse;
  if (payload.status !== 'success') {
    throw new Error(payload.error || 'VictoriaMetrics query failed');
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

function parseNumericSample(sample: PrometheusVectorSample | undefined): number | null {
  if (!sample) return null;
  const val = Number(sample.value?.[1]);
  return Number.isFinite(val) ? val : null;
}

function resolveSampleNode(metric: Record<string, string>): string {
  return metric.node || metric.nodename || metric.Hostname || metric.instance?.split(':')[0] || '';
}

export async function fetchLiveClusterHosts(datasourceName = 'VictoriaMetrics'): Promise<LiveHostRecord[]> {
  const [
    kubeNodeInfo,
    kubeNodeRoles,
    unameInfo,
    cpuCores,
    cpuUsage,
    memUsage,
    memTotal,
    uptimeSamples,
    nodeUp,
    gpuUtil,
    gpuTemp,
  ] = await Promise.all([
    queryPrometheusInstant('kube_node_info', datasourceName),
    queryPrometheusInstant('kube_node_role', datasourceName),
    queryPrometheusInstant('node_uname_info', datasourceName),
    queryPrometheusInstant('count by (node, instance) (node_cpu_seconds_total{mode="idle"})', datasourceName),
    queryPrometheusInstant(
      '100 - (avg by (node, instance) (rate(node_cpu_seconds_total{mode="idle"}[2m])) * 100)',
      datasourceName,
    ),
    queryPrometheusInstant('100 * (1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes))', datasourceName),
    queryPrometheusInstant('node_memory_MemTotal_bytes', datasourceName),
    queryPrometheusInstant('time() - node_boot_time_seconds', datasourceName),
    queryPrometheusInstant('up{job="node-exporter"}', datasourceName),
    queryPrometheusInstant('DCGM_FI_DEV_GPU_UTIL', datasourceName),
    queryPrometheusInstant('DCGM_FI_DEV_GPU_TEMP', datasourceName),
  ]);

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

  for (const s of nodeUp) {
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

// -----------------------------------------------------------------------------
// VictoriaLogs Query & Hits Histogram Helpers
// -----------------------------------------------------------------------------

export interface VictoriaLogEntry {
  _time: string;
  _msg: string;
  _stream: string;
  [field: string]: string;
}

export interface VictoriaLogsQueryResult {
  entries: VictoriaLogEntry[];
  durationMs: number;
}

export interface VictoriaLogHitBucket {
  timestamp: string;
  endTimestamp: string;
  label: string;
  count: number;
}

export async function queryVictoriaLogs(
  query: string,
  limit = 100,
  startIso?: string,
  endIso?: string,
  datasourceName = 'VictoriaLogs',
): Promise<VictoriaLogsQueryResult> {
  const params = new URLSearchParams({
    query: query.trim() || '*',
    limit: String(limit),
  });
  if (startIso) params.set('start', startIso);
  if (endIso) params.set('end', endIso);

  const started = performance.now();
  const url = `/proxy/globaldatasources/${encodeURIComponent(datasourceName)}/select/logsql/query?${params.toString()}`;
  const res = await globalThis.fetch(url, {
    method: 'GET',
    credentials: 'include',
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
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parsed = JSON.parse(trimmed) as VictoriaLogEntry;
    entries.push(parsed);
  }
  return { entries, durationMs };
}

export async function queryVictoriaLogsHits(
  query: string,
  startIso: string,
  endIso: string,
  stepSeconds: number,
  datasourceName = 'VictoriaLogs',
): Promise<VictoriaLogHitBucket[]> {
  const params = new URLSearchParams({
    query: query.trim() || '*',
    start: startIso,
    end: endIso,
    step: `${stepSeconds}s`,
  });
  const url = `/proxy/globaldatasources/${encodeURIComponent(datasourceName)}/select/logsql/hits?${params.toString()}`;
  const res = await globalThis.fetch(url, {
    method: 'GET',
    credentials: 'include',
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
    };
  });
}

// -----------------------------------------------------------------------------
// Live Cluster Health Checks (Alerts & Kubernetes Events)
// -----------------------------------------------------------------------------

export interface LiveAlertRuleEvaluation {
  id: string;
  name: string;
  group: string;
  datasource: 'VictoriaMetrics' | 'VictoriaLogs';
  query: string;
  severity: 'critical' | 'warning' | 'info';
  status: 'normal' | 'firing' | 'error';
  measuredValue: string;
  thresholdLabel: string;
  evaluatedAt: string;
  detail: string;
}

export async function evaluateLiveAlertRules(): Promise<LiveAlertRuleEvaluation[]> {
  const nowStr = new Date().toISOString();

  const promChecks: Array<{
    id: string;
    name: string;
    group: string;
    query: string;
    severity: 'critical' | 'warning' | 'info';
    thresholdLabel: string;
    isFiring: (samples: PrometheusVectorSample[]) => { firing: boolean; measured: string; detail: string };
  }> = [
    {
      id: 'node-reachability',
      name: 'Node Exporter Targets Unreachable (up == 0)',
      group: 'Core Infrastructure',
      query: 'up{job="node-exporter"} == 0',
      severity: 'critical',
      thresholdLabel: 'count == 0',
      isFiring: (samples) => ({
        firing: samples.length > 0,
        measured: samples.length === 0 ? '0 unreachable' : `${samples.length} unreachable`,
        detail:
          samples.length === 0
            ? 'All monitored cluster nodes are reporting metrics.'
            : samples.map((s) => resolveSampleNode(s.metric)).join(', '),
      }),
    },
    {
      id: 'node-memory-pressure',
      name: 'Node Memory Usage > 85%',
      group: 'Core Infrastructure',
      query: '100 * (1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes))',
      severity: 'warning',
      thresholdLabel: '< 85%',
      isFiring: (samples) => {
        let peak = 0;
        const hot: string[] = [];
        for (const s of samples) {
          const val = parseNumericSample(s) ?? 0;
          if (val > peak) peak = val;
          if (val > 85) hot.push(`${resolveSampleNode(s.metric)} (${val.toFixed(1)}%)`);
        }
        return {
          firing: hot.length > 0,
          measured: samples.length > 0 ? `Peak ${peak.toFixed(1)}%` : 'No data',
          detail: hot.length > 0 ? `High memory on: ${hot.join(', ')}` : 'All nodes below 85% memory utilization.',
        };
      },
    },
    {
      id: 'node-cpu-saturation',
      name: 'Node CPU Utilization > 85%',
      group: 'Core Infrastructure',
      query: '100 - (avg by (node) (rate(node_cpu_seconds_total{mode="idle"}[2m])) * 100)',
      severity: 'warning',
      thresholdLabel: '< 85%',
      isFiring: (samples) => {
        let peak = 0;
        const hot: string[] = [];
        for (const s of samples) {
          const val = parseNumericSample(s) ?? 0;
          if (val > peak) peak = val;
          if (val > 85) hot.push(`${resolveSampleNode(s.metric)} (${val.toFixed(1)}%)`);
        }
        return {
          firing: hot.length > 0,
          measured: samples.length > 0 ? `Peak ${peak.toFixed(1)}%` : 'No data',
          detail: hot.length > 0 ? `High CPU on: ${hot.join(', ')}` : 'All nodes below 85% CPU saturation.',
        };
      },
    },
    {
      id: 'nvidia-gpu-temp',
      name: 'NVIDIA GPU Thermal Threshold (> 85°C)',
      group: 'GPU & AI Compute',
      query: 'max(DCGM_FI_DEV_GPU_TEMP)',
      severity: 'critical',
      thresholdLabel: '< 85°C',
      isFiring: (samples) => {
        const peak = parseNumericSample(samples[0]);
        return {
          firing: peak !== null && peak > 85,
          measured: peak !== null ? `${peak.toFixed(1)} °C` : 'No GPUs sampled',
          detail: peak !== null ? `Highest sampled GPU temperature is ${peak.toFixed(1)}°C.` : 'Waiting for DCGM samples.',
        };
      },
    },
    {
      id: 'pod-crashloop',
      name: 'Pods in CrashLoopBackOff or ImagePullBackOff',
      group: 'Workloads',
      query: 'sum(kube_pod_container_status_waiting_reason{reason=~"CrashLoopBackOff|ImagePullBackOff|ErrImagePull"}) or vector(0)',
      severity: 'critical',
      thresholdLabel: '== 0 pods',
      isFiring: (samples) => {
        const count = parseNumericSample(samples[0]) ?? 0;
        return {
          firing: count > 0,
          measured: `${Math.round(count)} waiting pods`,
          detail: count > 0 ? `${Math.round(count)} container(s) stuck in backoff.` : 'Zero pods in CrashLoopBackOff.',
        };
      },
    },
    {
      id: 'pvc-storage-saturation',
      name: 'PersistentVolume Usage > 85%',
      group: 'Storage',
      query: '100 * (kubelet_volume_stats_used_bytes / kubelet_volume_stats_capacity_bytes)',
      severity: 'warning',
      thresholdLabel: '< 85%',
      isFiring: (samples) => {
        let peak = 0;
        const full: string[] = [];
        for (const s of samples) {
          const val = parseNumericSample(s) ?? 0;
          if (val > peak) peak = val;
          if (val > 85) full.push(`${s.metric.namespace}/${s.metric.persistentvolumeclaim} (${val.toFixed(1)}%)`);
        }
        return {
          firing: full.length > 0,
          measured: samples.length > 0 ? `Peak ${peak.toFixed(1)}%` : 'No PV metrics',
          detail: full.length > 0 ? `Near-full PVCs: ${full.join(', ')}` : 'All persistent volumes have healthy headroom.',
        };
      },
    },
    {
      id: 'vlogs-ingestion',
      name: 'VictoriaLogs Ingestion Stalled (< 0.01 rows/s)',
      group: 'Observability',
      query: 'sum(rate(vl_rows_ingested_total[5m]))',
      severity: 'warning',
      thresholdLabel: '> 0 rows/s',
      isFiring: (samples) => {
        const rate = parseNumericSample(samples[0]);
        return {
          firing: rate === null || rate <= 0,
          measured: rate !== null ? `${rate.toFixed(1)} rows/s` : 'No rate',
          detail: rate !== null && rate > 0 ? 'VictoriaLogs actively ingesting logs.' : 'No recent ingested log rows observed.',
        };
      },
    },
  ];

  const promResults = await Promise.all(
    promChecks.map(async (rule): Promise<LiveAlertRuleEvaluation> => {
      try {
        const samples = await queryPrometheusInstant(rule.query);
        const res = rule.isFiring(samples);
        return {
          id: rule.id,
          name: rule.name,
          group: rule.group,
          datasource: 'VictoriaMetrics',
          query: rule.query,
          severity: rule.severity,
          status: res.firing ? 'firing' : 'normal',
          measuredValue: res.measured,
          thresholdLabel: rule.thresholdLabel,
          evaluatedAt: nowStr,
          detail: res.detail,
        };
      } catch (err) {
        return {
          id: rule.id,
          name: rule.name,
          group: rule.group,
          datasource: 'VictoriaMetrics',
          query: rule.query,
          severity: rule.severity,
          status: 'error',
          measuredValue: 'Query Error',
          thresholdLabel: rule.thresholdLabel,
          evaluatedAt: nowStr,
          detail: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );

  let k8sEventsEval: LiveAlertRuleEvaluation;
  try {
    const startIso = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const endIso = new Date().toISOString();
    const { entries } = await queryVictoriaLogs('stream:="k8s_events" AND "Warning"', 50, startIso, endIso);
    k8sEventsEval = {
      id: 'k8s-warning-events',
      name: 'Kubernetes Warning Events in Last 15m',
      group: 'Workloads',
      datasource: 'VictoriaLogs',
      query: 'stream:="k8s_events" AND "Warning"',
      severity: 'warning',
      status: entries.length > 0 ? 'firing' : 'normal',
      measuredValue: `${entries.length} warning event(s)`,
      thresholdLabel: '== 0 in 15m',
      evaluatedAt: nowStr,
      detail:
        entries.length > 0
          ? `Latest: ${entries[0]._msg || entries[0].reason || 'Warning event logged'}`
          : 'No Kubernetes Warning events in the last 15 minutes.',
    };
  } catch (err) {
    k8sEventsEval = {
      id: 'k8s-warning-events',
      name: 'Kubernetes Warning Events in Last 15m',
      group: 'Workloads',
      datasource: 'VictoriaLogs',
      query: 'stream:="k8s_events" AND "Warning"',
      severity: 'warning',
      status: 'error',
      measuredValue: 'Query Error',
      thresholdLabel: '== 0 in 15m',
      evaluatedAt: nowStr,
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  return [...promResults, k8sEventsEval];
}

// -----------------------------------------------------------------------------
// Perses Embedded Plugin DatasourceApi Hook
// -----------------------------------------------------------------------------

export function usePersesDatasourceApi(projectName?: string): DatasourceApi {
  const { data: globalDatasources } = useQuery<GlobalDatasourceResource[]>({
    queryKey: ['perses', 'globaldatasources'],
    queryFn: fetchGlobalDatasources,
  });

  const { data: projectDatasources } = useQuery<DatasourceResource[]>({
    queryKey: ['perses', 'datasources', projectName],
    queryFn: () => fetchProjectDatasources(projectName!),
    enabled: Boolean(projectName),
  });

  const getDatasource = useCallback(
    async (project: string, selector: DatasourceSelector) => {
      const list = project === projectName ? projectDatasources : await fetchProjectDatasources(project);
      return (list ?? []).find((ds) => {
        if (ds.metadata.project !== project) return false;
        if (ds.spec.plugin.kind !== selector.kind) return false;
        if (!selector.name) return Boolean(ds.spec.default);
        return ds.metadata.name.toLowerCase() === selector.name.toLowerCase();
      });
    },
    [projectDatasources, projectName],
  );

  const getGlobalDatasource = useCallback(
    async (selector: DatasourceSelector) => {
      const list = globalDatasources ?? (await fetchGlobalDatasources());
      return list.find((ds) => {
        if (ds.spec.plugin.kind !== selector.kind) return false;
        if (!selector.name) return Boolean(ds.spec.default);
        return ds.metadata.name.toLowerCase() === selector.name.toLowerCase();
      });
    },
    [globalDatasources],
  );

  const listDatasources = useCallback(
    async (project: string, pluginKind?: string) => {
      const list = project === projectName ? projectDatasources : await fetchProjectDatasources(project);
      return (list ?? []).filter((ds) => {
        if (ds.metadata.project !== project) return false;
        if (pluginKind && ds.spec.plugin.kind !== pluginKind) return false;
        return true;
      });
    },
    [projectDatasources, projectName],
  );

  const listGlobalDatasources = useCallback(
    async (pluginKind?: string) => {
      const list = globalDatasources ?? (await fetchGlobalDatasources());
      return list.filter((ds) => (!pluginKind ? true : ds.spec.plugin.kind === pluginKind));
    },
    [globalDatasources],
  );

  return useMemo(
    () => ({
      getDatasource,
      getGlobalDatasource,
      listDatasources,
      listGlobalDatasources,
      buildProxyUrl,
    }),
    [getDatasource, getGlobalDatasource, listDatasources, listGlobalDatasources],
  );
}

// -----------------------------------------------------------------------------
// Dynamic Site Branding Store (Perses GlobalVariable + localStorage)
// -----------------------------------------------------------------------------

export interface SiteBrandingConfig {
  appName: string;
  appSubtitle: string;
  orgName: string;
  logoUrl: string;
  logoText: string;
}

export const DEFAULT_SITE_BRANDING: SiteBrandingConfig = {
  appName: 'Perses',
  appSubtitle: 'Observability · Metrics, Traces & Logs',
  orgName: 'Observability',
  logoUrl: '',
  logoText: 'P',
};

const SITE_BRANDING_STORAGE_KEY = 'perses-site-branding';
const SITE_BRANDING_VAR_NAME = 'site_branding_config';

function normalizeBranding(raw: Partial<SiteBrandingConfig> | null | undefined): SiteBrandingConfig {
  return {
    appName: (raw?.appName ?? '').trim() || DEFAULT_SITE_BRANDING.appName,
    appSubtitle: (raw?.appSubtitle ?? '').trim() || DEFAULT_SITE_BRANDING.appSubtitle,
    orgName: (raw?.orgName ?? '').trim() || DEFAULT_SITE_BRANDING.orgName,
    logoUrl: (raw?.logoUrl ?? '').trim(),
    logoText: ((raw?.logoText ?? '').trim() || DEFAULT_SITE_BRANDING.logoText).slice(0, 2),
  };
}

export function applySiteBrandingToDocument(cfg: SiteBrandingConfig): void {
  if (typeof document === 'undefined') return;
  document.title = cfg.appSubtitle ? `${cfg.appName} — ${cfg.appSubtitle}` : cfg.appName;
  if (cfg.logoUrl) {
    let iconLink = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!iconLink) {
      iconLink = document.createElement('link');
      iconLink.rel = 'icon';
      document.head.appendChild(iconLink);
    }
    iconLink.href = cfg.logoUrl;
  }
}

export function getLocalSiteBranding(): SiteBrandingConfig {
  try {
    const raw = window.localStorage.getItem(SITE_BRANDING_STORAGE_KEY);
    if (!raw) return DEFAULT_SITE_BRANDING;
    const parsed = JSON.parse(raw) as Partial<SiteBrandingConfig>;
    return normalizeBranding(parsed);
  } catch {
    return DEFAULT_SITE_BRANDING;
  }
}

export function setLocalSiteBranding(cfg: SiteBrandingConfig): SiteBrandingConfig {
  const normalized = normalizeBranding(cfg);
  try {
    window.localStorage.setItem(SITE_BRANDING_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Ignore storage quota errors cleanly
  }
  applySiteBrandingToDocument(normalized);
  return normalized;
}

interface PersesGlobalTextVariableResource {
  kind: 'GlobalVariable';
  metadata: {
    name: string;
  };
  spec: {
    kind: 'TextVariable';
    spec: {
      name: string;
      value: string;
      constant?: boolean;
      display?: {
        name?: string;
        description?: string;
        hidden?: boolean;
      };
    };
  };
}

export async function fetchClusterSiteBranding(): Promise<SiteBrandingConfig> {
  const local = getLocalSiteBranding();
  try {
    const res = await persesFetch(`/api/v1/globalvariables/${encodeURIComponent(SITE_BRANDING_VAR_NAME)}`, {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      return local;
    }
    const payload = (await res.json()) as PersesGlobalTextVariableResource;
    const rawValue = payload?.spec?.spec?.value;
    if (!rawValue) return local;
    const parsed = JSON.parse(rawValue) as Partial<SiteBrandingConfig>;
    return setLocalSiteBranding(normalizeBranding(parsed));
  } catch {
    return local;
  }
}

export async function saveClusterSiteBranding(cfg: SiteBrandingConfig): Promise<SiteBrandingConfig> {
  const normalized = setLocalSiteBranding(cfg);
  const resource: PersesGlobalTextVariableResource = {
    kind: 'GlobalVariable',
    metadata: { name: SITE_BRANDING_VAR_NAME },
    spec: {
      kind: 'TextVariable',
      spec: {
        name: SITE_BRANDING_VAR_NAME,
        value: JSON.stringify(normalized),
        constant: true,
        display: {
          name: 'Site Branding Configuration',
          description: 'Dynamic application name, subtitle, organization label, and logo.',
          hidden: true,
        },
      },
    },
  };

  const putRes = await persesFetch(`/api/v1/globalvariables/${encodeURIComponent(SITE_BRANDING_VAR_NAME)}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(resource),
  });

  if (putRes.status === 404) {
    const postRes = await persesFetch('/api/v1/globalvariables', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(resource),
    });
    if (!postRes.ok) {
      const body = await postRes.text();
      throw new Error(`Failed to save site branding (${postRes.status}): ${body || postRes.statusText}`);
    }
    return normalized;
  }

  if (putRes.status === 401) {
    throw new UnauthorizedError('Session expired while saving site branding');
  }

  if (!putRes.ok) {
    const body = await putRes.text();
    throw new Error(`Failed to update site branding (${putRes.status}): ${body || putRes.statusText}`);
  }

  return normalized;
}
