import { resolveDatasourceTarget, type DatasourceTarget } from './datasources';
import {
  UnauthorizedError,
  fetchGlobalJsonConfig,
  persesFetchFn,
  saveGlobalJsonConfig,
  toProxyBasePath,
} from '@/lib/api/http';
import { queryVictoriaLogs } from './logs';
import { parseNumericSample, queryPrometheusInstant } from './metrics';

export type AlertRuleConditionOp = '>' | '>=' | '<' | '<=' | '==' | '!=' | 'nonempty' | 'empty';

export interface AlertRuleDefinition {
  id: string;
  name: string;
  group: string;
  datasourceType: 'prometheus' | 'victorialogs';
  datasourceName?: string;
  query: string;
  conditionOp: AlertRuleConditionOp;
  threshold: number;
  thresholdLabel: string;
  severity: 'critical' | 'warning' | 'info';
  enabled: boolean;
  lookbackMinutes?: number;
  updatedBy?: string;
  updatedAt?: string;
}

export interface LiveAlertRuleEvaluation {
  rule: AlertRuleDefinition;
  id: string;
  name: string;
  group: string;
  datasourceType: 'prometheus' | 'victorialogs';
  resolvedDatasource: string;
  query: string;
  severity: 'critical' | 'warning' | 'info';
  enabled: boolean;
  status: 'normal' | 'firing' | 'error' | 'disabled';
  measuredValue: string;
  thresholdLabel: string;
  evaluatedAt: string;
  updatedBy: string;
  detail: string;
}

export interface BackendAlertItem {
  labels: Record<string, string>;
  annotations: Record<string, string>;
  state: 'firing' | 'pending' | 'inactive' | string;
  activeAt?: string;
  value?: string;
}

export interface BackendRuleItem {
  name: string;
  query: string;
  duration?: number;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  alerts?: BackendAlertItem[];
  health?: string;
  lastError?: string;
  evaluationTime?: number;
  lastEvaluation?: string;
  type: 'alerting' | 'recording' | string;
  state?: 'firing' | 'pending' | 'inactive' | string;
}

export interface BackendRuleGroup {
  name: string;
  file?: string;
  interval?: number;
  evaluationTime?: number;
  lastEvaluation?: string;
  rules: BackendRuleItem[];
}

export async function fetchBackendAlertRules(
  target: DatasourceTarget | string,
): Promise<BackendRuleGroup[]> {
  const basePath = toProxyBasePath(target);
  const res = await persesFetchFn(`${basePath}/api/v1/rules`, {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  if (res.status === 401) {
    throw new UnauthorizedError('Session expired while fetching backend alert rules');
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Rules API HTTP ${res.status}: ${body || res.statusText}`);
  }
  const payload = (await res.json()) as {
    status?: string;
    error?: string;
    data?: { groups?: BackendRuleGroup[] };
  };
  if (payload.status && payload.status !== 'success') {
    throw new Error(payload.error || 'Failed to load backend rules');
  }
  return payload.data?.groups ?? [];
}

export async function fetchBackendAlerts(
  target: DatasourceTarget | string,
): Promise<BackendAlertItem[]> {
  const basePath = toProxyBasePath(target);
  const res = await persesFetchFn(`${basePath}/api/v1/alerts`, {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  if (res.status === 401) {
    throw new UnauthorizedError('Session expired while fetching backend alerts');
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Alerts API HTTP ${res.status}: ${body || res.statusText}`);
  }
  const payload = (await res.json()) as {
    status?: string;
    error?: string;
    data?: { alerts?: BackendAlertItem[] };
  };
  if (payload.status && payload.status !== 'success') {
    throw new Error(payload.error || 'Failed to load backend alerts');
  }
  return payload.data?.alerts ?? [];
}

export const DEFAULT_ALERT_RULES: AlertRuleDefinition[] = [
  {
    id: 'node-reachability',
    name: 'Node Targets Unreachable (up == 0)',
    group: 'Core Infrastructure',
    datasourceType: 'prometheus',
    query: 'up{job=~".*node.*"} == 0',
    conditionOp: 'nonempty',
    threshold: 0,
    thresholdLabel: 'count == 0',
    severity: 'critical',
    enabled: true,
    updatedBy: 'system',
  },
  {
    id: 'node-memory-pressure',
    name: 'Node Memory Usage > 85%',
    group: 'Core Infrastructure',
    datasourceType: 'prometheus',
    query: '100 * (1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes))',
    conditionOp: '>',
    threshold: 85,
    thresholdLabel: '< 85%',
    severity: 'warning',
    enabled: true,
    updatedBy: 'system',
  },
  {
    id: 'node-cpu-saturation',
    name: 'Node CPU Utilization > 85%',
    group: 'Core Infrastructure',
    datasourceType: 'prometheus',
    query: '100 - (avg by (node, instance) (rate(node_cpu_seconds_total{mode="idle"}[2m])) * 100)',
    conditionOp: '>',
    threshold: 85,
    thresholdLabel: '< 85%',
    severity: 'warning',
    enabled: true,
    updatedBy: 'system',
  },
  {
    id: 'nvidia-gpu-temp',
    name: 'NVIDIA GPU Thermal Threshold (> 85°C)',
    group: 'GPU & AI Compute',
    datasourceType: 'prometheus',
    query: 'max(DCGM_FI_DEV_GPU_TEMP)',
    conditionOp: '>',
    threshold: 85,
    thresholdLabel: '< 85°C',
    severity: 'critical',
    enabled: true,
    updatedBy: 'system',
  },
  {
    id: 'pod-crashloop',
    name: 'Pods in CrashLoopBackOff or ImagePullBackOff',
    group: 'Workloads',
    datasourceType: 'prometheus',
    query: 'sum(kube_pod_container_status_waiting_reason{reason=~"CrashLoopBackOff|ImagePullBackOff|ErrImagePull"}) or vector(0)',
    conditionOp: '>',
    threshold: 0,
    thresholdLabel: '== 0 pods',
    severity: 'critical',
    enabled: true,
    updatedBy: 'system',
  },
  {
    id: 'pvc-storage-saturation',
    name: 'PersistentVolume Usage > 85%',
    group: 'Storage',
    datasourceType: 'prometheus',
    query: '100 * (kubelet_volume_stats_used_bytes / kubelet_volume_stats_capacity_bytes)',
    conditionOp: '>',
    threshold: 85,
    thresholdLabel: '< 85%',
    severity: 'warning',
    enabled: true,
    updatedBy: 'system',
  },
  {
    id: 'vlogs-ingestion',
    name: 'Log Ingestion Rate Stalled (<= 0 rows/s)',
    group: 'Observability',
    datasourceType: 'prometheus',
    query: 'sum(rate(vl_rows_ingested_total[5m]))',
    conditionOp: '<=',
    threshold: 0,
    thresholdLabel: '> 0 rows/s',
    severity: 'warning',
    enabled: true,
    updatedBy: 'system',
  },
  {
    id: 'k8s-warning-events',
    name: 'Kubernetes Warning Events in Last 15m',
    group: 'Workloads',
    datasourceType: 'victorialogs',
    query: 'stream:="k8s_events" AND "Warning"',
    conditionOp: '>',
    threshold: 0,
    thresholdLabel: '== 0 in 15m',
    severity: 'warning',
    enabled: true,
    lookbackMinutes: 15,
    updatedBy: 'system',
  },
];

const ALERT_RULES_VAR_NAME = 'alert_rules_config';
const ALERT_RULES_STORAGE_KEY = 'perses-alert-rules-config';

function normalizeAlertRules(raw: unknown): AlertRuleDefinition[] {
  if (!Array.isArray(raw)) return DEFAULT_ALERT_RULES;
  return raw
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    .map((item, idx) => ({
      id: typeof item.id === 'string' && item.id.trim() ? item.id.trim() : `rule-${idx + 1}`,
      name: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : `Rule ${idx + 1}`,
      group: typeof item.group === 'string' && item.group.trim() ? item.group.trim() : 'General',
      datasourceType: item.datasourceType === 'victorialogs' ? 'victorialogs' : 'prometheus',
      datasourceName:
        typeof item.datasourceName === 'string' && item.datasourceName.trim() ? item.datasourceName.trim() : undefined,
      query: typeof item.query === 'string' ? item.query : '',
      conditionOp: (['>', '>=', '<', '<=', '==', '!=', 'nonempty', 'empty'].includes(String(item.conditionOp))
        ? item.conditionOp
        : '>') as AlertRuleConditionOp,
      threshold: Number.isFinite(Number(item.threshold)) ? Number(item.threshold) : 0,
      thresholdLabel:
        typeof item.thresholdLabel === 'string' && item.thresholdLabel.trim()
          ? item.thresholdLabel.trim()
          : `${String(item.conditionOp ?? '>')} ${Number(item.threshold ?? 0)}`,
      severity: (['critical', 'warning', 'info'].includes(String(item.severity))
        ? item.severity
        : 'warning') as AlertRuleDefinition['severity'],
      enabled: item.enabled !== false,
      lookbackMinutes: Number.isFinite(Number(item.lookbackMinutes)) ? Number(item.lookbackMinutes) : 15,
      updatedBy: typeof item.updatedBy === 'string' && item.updatedBy.trim() ? item.updatedBy.trim() : 'system',
      updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : undefined,
    }));
}

export function fetchAlertRulesConfig(): Promise<AlertRuleDefinition[]> {
  return fetchGlobalJsonConfig(
    ALERT_RULES_VAR_NAME,
    ALERT_RULES_STORAGE_KEY,
    normalizeAlertRules,
    DEFAULT_ALERT_RULES,
  );
}

export function saveAlertRulesConfig(rules: AlertRuleDefinition[]): Promise<AlertRuleDefinition[]> {
  return saveGlobalJsonConfig(
    ALERT_RULES_VAR_NAME,
    ALERT_RULES_STORAGE_KEY,
    rules,
    'Alert Rules Configuration',
    'Dynamic PromQL & LogsQL live alert rule definitions.',
  );
}

function compareThreshold(val: number, op: AlertRuleConditionOp, threshold: number): boolean {
  switch (op) {
    case '>':
      return val > threshold;
    case '>=':
      return val >= threshold;
    case '<':
      return val < threshold;
    case '<=':
      return val <= threshold;
    case '==':
      return val === threshold;
    case '!=':
      return val !== threshold;
    default:
      return false;
  }
}

function describeSampleLabel(metric: Record<string, string>): string {
  return (
    metric.node ||
    metric.nodename ||
    (metric.namespace && metric.persistentvolumeclaim
      ? `${metric.namespace}/${metric.persistentvolumeclaim}`
      : '') ||
    (metric.namespace && metric.pod ? `${metric.namespace}/${metric.pod}` : '') ||
    metric.instance ||
    Object.entries(metric)
      .filter(([k]) => k !== '__name__')
      .map(([k, v]) => `${k}=${v}`)
      .slice(0, 2)
      .join(',') ||
    'series'
  );
}

export async function evaluateLiveAlertRules(
  rules: AlertRuleDefinition[],
  availableTargets: DatasourceTarget[],
): Promise<LiveAlertRuleEvaluation[]> {
  const nowStr = new Date().toISOString();

  return Promise.all(
    rules.map(async (rule): Promise<LiveAlertRuleEvaluation> => {
      const updatedBy = rule.updatedBy || 'system';
      if (!rule.enabled) {
        return {
          rule,
          id: rule.id,
          name: rule.name,
          group: rule.group,
          datasourceType: rule.datasourceType,
          resolvedDatasource: rule.datasourceName || 'Disabled',
          query: rule.query,
          severity: rule.severity,
          enabled: false,
          status: 'disabled',
          measuredValue: 'Disabled',
          thresholdLabel: rule.thresholdLabel,
          evaluatedAt: nowStr,
          updatedBy,
          detail: 'Rule evaluation is disabled.',
        };
      }

      const requiredKind =
        rule.datasourceType === 'victorialogs' ? 'VictoriaLogsDatasource' : 'PrometheusDatasource';
      const target = resolveDatasourceTarget(availableTargets, requiredKind, rule.datasourceName);

      if (!target) {
        return {
          rule,
          id: rule.id,
          name: rule.name,
          group: rule.group,
          datasourceType: rule.datasourceType,
          resolvedDatasource: rule.datasourceName || 'Unconfigured',
          query: rule.query,
          severity: rule.severity,
          enabled: true,
          status: 'error',
          measuredValue: 'No Datasource',
          thresholdLabel: rule.thresholdLabel,
          evaluatedAt: nowStr,
          updatedBy,
          detail: `No ${requiredKind} configured. Add one in Integrations -> Data sources.`,
        };
      }

      try {
        if (rule.datasourceType === 'prometheus') {
          const samples = await queryPrometheusInstant(rule.query, target);
          if (rule.conditionOp === 'nonempty') {
            const firing = samples.length > 0;
            return {
              rule,
              id: rule.id,
              name: rule.name,
              group: rule.group,
              datasourceType: rule.datasourceType,
              resolvedDatasource: target.name,
              query: rule.query,
              severity: rule.severity,
              enabled: true,
              status: firing ? 'firing' : 'normal',
              measuredValue: `${samples.length} matching`,
              thresholdLabel: rule.thresholdLabel,
              evaluatedAt: nowStr,
              updatedBy,
              detail: firing
                ? samples.map((s) => describeSampleLabel(s.metric)).slice(0, 6).join(', ')
                : '0 matching series.',
            };
          }

          if (rule.conditionOp === 'empty') {
            const firing = samples.length === 0;
            return {
              rule,
              id: rule.id,
              name: rule.name,
              group: rule.group,
              datasourceType: rule.datasourceType,
              resolvedDatasource: target.name,
              query: rule.query,
              severity: rule.severity,
              enabled: true,
              status: firing ? 'firing' : 'normal',
              measuredValue: `${samples.length} series`,
              thresholdLabel: rule.thresholdLabel,
              evaluatedAt: nowStr,
              updatedBy,
              detail: firing ? 'Query returned 0 series.' : `${samples.length} series present.`,
            };
          }

          if (samples.length === 0) {
            return {
              rule,
              id: rule.id,
              name: rule.name,
              group: rule.group,
              datasourceType: rule.datasourceType,
              resolvedDatasource: target.name,
              query: rule.query,
              severity: rule.severity,
              enabled: true,
              status: 'normal',
              measuredValue: 'No data',
              thresholdLabel: rule.thresholdLabel,
              evaluatedAt: nowStr,
              updatedBy,
              detail: 'Query returned 0 samples from datasource.',
            };
          }

          let peak = -Infinity;
          let minVal = Infinity;
          const breached: string[] = [];
          for (const s of samples) {
            const val = parseNumericSample(s);
            if (val === null) continue;
            if (val > peak) peak = val;
            if (val < minVal) minVal = val;
            if (compareThreshold(val, rule.conditionOp, rule.threshold)) {
              breached.push(`${describeSampleLabel(s.metric)} (${val.toFixed(2)})`);
            }
          }

          const hasNumeric = Number.isFinite(peak);
          const displayVal = !hasNumeric
            ? 'No numeric value'
            : rule.conditionOp === '<' || rule.conditionOp === '<='
              ? minVal.toFixed(2)
              : peak.toFixed(2);
          const firing = breached.length > 0;

          return {
            rule,
            id: rule.id,
            name: rule.name,
            group: rule.group,
            datasourceType: rule.datasourceType,
            resolvedDatasource: target.name,
            query: rule.query,
            severity: rule.severity,
            enabled: true,
            status: firing ? 'firing' : 'normal',
            measuredValue: samples.length > 1 && hasNumeric ? `Peak ${displayVal}` : displayVal,
            thresholdLabel: rule.thresholdLabel,
            evaluatedAt: nowStr,
            updatedBy,
            detail: firing
              ? `Breached on: ${breached.slice(0, 6).join(', ')}`
              : `Within threshold across ${samples.length} series.`,
          };
        }

        const lookback = rule.lookbackMinutes ?? 15;
        const endIso = new Date().toISOString();
        const startIso = new Date(Date.now() - lookback * 60 * 1000).toISOString();
        const { entries } = await queryVictoriaLogs(rule.query, 200, startIso, endIso, target);
        const count = entries.length;
        const firing =
          rule.conditionOp === 'nonempty'
            ? count > 0
            : rule.conditionOp === 'empty'
              ? count === 0
              : compareThreshold(count, rule.conditionOp, rule.threshold);

        return {
          rule,
          id: rule.id,
          name: rule.name,
          group: rule.group,
          datasourceType: rule.datasourceType,
          resolvedDatasource: target.name,
          query: rule.query,
          severity: rule.severity,
          enabled: true,
          status: firing ? 'firing' : 'normal',
          measuredValue: `${count} log(s)`,
          thresholdLabel: rule.thresholdLabel,
          evaluatedAt: nowStr,
          updatedBy,
          detail:
            count > 0
              ? `Latest: ${entries[0]._msg || entries[0].reason || 'Matched record'}`
              : `0 matched records in last ${lookback}m.`,
        };
      } catch (err) {
        if (err instanceof UnauthorizedError) throw err;
        return {
          rule,
          id: rule.id,
          name: rule.name,
          group: rule.group,
          datasourceType: rule.datasourceType,
          resolvedDatasource: target.name,
          query: rule.query,
          severity: rule.severity,
          enabled: true,
          status: 'error',
          measuredValue: 'Query Error',
          thresholdLabel: rule.thresholdLabel,
          evaluatedAt: nowStr,
          updatedBy,
          detail: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );
}
