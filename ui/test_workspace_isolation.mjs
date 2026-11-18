import test from 'node:test';
import assert from 'node:assert/strict';

import {
  NO_WORKSPACE_SENTINEL,
  injectLogsQLNamespaceFilter,
  injectPromQLNamespaceFilter,
  resolveUserWorkspaces,
  rewriteProxyRequestForNamespaces,
  setEnforcedNamespaces,
  splitFirstUnquotedPipe,
} from './src/api/workspace.ts';

test('splitFirstUnquotedPipe handles unquoted, single/double-quoted, and escaped pipes', () => {
  assert.deepEqual(splitFirstUnquotedPipe('* | stats count()'), {
    filterPart: '*',
    pipePart: '| stats count()',
  });
  assert.deepEqual(splitFirstUnquotedPipe('error OR "foo|bar" | sort by (_time desc)'), {
    filterPart: 'error OR "foo|bar"',
    pipePart: '| sort by (_time desc)',
  });
  assert.deepEqual(splitFirstUnquotedPipe("_msg:'a|b' AND _msg:\"c\\\"|d\" | limit 10"), {
    filterPart: "_msg:'a|b' AND _msg:\"c\\\"|d\"",
    pipePart: '| limit 10',
  });
  assert.deepEqual(splitFirstUnquotedPipe('_msg:"only|quoted"'), {
    filterPart: '_msg:"only|quoted"',
    pipePart: '',
  });
  assert.deepEqual(splitFirstUnquotedPipe(''), {
    filterPart: '',
    pipePart: '',
  });
});

test('injectLogsQLNamespaceFilter preserves pipes and quotes', () => {
  const q1 = injectLogsQLNamespaceFilter('*', ['team-a']);
  assert.ok(q1.includes('kubernetes.pod_namespace:~"^(team-a)$"'));
  assert.ok(!q1.startsWith('(*)'));

  const q2 = injectLogsQLNamespaceFilter('error OR "a|b" | limit 50', ['team-a', 'team-b']);
  assert.ok(q2.startsWith('(error OR "a|b") AND '));
  assert.ok(q2.includes('^(team-a|team-b)$'));
  assert.ok(q2.endsWith(' | limit 50'));
});

test('injectPromQLNamespaceFilter handles bare metrics, existing matchers, mixed expressions, and label lists', () => {
  assert.equal(injectPromQLNamespaceFilter('up', ['team-a']), 'up{namespace="team-a"}');
  assert.equal(
    injectPromQLNamespaceFilter('rate(http_requests_total[5m])', ['team-a']),
    'rate(http_requests_total{namespace="team-a"}[5m])',
  );
  assert.equal(
    injectPromQLNamespaceFilter('http_requests_total{job="api", }', ['team-a']),
    'http_requests_total{job="api",namespace="team-a"}',
  );
  assert.equal(
    injectPromQLNamespaceFilter('http_requests_total{namespace="team-a"}', ['team-a']),
    'http_requests_total{namespace="team-a"}',
  );
  // Mixed expression: one metric with {}, one bare metric
  assert.equal(
    injectPromQLNamespaceFilter(
      'sum(rate(http_requests_total{status="500"}[5m])) / sum(rate(http_requests_total[5m]))',
      ['team-a'],
    ),
    'sum(rate(http_requests_total{status="500",namespace="team-a"}[5m])) / sum(rate(http_requests_total{namespace="team-a"}[5m]))',
  );
  // Grouping modifier label lists must NOT be rewritten as metrics
  assert.equal(
    injectPromQLNamespaceFilter('sum by (pod, container) (rate(container_cpu_usage_seconds_total[5m]))', ['team-a']),
    'sum by (pod, container) (rate(container_cpu_usage_seconds_total{namespace="team-a"}[5m]))',
  );
  // String literals containing braces or identifiers must NOT be corrupted
  assert.equal(
    injectPromQLNamespaceFilter('label_replace(up, "foo", "{bar}", "baz", ".*")', ['team-a']),
    'label_replace(up{namespace="team-a"}, "foo", "{bar}", "baz", ".*")',
  );
  // Multi-namespace regex matcher
  assert.equal(
    injectPromQLNamespaceFilter('up', ['team-a', 'team-b']),
    'up{namespace=~"^(team-a|team-b)$"}',
  );
  // Prevent workspace isolation bypass via conflicting/wildcard namespace matchers
  assert.equal(
    injectPromQLNamespaceFilter('up{namespace="kube-system"}', ['team-a']),
    'up{namespace="kube-system",namespace="team-a"}',
  );
  assert.equal(
    injectPromQLNamespaceFilter('up{namespace=~".*"}', ['team-a']),
    'up{namespace=~".*",namespace="team-a"}',
  );
  // Duration literals after offset must NOT be treated as bare metrics
  assert.equal(
    injectPromQLNamespaceFilter('rate(http_requests_total[5m] offset 1h30m)', ['team-a']),
    'rate(http_requests_total{namespace="team-a"}[5m] offset 1h30m)',
  );
  assert.equal(
    injectPromQLNamespaceFilter('up offset 500ms', ['team-a']),
    'up{namespace="team-a"} offset 500ms',
  );
});

test('rewriteProxyRequestForNamespaces scopes Jaeger v2, Jaeger v3, and Tempo trace searches', () => {
  // Jaeger v2 /api/traces
  const j2 = rewriteProxyRequestForNamespaces(
    '/proxy/globaldatasources/jaeger/api/traces?service=api&limit=20',
    undefined,
    ['team-a'],
  );
  const j2Url = new URL(String(j2.input), 'http://localhost');
  assert.equal(j2Url.searchParams.get('tags'), JSON.stringify({ 'k8s.namespace.name': 'team-a' }));

  // Jaeger v2 with existing tags
  const j2Existing = rewriteProxyRequestForNamespaces(
    `/proxy/globaldatasources/jaeger/api/traces?tags=${encodeURIComponent(JSON.stringify({ 'http.method': 'GET' }))}`,
    undefined,
    ['team-a'],
  );
  const j2ExistingUrl = new URL(String(j2Existing.input), 'http://localhost');
  assert.deepEqual(JSON.parse(j2ExistingUrl.searchParams.get('tags') || '{}'), {
    'http.method': 'GET',
    'k8s.namespace.name': 'team-a',
  });

  // Jaeger v3 /api/v3/traces
  const j3 = rewriteProxyRequestForNamespaces(
    '/proxy/globaldatasources/jaeger/api/v3/traces?query.service_name=api',
    undefined,
    ['team-a'],
  );
  const j3Url = new URL(String(j3.input), 'http://localhost');
  assert.equal(j3Url.searchParams.get('query.attributes[k8s.namespace.name]'), 'team-a');

  // Tempo /api/search
  const tempo = rewriteProxyRequestForNamespaces(
    '/proxy/globaldatasources/tempo/api/search?tags=' + encodeURIComponent('service.name="api"'),
    undefined,
    ['team-a'],
  );
  const tempoUrl = new URL(String(tempo.input), 'http://localhost');
  assert.equal(tempoUrl.searchParams.get('tags'), 'service.name="api" k8s.namespace.name="team-a"');

  // Admin / null namespaces -> untouched
  const adminReq = rewriteProxyRequestForNamespaces(
    '/proxy/globaldatasources/jaeger/api/traces?service=api',
    undefined,
    null,
  );
  assert.equal(adminReq.input, '/proxy/globaldatasources/jaeger/api/traces?service=api');
});

test('resolveUserWorkspaces and setEnforcedNamespaces handle empty/unassigned users safely', () => {
  setEnforcedNamespaces([]);
  const req = rewriteProxyRequestForNamespaces('/proxy/globaldatasources/vl/select/logsql/query?query=*');
  const u = new URL(String(req.input), 'http://localhost');
  assert.ok((u.searchParams.get('query') || '').includes(NO_WORKSPACE_SENTINEL));
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
  assert.deepEqual(scopes, [{ workspaceName: 'ws-alpha', namespace: 'alpha-ns', role: 'editor' }]);
});
