import { describe, expect, it } from 'vitest';
import audit from '../audit.js';

const {
  apiV1WithGuestShare,
  extractActor,
  findMatchingPublicShare,
  isAdminPermissions,
  isAllowedGuestApiPath,
  isAuthenticated,
  isGuestDashboardsAllowed,
  proxyWithTenantScope,
  resolveAllowedNamespaces,
  rewriteProxyTarget,
} = audit;

describe('nginx njs gateway enforcement (audit.js)', () => {
  it('ignores spoofed X-Forwarded-User when remote is not a trusted proxy', () => {
    const untrustedReq = {
      variables: { trusted_proxy: '0' },
      headersIn: {
        'X-Forwarded-User': 'admin',
        Cookie: '',
      },
    };
    expect(extractActor(untrustedReq)).toBe('anonymous');
    expect(isAuthenticated(untrustedReq)).toBe('0');

    const trustedReq = {
      variables: { trusted_proxy: '1' },
      headersIn: {
        'X-Forwarded-User': 'alice',
        Cookie: '',
      },
    };
    expect(extractActor(trustedReq)).toBe('alice');
    expect(isAuthenticated(trustedReq)).toBe('1');
  });

  it('detects site admin permissions from Perses permissions map', () => {
    expect(
      isAdminPermissions({
        '*': [{ scopes: ['GlobalVariable'], actions: ['create', 'read'] }],
      }),
    ).toBe(true);
    expect(
      isAdminPermissions({
        '*': [{ scopes: ['GlobalVariable'], actions: ['read'] }],
      }),
    ).toBe(false);
  });

  it('resolves allowed namespaces and falls back to sentinel for unassigned users', () => {
    const map = {
      enabled: true,
      data: {
        items: [
          {
            metadata: { name: 'ws-a', labels: { 'otterscale.io/bob': 'true' } },
            spec: { namespace: 'team-a', members: [{ name: 'alice', role: 'editor' }] },
          },
        ],
      },
    };
    expect(resolveAllowedNamespaces(map, 'alice', 'alice')).toEqual(['team-a']);
    expect(resolveAllowedNamespaces(map, 'bob', 'bob')).toEqual(['team-a']);
    expect(resolveAllowedNamespaces(map, 'eve', 'eve')).toEqual(['__no_workspace_assigned__']);

    const oidcMap = {
      enabled: true,
      data: {
        items: [
          {
            metadata: { name: 'ws-opkang', labels: { 'user.otterscale.io/c944c09a-uuid': 'true' } },
            spec: {
              namespace: 'ns-opkang',
              members: [{ name: 'opkang opkang', subject: 'c944c09a-uuid', role: 'admin' }],
            },
          },
        ],
      },
    };
    expect(resolveAllowedNamespaces(oidcMap, 'opkang', ['opkang'])).toEqual(['ns-opkang']);
    expect(resolveAllowedNamespaces(oidcMap, 'chloh', ['chloh', 'c944c09a-uuid'])).toEqual(['ns-opkang']);

    const namespaceListMap = {
      enabled: true,
      data: {
        kind: 'NamespaceList',
        items: [
          {
            metadata: {
              name: 'bq52f6',
              labels: { 'user.otterscale.io/alice': 'true' },
            },
          },
        ],
      },
    };
    expect(resolveAllowedNamespaces(namespaceListMap, 'alice', ['alice'])).toEqual(['bq52f6']);
  });

  it('rewrites VictoriaLogs, Prometheus, and Jaeger proxy requests server-side', () => {
    const vlPost = rewriteProxyTarget(
      '/proxy/globaldatasources/vl/select/logsql/query_range',
      'POST',
      'query=error&limit=50',
      ['team-a'],
    );
    expect(vlPost.bodyModified).toBe(true);
    expect(decodeURIComponent(vlPost.body)).toContain('kubernetes.pod_namespace:~"^(team-a)$"');

    const promLabels = rewriteProxyTarget(
      '/proxy/globaldatasources/vm/api/v1/label/pod/values',
      'GET',
      '',
      ['team-a', 'team-b'],
    );
    expect(decodeURIComponent(promLabels.uri)).toContain('match[]={namespace=~"^(team-a|team-b)$"}');

    const jaeger = rewriteProxyTarget(
      '/proxy/globaldatasources/jaeger/api/traces?service=api',
      'GET',
      '',
      ['team-a'],
    );
    expect(decodeURIComponent(jaeger.uri)).toContain('"k8s.namespace.name":"team-a"');

    const complexProm = rewriteProxyTarget(
      '/proxy/globaldatasources/vm/api/v1/query_range',
      'POST',
      'query=' + encodeURIComponent('100 - (avg by (node) (rate(node_cpu_seconds_total{mode="idle",namespace="j784rt"}[2m])) * 100)'),
      ['j784rt'],
    );
    expect(complexProm.bodyModified).toBe(true);
    const decodedProm = decodeURIComponent(complexProm.body);
    expect(decodedProm).toBe(
      'query=100 - (avg by (node) (rate(node_cpu_seconds_total{mode="idle",namespace="j784rt"}[2m])) * 100)',
    );
  });

  it('enforces guest role permissions, exact dashboard allowlist, and namespace scope on public share tokens', async () => {
    expect(isGuestDashboardsAllowed({ roles: { guest: [] } })).toBe(false);
    expect(isGuestDashboardsAllowed({ roles: { guest: ['dashboards'] } })).toBe(true);

    const share = {
      token: 'tok-abc123',
      project: 'observability',
      dashboard: 'logs-and-k8s-events',
      allowedNamespaces: ['team-a'],
      enabled: true,
    };

    expect(findMatchingPublicShare({ shares: [share] }, 'tok-abc123')).toEqual(share);
    expect(findMatchingPublicShare({ shares: [share] }, 'wrong-token')).toBeNull();

    // Allowed read paths for this exact share
    expect(isAllowedGuestApiPath('/api/v1/projects/observability/dashboards/logs-and-k8s-events', 'GET', share)).toBe(true);
    expect(isAllowedGuestApiPath('/api/v1/globaldatasources', 'GET', share)).toBe(true);
    expect(isAllowedGuestApiPath('/api/v1/projects/observability/datasources', 'GET', share)).toBe(true);
    // Blocked paths / mutations
    expect(isAllowedGuestApiPath('/api/v1/projects/observability/dashboards/other-dash', 'GET', share)).toBe(false);
    expect(isAllowedGuestApiPath('/api/v1/projects/observability/dashboards/logs-and-k8s-events', 'PUT', share)).toBe(false);
    expect(isAllowedGuestApiPath('/api/v1/globalvariables/perses_ui_public_shares', 'GET', share)).toBe(false);
    expect(isAllowedGuestApiPath('/api/v1/users', 'GET', share)).toBe(false);

    const makeGlobalVar = (obj: unknown) => ({
      status: 200,
      responseText: JSON.stringify({
        kind: 'GlobalVariable',
        spec: { kind: 'TextVariable', spec: { value: JSON.stringify(obj) } },
      }),
    });

    const makeReq = (opts: {
      uri: string;
      method?: string;
      token?: string;
      guestRoles?: string[];
      shares?: unknown[];
    }) => {
      let returnedStatus: number | null = null;
      let redirectedTo: string | null = null;
      const req = {
        method: opts.method ?? 'GET',
        variables: { trusted_proxy: '0', request_uri: opts.uri },
        headersIn: {
          Cookie: '',
          ...(opts.token ? { 'X-Perses-Share-Token': opts.token } : {}),
        },
        headersOut: {} as Record<string, string>,
        requestText: '',
        subrequest: async (path: string) => {
          if (path.includes('role_view_permissions_config')) {
            return makeGlobalVar({ roles: { guest: opts.guestRoles ?? [] } });
          }
          if (path.includes('perses_ui_public_shares')) {
            return makeGlobalVar({ shares: opts.shares ?? [share] });
          }
          return { status: 404, responseText: '' };
        },
        return: (status: number) => {
          returnedStatus = status;
        },
        internalRedirect: (target: string) => {
          redirectedTo = target;
        },
      };
      return {
        req,
        getStatus: () => returnedStatus,
        getRedirect: () => redirectedTo,
      };
    };

    // 1. No token -> 401
    const noTok = makeReq({ uri: '/api/v1/projects/observability/dashboards/logs-and-k8s-events' });
    await apiV1WithGuestShare(noTok.req);
    expect(noTok.getStatus()).toBe(401);

    // 2. Valid token, but guest role has dashboards disabled -> 403
    const disabledGuest = makeReq({
      uri: '/api/v1/projects/observability/dashboards/logs-and-k8s-events',
      token: 'tok-abc123',
      guestRoles: [],
    });
    await apiV1WithGuestShare(disabledGuest.req);
    expect(disabledGuest.getStatus()).toBe(403);

    // 3. Valid token + guest role enabled -> allowed dashboard redirects upstream
    const validDash = makeReq({
      uri: '/api/v1/projects/observability/dashboards/logs-and-k8s-events',
      token: 'tok-abc123',
      guestRoles: ['dashboards'],
    });
    await apiV1WithGuestShare(validDash.req);
    expect(validDash.getRedirect()).toBe('/_perses_upstream/api/v1/projects/observability/dashboards/logs-and-k8s-events');

    // 4. Proxy query with tenant-scoped token -> enforces team-a namespace
    const scopedProxy = makeReq({
      uri: '/proxy/globaldatasources/vm/api/v1/query?query=up',
      token: 'tok-abc123',
      guestRoles: ['dashboards'],
    });
    await proxyWithTenantScope(scopedProxy.req);
    expect(decodeURIComponent(scopedProxy.getRedirect() ?? '')).toContain('namespace="team-a"');

    // 5. Proxy query with admin wildcard token -> unscoped upstream redirect
    const wildcardProxy = makeReq({
      uri: '/proxy/globaldatasources/vm/api/v1/query?query=up',
      token: 'tok-admin',
      guestRoles: ['dashboards'],
      shares: [{ ...share, token: 'tok-admin', allowedNamespaces: ['*'] }],
    });
    await proxyWithTenantScope(wildcardProxy.req);
    expect(wildcardProxy.getRedirect()).toBe('/_perses_upstream/proxy/globaldatasources/vm/api/v1/query?query=up');
  });
});
