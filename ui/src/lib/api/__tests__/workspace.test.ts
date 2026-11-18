import { describe, expect, it } from 'vitest';
import {
  NO_WORKSPACE_SENTINEL,
  getNamespaceScopeKey,
  injectLogsQLNamespaceFilter,
  injectPromQLNamespaceFilter,
  resolveUserWorkspaces,
  rewriteProxyRequestForNamespaces,
  setEnforcedNamespaces,
  splitFirstUnquotedPipe,
} from '../workspace';
import { queryKeys } from '@/lib/api/queryKeys';

describe('workspace isolation', () => {
  it('splitFirstUnquotedPipe handles unquoted, single/double-quoted, and escaped pipes', () => {
    expect(splitFirstUnquotedPipe('* | stats count()')).toEqual({
      filterPart: '*',
      pipePart: '| stats count()',
    });
    expect(splitFirstUnquotedPipe('error OR "foo|bar" | sort by (_time desc)')).toEqual({
      filterPart: 'error OR "foo|bar"',
      pipePart: '| sort by (_time desc)',
    });
    expect(splitFirstUnquotedPipe("_msg:'a|b' AND _msg:\"c\\\"|d\" | limit 10")).toEqual({
      filterPart: "_msg:'a|b' AND _msg:\"c\\\"|d\"",
      pipePart: '| limit 10',
    });
    expect(splitFirstUnquotedPipe('_msg:"only|quoted"')).toEqual({
      filterPart: '_msg:"only|quoted"',
      pipePart: '',
    });
    expect(splitFirstUnquotedPipe('')).toEqual({
      filterPart: '',
      pipePart: '',
    });
  });

  it('injectLogsQLNamespaceFilter preserves pipes and quotes', () => {
    const q1 = injectLogsQLNamespaceFilter('*', ['team-a']);
    expect(q1).toContain('kubernetes.pod_namespace:~"^(team-a)$"');
    expect(q1.startsWith('(*)')).toBe(false);

    const q2 = injectLogsQLNamespaceFilter('error OR "a|b" | limit 50', ['team-a', 'team-b']);
    expect(q2.startsWith('(error OR "a|b") AND ')).toBe(true);
    expect(q2).toContain('^(team-a|team-b)$');
    expect(q2.endsWith(' | limit 50')).toBe(true);
  });

  it('injectPromQLNamespaceFilter handles bare metrics, existing matchers, mixed expressions, and label lists', () => {
    expect(injectPromQLNamespaceFilter('up', ['team-a'])).toBe('up{namespace="team-a"}');
    expect(injectPromQLNamespaceFilter('rate(http_requests_total[5m])', ['team-a'])).toBe(
      'rate(http_requests_total{namespace="team-a"}[5m])',
    );
    expect(injectPromQLNamespaceFilter('http_requests_total{job="api", }', ['team-a'])).toBe(
      'http_requests_total{job="api",namespace="team-a"}',
    );
    expect(injectPromQLNamespaceFilter('http_requests_total{namespace="team-a"}', ['team-a'])).toBe(
      'http_requests_total{namespace="team-a"}',
    );
    expect(
      injectPromQLNamespaceFilter(
        'sum(rate(http_requests_total{status="500"}[5m])) / sum(rate(http_requests_total[5m]))',
        ['team-a'],
      ),
    ).toBe(
      'sum(rate(http_requests_total{status="500",namespace="team-a"}[5m])) / sum(rate(http_requests_total{namespace="team-a"}[5m]))',
    );
    expect(
      injectPromQLNamespaceFilter('sum by (pod, container) (rate(container_cpu_usage_seconds_total[5m]))', ['team-a']),
    ).toBe('sum by (pod, container) (rate(container_cpu_usage_seconds_total{namespace="team-a"}[5m]))');
    expect(injectPromQLNamespaceFilter('label_replace(up, "foo", "{bar}", "baz", ".*")', ['team-a'])).toBe(
      'label_replace(up{namespace="team-a"}, "foo", "{bar}", "baz", ".*")',
    );
    expect(injectPromQLNamespaceFilter('up', ['team-a', 'team-b'])).toBe('up{namespace=~"^(team-a|team-b)$"}');
    expect(injectPromQLNamespaceFilter('up{namespace="kube-system"}', ['team-a'])).toBe(
      'up{namespace="kube-system",namespace="team-a"}',
    );
    expect(injectPromQLNamespaceFilter('up{namespace=~".*"}', ['team-a'])).toBe(
      'up{namespace=~".*",namespace="team-a"}',
    );
    expect(injectPromQLNamespaceFilter('rate(http_requests_total[5m] offset 1h30m)', ['team-a'])).toBe(
      'rate(http_requests_total{namespace="team-a"}[5m] offset 1h30m)',
    );
    expect(injectPromQLNamespaceFilter('up offset 500ms', ['team-a'])).toBe('up{namespace="team-a"} offset 500ms');
  });

  it('rewriteProxyRequestForNamespaces scopes Jaeger v2, Jaeger v3, and Tempo trace searches', () => {
    const j2 = rewriteProxyRequestForNamespaces(
      '/proxy/globaldatasources/jaeger/api/traces?service=api&limit=20',
      undefined,
      ['team-a'],
    );
    const j2Url = new URL(String(j2.input), 'http://localhost');
    expect(j2Url.searchParams.get('tags')).toBe(JSON.stringify({ 'k8s.namespace.name': 'team-a' }));

    const j2Existing = rewriteProxyRequestForNamespaces(
      `/proxy/globaldatasources/jaeger/api/traces?tags=${encodeURIComponent(JSON.stringify({ 'http.method': 'GET' }))}`,
      undefined,
      ['team-a'],
    );
    const j2ExistingUrl = new URL(String(j2Existing.input), 'http://localhost');
    expect(JSON.parse(j2ExistingUrl.searchParams.get('tags') || '{}')).toEqual({
      'http.method': 'GET',
      'k8s.namespace.name': 'team-a',
    });

    const j3 = rewriteProxyRequestForNamespaces(
      '/proxy/globaldatasources/jaeger/api/v3/traces?query.service_name=api',
      undefined,
      ['team-a'],
    );
    const j3Url = new URL(String(j3.input), 'http://localhost');
    expect(j3Url.searchParams.get('query.attributes[k8s.namespace.name]')).toBe('team-a');

    const tempo = rewriteProxyRequestForNamespaces(
      '/proxy/globaldatasources/tempo/api/search?tags=' + encodeURIComponent('service.name="api"'),
      undefined,
      ['team-a'],
    );
    const tempoUrl = new URL(String(tempo.input), 'http://localhost');
    expect(tempoUrl.searchParams.get('tags')).toBe('service.name="api" k8s.namespace.name="team-a"');

    const adminReq = rewriteProxyRequestForNamespaces(
      '/proxy/globaldatasources/jaeger/api/traces?service=api',
      undefined,
      null,
    );
    expect(adminReq.input).toBe('/proxy/globaldatasources/jaeger/api/traces?service=api');
  });

  it('resolveUserWorkspaces and setEnforcedNamespaces handle empty/unassigned users safely', () => {
    setEnforcedNamespaces([]);
    const req = rewriteProxyRequestForNamespaces('/proxy/globaldatasources/vl/select/logsql/query?query=*');
    const u = new URL(String(req.input), 'http://localhost');
    expect(u.searchParams.get('query') || '').toContain(NO_WORKSPACE_SENTINEL);
    setEnforcedNamespaces(null);

    const scopes = resolveUserWorkspaces(
      {
        enabled: true,
        data: {
          items: [
            {
              metadata: { name: 'ws-alpha' },
              spec: { namespace: 'alpha-ns', members: [{ name: 'alice', role: 'editor' }] },
            },
          ],
        },
      },
      'alice',
    );
    expect(scopes).toEqual([{ workspaceName: 'ws-alpha', namespace: 'alpha-ns', role: 'editor' }]);
  });

  it('injects match[] into Prometheus label/series endpoints when absent', () => {
    const single = rewriteProxyRequestForNamespaces(
      '/proxy/globaldatasources/vm/api/v1/label/pod/values',
      undefined,
      ['team-a'],
    );
    const singleUrl = new URL(String(single.input), 'http://localhost');
    expect(singleUrl.searchParams.get('match[]')).toBe('{namespace="team-a"}');

    const multi = rewriteProxyRequestForNamespaces(
      '/proxy/globaldatasources/vm/api/v1/labels',
      undefined,
      ['team-a', 'team-b'],
    );
    const multiUrl = new URL(String(multi.input), 'http://localhost');
    expect(multiUrl.searchParams.get('match[]')).toBe('{namespace=~"^(team-a|team-b)$"}');
  });

  it('scopes proxy query keys by active namespace', () => {
    setEnforcedNamespaces(['team-a']);
    const k1 = queryKeys.clusterHosts('global:vm');
    setEnforcedNamespaces(['team-b', 'team-a']);
    const k2 = queryKeys.clusterHosts('global:vm');
    setEnforcedNamespaces(null);
    const kAdmin = queryKeys.clusterHosts('global:vm');

    expect(k1).toEqual(['proxy', 'cluster-hosts', 'team-a', 'global:vm']);
    expect(k2).toEqual(['proxy', 'cluster-hosts', 'team-a,team-b', 'global:vm']);
    expect(kAdmin).toEqual(['proxy', 'cluster-hosts', '__admin__', 'global:vm']);
    expect(getNamespaceScopeKey([])).toBe(NO_WORKSPACE_SENTINEL);
  });

  it('matches OAuth subject UUIDs and identical-token names without false positives', () => {
    const map = {
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
          {
            metadata: { name: 'ws-john' },
            spec: {
              namespace: 'ns-john',
              members: [{ name: 'john smith', subject: 'other-uuid', role: 'viewer' }],
            },
          },
        ],
      },
    };

    expect(resolveUserWorkspaces(map, 'opkang', ['opkang'])).toEqual([
      { workspaceName: 'ws-opkang', namespace: 'ns-opkang', role: 'admin' },
    ]);
    expect(resolveUserWorkspaces(map, 'chloh', ['chloh', 'c944c09a-uuid'])).toEqual([
      { workspaceName: 'ws-opkang', namespace: 'ns-opkang', role: 'admin' },
    ]);
    expect(resolveUserWorkspaces(map, 'john', ['john'])).toEqual([]);
  });
});
