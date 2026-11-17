export interface WorkspaceMember {
  name?: string;
  role?: string;
  serviceAccount?: boolean;
  subject?: string;
}

export interface RawK8sWorkspaceItem {
  metadata?: {
    name?: string;
    labels?: Record<string, string>;
  };
  spec?: {
    namespace?: string;
    members?: WorkspaceMember[];
  };
  status?: {
    namespaceRef?: { name?: string };
  };
}

export interface WorkspaceMapPayload {
  enabled: boolean;
  data?: {
    items?: RawK8sWorkspaceItem[];
  };
}

export interface UserWorkspaceScope {
  workspaceName: string;
  namespace: string;
  role: string;
}

export const NO_WORKSPACE_SENTINEL = '__no_workspace_assigned__';

let enforcedNamespaces: string[] | null = null;

export function setEnforcedNamespaces(namespaces: string[] | null): void {
  enforcedNamespaces = namespaces && namespaces.length > 0 ? [...namespaces] : namespaces === null ? null : [NO_WORKSPACE_SENTINEL];
}

export function getEnforcedNamespaces(): string[] | null {
  return enforcedNamespaces;
}

function normalizeIdentity(val: string | undefined): string {
  return (val ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function resolveUserWorkspaces(
  payload: WorkspaceMapPayload | undefined,
  username: string,
  sub = '',
): UserWorkspaceScope[] {
  if (!payload?.enabled) return [];
  const items = payload.data?.items ?? [];
  const normUser = normalizeIdentity(username);
  const rawUserLower = (username ?? '').trim().toLowerCase();
  const rawSubLower = (sub ?? '').trim().toLowerCase();

  if (!normUser && !rawSubLower) return [];

  const matched: UserWorkspaceScope[] = [];
  const seenNs = new Set<string>();

  for (const item of items) {
    const wsName = item.metadata?.name?.trim() || '';
    const labels = item.metadata?.labels ?? {};
    const nsLabel = Object.entries(labels).find(([k]) => k.endsWith('/namespace'))?.[1]?.trim();
    const ns =
      item.spec?.namespace?.trim() ||
      item.status?.namespaceRef?.name?.trim() ||
      nsLabel ||
      wsName;
    if (!ns) continue;

    const members = item.spec?.members ?? [];

    const hasLabelMatch = Object.entries(labels).some(([k, v]) => {
      if (v !== 'true') return false;
      const lowerK = k.toLowerCase();
      return (
        (Boolean(rawSubLower) && lowerK.endsWith(`/${rawSubLower}`)) ||
        (Boolean(rawUserLower) && lowerK.endsWith(`/${rawUserLower}`))
      );
    });

    const memberMatch = members.find((m) => {
      if (m.serviceAccount) return false;
      const mSub = (m.subject ?? '').trim().toLowerCase();
      const mNameLower = (m.name ?? '').trim().toLowerCase();
      const mNorm = normalizeIdentity(m.name);
      if (rawSubLower && mSub === rawSubLower) return true;
      if (rawUserLower && (mSub === rawUserLower || mNameLower === rawUserLower)) return true;
      if (normUser && mNorm && mNorm === normUser) return true;
      return false;
    });

    if (hasLabelMatch || memberMatch) {
      if (!seenNs.has(ns)) {
        seenNs.add(ns);
        matched.push({
          workspaceName: wsName || ns,
          namespace: ns,
          role: memberMatch?.role || 'viewer',
        });
      }
    }
  }

  return matched;
}

export async function fetchWorkspaceMap(): Promise<WorkspaceMapPayload> {
  try {
    const res = await globalThis.fetch('/workspace-map.json', {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
    });
    if (!res.ok) return { enabled: false, data: { items: [] } };
    const parsed = (await res.json()) as WorkspaceMapPayload;
    return {
      enabled: Boolean(parsed?.enabled),
      data: parsed?.data ?? { items: [] },
    };
  } catch {
    return { enabled: false, data: { items: [] } };
  }
}

function escapeRegexLiteral(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function prependLogsQLClause(query: string, filterExpr: string): string {
  const trimmed = query.trim() || '*';
  let inSingle = false;
  let inDouble = false;
  let escaped = false;
  let pipeIdx = -1;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === '|' && !inSingle && !inDouble) {
      pipeIdx = i;
      break;
    }
  }
  const filterPart = pipeIdx === -1 ? trimmed : trimmed.slice(0, pipeIdx).trim() || '*';
  const pipePart = pipeIdx === -1 ? '' : trimmed.slice(pipeIdx + 1).trim();
  const combined = filterPart === '*' ? filterExpr : `(${filterPart}) AND ${filterExpr}`;
  return pipePart ? `${combined} | ${pipePart}` : combined;
}

export function injectLogsQLNamespaceFilter(query: string, namespaces: string[]): string {
  const safeList = namespaces.length > 0 ? namespaces : [NO_WORKSPACE_SENTINEL];
  const pattern = safeList.map(escapeRegexLiteral).join('|');
  const nsExpr = `(kubernetes.pod_namespace:~"^(${pattern})$" OR kubernetes.namespace_name:~"^(${pattern})$" OR namespace:~"^(${pattern})$" OR objectRef.namespace:~"^(${pattern})$")`;
  return prependLogsQLClause(query, nsExpr);
}

const PROMQL_RESERVED = new Set([
  'and',
  'or',
  'unless',
  'by',
  'without',
  'on',
  'ignoring',
  'group_left',
  'group_right',
  'bool',
  'offset',
  'sum',
  'avg',
  'min',
  'max',
  'count',
  'stddev',
  'stdvar',
  'topk',
  'bottomk',
  'count_values',
  'quantile',
  'rate',
  'irate',
  'increase',
  'delta',
  'idelta',
  'deriv',
  'predict_linear',
  'histogram_quantile',
  'label_replace',
  'label_join',
  'vector',
  'scalar',
  'time',
  'absent',
  'absent_over_time',
  'changes',
  'resets',
  'sort',
  'sort_desc',
  'clamp',
  'clamp_min',
  'clamp_max',
  'round',
  'floor',
  'ceil',
  'abs',
  'sgn',
  'exp',
  'ln',
  'log2',
  'log10',
  'sqrt',
  'avg_over_time',
  'min_over_time',
  'max_over_time',
  'sum_over_time',
  'count_over_time',
  'quantile_over_time',
  'stddev_over_time',
  'stdvar_over_time',
  'last_over_time',
  'present_over_time',
]);

export function injectPromQLNamespaceFilter(expr: string, namespaces: string[]): string {
  const trimmed = expr.trim();
  if (!trimmed) return trimmed;
  const safeList = namespaces.length > 0 ? namespaces : [NO_WORKSPACE_SENTINEL];
  const matcher =
    safeList.length === 1
      ? `namespace="${safeList[0].replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
      : `namespace=~"^(${safeList.map(escapeRegexLiteral).join('|')})$"`;

  // Rewrite existing { ... } label selector blocks that don't already constrain namespace
  let rewritten = trimmed.replace(/\{([^{}]*)\}/g, (full, inner: string) => {
    if (/\bnamespace\s*(=|!=|=~|!~)/.test(inner)) {
      return full;
    }
    const cleanInner = inner.trim().replace(/,\s*$/, '');
    return cleanInner ? `{${cleanInner},${matcher}}` : `{${matcher}}`;
  });

  // If the expression had no { ... } selector at all (e.g. bare metric `up` or `rate(node_cpu[5m])`),
  // attach {matcher} to bare metric identifiers not followed by `(` or `{`.
  if (rewritten === trimmed && !trimmed.includes('{')) {
    rewritten = trimmed.replace(
      /\b([a-zA-Z_:][a-zA-Z0-9_:]*)\b(?!\s*[({])/g,
      (match, ident: string, offset: number, fullStr: string) => {
        if (PROMQL_RESERVED.has(ident.toLowerCase())) return match;
        const before = fullStr.slice(0, offset);
        if (/\[[^\]]*$/.test(before)) return match;
        return `${ident}{${matcher}}`;
      },
    );
  }

  return rewritten;
}

export function rewriteProxyRequestForNamespaces(
  input: RequestInfo | URL,
  init?: RequestInit,
  overrideNamespaces?: string[] | null,
): { input: RequestInfo | URL; init?: RequestInit } {
  const activeNs = overrideNamespaces !== undefined ? overrideNamespaces : enforcedNamespaces;
  if (!activeNs) return { input, init };

  const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  if (!urlStr.includes('/proxy/')) return { input, init };

  const baseOrigin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
  const urlObj = new URL(urlStr, baseOrigin);
  const path = urlObj.pathname;

  const isVictoriaLogs =
    path.includes('/select/logsql/query') ||
    path.includes('/select/logsql/hits') ||
    path.includes('/select/logsql/field_values') ||
    path.includes('/select/logsql/field_names') ||
    path.includes('/select/logsql/facets');

  const isPrometheus =
    path.endsWith('/api/v1/query') ||
    path.endsWith('/api/v1/query_range') ||
    path.endsWith('/api/v1/series') ||
    path.endsWith('/api/v1/labels') ||
    path.includes('/api/v1/label/');

  if (!isVictoriaLogs && !isPrometheus) {
    return { input, init };
  }

  let nextInit = init ? { ...init } : undefined;

  if (isVictoriaLogs) {
    if (urlObj.searchParams.has('query')) {
      const q = urlObj.searchParams.get('query') ?? '*';
      urlObj.searchParams.set('query', injectLogsQLNamespaceFilter(q, activeNs));
    }
    if (typeof nextInit?.body === 'string' && nextInit.body.includes('query=')) {
      const bodyParams = new URLSearchParams(nextInit.body);
      if (bodyParams.has('query')) {
        bodyParams.set('query', injectLogsQLNamespaceFilter(bodyParams.get('query') ?? '*', activeNs));
        nextInit = { ...nextInit, body: bodyParams.toString() };
      }
    }
  }

  if (isPrometheus) {
    if (activeNs.length === 1) {
      urlObj.searchParams.append('extra_label', `namespace=${activeNs[0]}`);
    }
    if (urlObj.searchParams.has('query')) {
      const q = urlObj.searchParams.get('query') ?? '';
      urlObj.searchParams.set('query', injectPromQLNamespaceFilter(q, activeNs));
    }
    if (urlObj.searchParams.has('match[]')) {
      const matches = urlObj.searchParams.getAll('match[]');
      urlObj.searchParams.delete('match[]');
      for (const m of matches) {
        urlObj.searchParams.append('match[]', injectPromQLNamespaceFilter(m, activeNs));
      }
    }
    if (typeof nextInit?.body === 'string' && (nextInit.body.includes('query=') || nextInit.body.includes('match%5B%5D='))) {
      const bodyParams = new URLSearchParams(nextInit.body);
      if (bodyParams.has('query')) {
        bodyParams.set('query', injectPromQLNamespaceFilter(bodyParams.get('query') ?? '', activeNs));
      }
      if (bodyParams.has('match[]')) {
        const matches = bodyParams.getAll('match[]');
        bodyParams.delete('match[]');
        for (const m of matches) {
          bodyParams.append('match[]', injectPromQLNamespaceFilter(m, activeNs));
        }
      }
      nextInit = { ...nextInit, body: bodyParams.toString() };
    }
  }

  const finalUrl = urlStr.startsWith('http') ? urlObj.toString() : `${urlObj.pathname}${urlObj.search}`;
  if (input instanceof Request) {
    return {
      input: new Request(finalUrl, {
        method: input.method,
        headers: input.headers,
        credentials: input.credentials,
        mode: input.mode,
        ...nextInit,
      }),
      init: undefined,
    };
  }
  return { input: finalUrl, init: nextInit };
}
