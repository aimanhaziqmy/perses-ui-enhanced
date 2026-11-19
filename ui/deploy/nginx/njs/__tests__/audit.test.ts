import { describe, expect, it } from 'vitest';
import audit from '../audit.js';

const {
  extractActor,
  isAdminPermissions,
  isAuthenticated,
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
});
