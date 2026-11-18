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

export function getNamespaceScopeKey(namespaces?: string[] | null): string {
  const active = namespaces !== undefined ? namespaces : enforcedNamespaces;
  if (active === null) return '__admin__';
  if (active.length === 0) return NO_WORKSPACE_SENTINEL;
  return [...active].sort().join(',');
}

function normalizeIdentity(val: string | undefined): string {
  return (val ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isIdenticalTokenNameMatch(memberName: string | undefined, rawUserLower: string): boolean {
  if (!rawUserLower || !memberName) return false;
  const tokens = memberName.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return tokens.length > 0 && tokens.every((t) => t === rawUserLower);
}

export function resolveUserWorkspaces(
  payload: WorkspaceMapPayload | undefined,
  username: string,
  sub: string | string[] = '',
): UserWorkspaceScope[] {
  if (!payload?.enabled) return [];
  const items = payload.data?.items ?? [];
  const normUser = normalizeIdentity(username);
  const rawUserLower = (username ?? '').trim().toLowerCase();
  const subList = Array.isArray(sub) ? sub : sub ? [sub] : [];
  const subLowers = Array.from(new Set(subList.map((s) => (s ?? '').trim().toLowerCase()).filter(Boolean)));
  const normCandidates = Array.from(
    new Set([normUser, ...subList.map((s) => normalizeIdentity(s))].filter(Boolean)),
  );

  if (!normUser && subLowers.length === 0) return [];

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
        subLowers.some((s) => lowerK.endsWith(`/${s}`)) ||
        (Boolean(rawUserLower) && lowerK.endsWith(`/${rawUserLower}`))
      );
    });

    const memberMatch = members.find((m) => {
      if (m.serviceAccount) return false;
      const mSub = (m.subject ?? '').trim().toLowerCase();
      const mNameLower = (m.name ?? '').trim().toLowerCase();
      const mNorm = normalizeIdentity(m.name);
      if (mSub && subLowers.includes(mSub)) return true;
      if (rawUserLower && (mSub === rawUserLower || mNameLower === rawUserLower)) return true;
      if (mNameLower && subLowers.includes(mNameLower)) return true;
      if (mNorm && normCandidates.includes(mNorm)) return true;
      if (isIdenticalTokenNameMatch(m.name, rawUserLower)) return true;
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

export function splitFirstUnquotedPipe(query: string): { filterPart: string; pipePart: string } {
  const trimmed = query.trim();
  let inSingle = false;
  let inDouble = false;
  let escaped = false;
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
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (ch === '|' && !inSingle && !inDouble) {
      return {
        filterPart: trimmed.slice(0, i).trim(),
        pipePart: trimmed.slice(i).trim(),
      };
    }
  }
  return { filterPart: trimmed, pipePart: '' };
}

function prependLogsQLClause(query: string, filterExpr: string): string {
  const { filterPart, pipePart } = splitFirstUnquotedPipe(query.trim() || '*');
  const base = filterPart || '*';
  const combined = base === '*' ? filterExpr : `(${base}) AND ${filterExpr}`;
  return pipePart ? `${combined} ${pipePart}` : combined;
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

const PROMQL_LABEL_LIST_MODIFIERS = new Set(['by', 'without', 'on', 'ignoring', 'group_left', 'group_right']);

function hasExactMatcher(inner: string, matcher: string): boolean {
  // Check if the exact enforced matcher already appears as a label matcher outside quotes
  let i = 0;
  let depthQuote: string | null = null;
  while (i < inner.length) {
    const ch = inner[i];
    if (depthQuote) {
      if (ch === '\\' && depthQuote !== '`') {
        i += 2;
        continue;
      }
      if (ch === depthQuote) depthQuote = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      depthQuote = ch;
      i++;
      continue;
    }
    if (inner.startsWith(matcher, i)) {
      const prevOk = i === 0 || /[\s,{]/.test(inner[i - 1]);
      const nextIdx = i + matcher.length;
      const nextOk = nextIdx === inner.length || /[\s,}]/.test(inner[nextIdx]);
      if (prevOk && nextOk) return true;
    }
    i++;
  }
  return false;
}

function readBalancedQuoted(str: string, start: number): number {
  const quote = str[start];
  let i = start + 1;
  while (i < str.length) {
    if (str[i] === '\\' && quote !== '`') {
      i += 2;
      continue;
    }
    if (str[i] === quote) {
      return i + 1;
    }
    i++;
  }
  return str.length;
}

export function injectPromQLNamespaceFilter(expr: string, namespaces: string[]): string {
  const trimmed = expr.trim();
  if (!trimmed) return trimmed;
  const safeList = namespaces.length > 0 ? namespaces : [NO_WORKSPACE_SENTINEL];
  const matcher =
    safeList.length === 1
      ? `namespace="${safeList[0].replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
      : `namespace=~"^(${safeList.map(escapeRegexLiteral).join('|')})$"`;

  let out = '';
  let i = 0;
  let expectLabelListParen = false;

  while (i < trimmed.length) {
    const ch = trimmed[i];

    // String literals
    if (ch === '"' || ch === "'" || ch === '`') {
      const end = readBalancedQuoted(trimmed, i);
      out += trimmed.slice(i, end);
      i = end;
      expectLabelListParen = false;
      continue;
    }

    // Comments
    if (ch === '#') {
      const nl = trimmed.indexOf('\n', i);
      const end = nl === -1 ? trimmed.length : nl + 1;
      out += trimmed.slice(i, end);
      i = end;
      continue;
    }

    // Whitespace
    if (/\s/.test(ch)) {
      out += ch;
      i++;
      continue;
    }

    // Label list after by/without/on/ignoring/group_left/group_right
    if (ch === '(' && expectLabelListParen) {
      let depth = 1;
      let j = i + 1;
      while (j < trimmed.length && depth > 0) {
        if (trimmed[j] === '"' || trimmed[j] === "'" || trimmed[j] === '`') {
          j = readBalancedQuoted(trimmed, j);
          continue;
        }
        if (trimmed[j] === '(') depth++;
        else if (trimmed[j] === ')') depth--;
        j++;
      }
      out += trimmed.slice(i, j);
      i = j;
      expectLabelListParen = false;
      continue;
    }
    expectLabelListParen = false;

    // Range / subquery brackets [...]
    if (ch === '[') {
      const close = trimmed.indexOf(']', i + 1);
      const end = close === -1 ? trimmed.length : close + 1;
      out += trimmed.slice(i, end);
      i = end;
      continue;
    }

    // Label selector block {...}
    if (ch === '{') {
      let j = i + 1;
      while (j < trimmed.length && trimmed[j] !== '}') {
        if (trimmed[j] === '"' || trimmed[j] === "'" || trimmed[j] === '`') {
          j = readBalancedQuoted(trimmed, j);
          continue;
        }
        j++;
      }
      const hasClose = j < trimmed.length && trimmed[j] === '}';
      const inner = trimmed.slice(i + 1, j);
      if (hasExactMatcher(inner, matcher)) {
        out += trimmed.slice(i, hasClose ? j + 1 : j);
      } else {
        const cleanInner = inner.trim().replace(/,\s*$/, '');
        out += cleanInner ? `{${cleanInner},${matcher}}` : `{${matcher}}`;
      }
      i = hasClose ? j + 1 : j;
      continue;
    }

    // Identifiers (metrics, functions, keywords)
    if (/[a-zA-Z_:]/.test(ch)) {
      const start = i;
      while (i < trimmed.length && /[a-zA-Z0-9_:]/.test(trimmed[i])) i++;
      const ident = trimmed.slice(start, i);
      const lower = ident.toLowerCase();

      if (PROMQL_LABEL_LIST_MODIFIERS.has(lower)) {
        out += ident;
        expectLabelListParen = true;
        continue;
      }

      if (PROMQL_RESERVED.has(lower)) {
        out += ident;
        continue;
      }

      // Look ahead past whitespace for '(' (function call) or '{' (existing selector)
      let k = i;
      while (k < trimmed.length && /\s/.test(trimmed[k])) k++;
      if (trimmed[k] === '(' || trimmed[k] === '{') {
        out += ident;
        continue;
      }

      // Bare metric identifier
      out += `${ident}{${matcher}}`;
      continue;
    }

    // Numbers and duration literals (e.g. 1e5, 0x10, 5m, 1h30m, 500ms)
    if (/[0-9]/.test(ch)) {
      const start = i;
      while (i < trimmed.length && /[0-9a-fA-FxXeE._]/.test(trimmed[i])) i++;
      // Consume PromQL duration suffixes like 5m, 1h30m, 500ms
      while (i < trimmed.length) {
        const rest = trimmed.slice(i);
        const durMatch = rest.match(/^(?:ms|[smhdwy])(?:[0-9]+(?:ms|[smhdwy]))*/);
        if (durMatch && (i + durMatch[0].length >= trimmed.length || !/[a-zA-Z0-9_:]/.test(trimmed[i + durMatch[0].length]))) {
          i += durMatch[0].length;
        } else {
          break;
        }
      }
      out += trimmed.slice(start, i);
      continue;
    }

    out += ch;
    i++;
  }

  return out;
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
    path.includes('/select/logsql/query_range') ||
    path.includes('/select/logsql/query') ||
    path.includes('/select/logsql/hits') ||
    path.includes('/select/logsql/stats_query_range') ||
    path.includes('/select/logsql/stats_query') ||
    path.includes('/select/logsql/field_values') ||
    path.includes('/select/logsql/field_names') ||
    path.includes('/select/logsql/facets');

  const isPrometheus =
    path.endsWith('/api/v1/query') ||
    path.endsWith('/api/v1/query_range') ||
    path.endsWith('/api/v1/series') ||
    path.endsWith('/api/v1/labels') ||
    path.includes('/api/v1/label/');

  const isJaegerV2Traces = path.endsWith('/api/traces');
  const isJaegerV3Traces = path.endsWith('/api/v3/traces');
  const isTempoSearch = path.endsWith('/api/search');
  const isTraceServices = path.endsWith('/api/services') || path.endsWith('/api/v3/services');

  if (!isVictoriaLogs && !isPrometheus && !isJaegerV2Traces && !isJaegerV3Traces && !isTempoSearch && !isTraceServices) {
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
    const nsMatcher =
      activeNs.length === 1
        ? `namespace="${activeNs[0]}"`
        : `namespace=~"^(${activeNs.map(escapeRegexLiteral).join('|')})$"`;
    const isLabelOrSeriesEndpoint =
      path.endsWith('/api/v1/series') ||
      path.endsWith('/api/v1/labels') ||
      path.includes('/api/v1/label/');

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
    } else if (isLabelOrSeriesEndpoint && !(typeof nextInit?.body === 'string' && nextInit.body.includes('match%5B%5D='))) {
      urlObj.searchParams.append('match[]', `{${nsMatcher}}`);
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

  if (isJaegerV2Traces && activeNs.length === 1) {
    let tagMap: Record<string, string> = {};
    const rawTags = urlObj.searchParams.get('tags');
    if (rawTags) {
      try {
        const parsed = JSON.parse(rawTags) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          tagMap = parsed as Record<string, string>;
        }
      } catch {
        // Ignore malformed client tags and overwrite with enforced namespace map
      }
    }
    tagMap['k8s.namespace.name'] = activeNs[0];
    urlObj.searchParams.set('tags', JSON.stringify(tagMap));
  }

  if (isJaegerV3Traces && activeNs.length === 1) {
    urlObj.searchParams.set('query.attributes[k8s.namespace.name]', activeNs[0]);
  }

  if (isTempoSearch && activeNs.length === 1) {
    const existingTags = (urlObj.searchParams.get('tags') ?? '').trim();
    const escaped = activeNs[0].replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const nsTag = `k8s.namespace.name="${escaped}"`;
    urlObj.searchParams.set('tags', existingTags ? `${existingTags} ${nsTag}` : nsTag);
  }

  if (isTraceServices && activeNs.length === 1) {
    urlObj.searchParams.set('namespace', activeNs[0]);
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
