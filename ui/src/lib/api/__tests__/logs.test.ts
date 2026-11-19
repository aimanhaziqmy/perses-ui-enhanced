import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildLogsQLLevelFilter, classifyLogLevel } from '../logs';

describe('logs structured-field level classification & histogram parity', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('classifies logs strictly from structured level fields and routes unstructured logs to other', () => {
    expect(classifyLogLevel({ _time: '2026-11-18T17:01:41Z', _stream: '{}', level: 'error', _msg: 'boom' })).toBe('error');
    expect(classifyLogLevel({ _time: '2026-11-18T17:01:41Z', _stream: '{}', severity: 'WARN', _msg: 'careful' })).toBe('warning');
    expect(classifyLogLevel({ _time: '2026-11-18T17:01:41Z', _stream: '{}', _msg: 'Pod terminated due to OOMKilled' })).toBe('other');
  });

  it('uses identical structured-field predicates in histogram and level filter without full-text _msg scans', async () => {
    const capturedUrls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((input: RequestInfo | URL) => {
        capturedUrls.push(String(input));
        return Promise.resolve(new Response('', { status: 200 }));
      }),
    );
    vi.resetModules();

    const { queryVictoriaLogsLevelHistogram } = await import('../logs');
    await queryVictoriaLogsLevelHistogram(
      '*',
      '2026-11-18T17:01:41.000Z',
      '2026-11-18T17:01:42.000Z',
      1,
      { scope: 'global', name: 'victorialogs', pluginKind: 'VictoriaLogsDatasource', displayName: 'VictoriaLogs', isDefault: true },
    );

    expect(capturedUrls.length).toBe(1);
    const parsedUrl = new URL(capturedUrls[0], 'http://localhost');
    const histQuery = parsedUrl.searchParams.get('query') ?? '';
    expect(histQuery).toContain('level:~"(?i)(err|fatal|crit|panic)"');
    expect(histQuery).not.toContain('_msg:i(');

    const otherFilter = buildLogsQLLevelFilter(['other']);
    expect(otherFilter).toContain('level:~"(?i)(err|fatal|crit|panic)"');
    expect(otherFilter).not.toContain('_msg:i(');
    expect(otherFilter?.startsWith('NOT ')).toBe(true);
  });
});
