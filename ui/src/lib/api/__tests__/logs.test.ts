import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildLogsQLLevelFilter, classifyLogLevel } from '../logs';

describe('logs level classification & histogram parity', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('classifies OOMKilled / error message logs as error', () => {
    expect(classifyLogLevel({ _time: '2026-11-18T17:01:41Z', _stream: '{}', _msg: 'Pod terminated due to OOMKilled' })).toBe('error');
    expect(classifyLogLevel({ _time: '2026-11-18T17:01:41Z', _stream: '{}', _msg: 'Normal request 200 OK' })).toBe('other');
  });

  it('uses the same _msg + structured predicates in level histogram as buildLogsQLLevelFilter', async () => {
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
      'CrashLoopBackOff OR OOMKilled',
      '2026-11-18T17:01:41.000Z',
      '2026-11-18T17:01:42.000Z',
      1,
      { scope: 'global', name: 'victorialogs', pluginKind: 'VictoriaLogsDatasource', displayName: 'VictoriaLogs', isDefault: true },
    );

    expect(capturedUrls.length).toBe(1);
    const parsedUrl = new URL(capturedUrls[0], 'http://localhost');
    const histQuery = parsedUrl.searchParams.get('query') ?? '';
    expect(histQuery).toContain('_msg:i(oomkilled)');
    expect(histQuery).toContain('_msg:i(warning)');
    expect(histQuery).toContain('_msg:i(debug)');
    expect(histQuery).toContain('_msg:i(info)');

    const otherFilter = buildLogsQLLevelFilter(['other']);
    expect(otherFilter).toContain('_msg:i(oomkilled)');
    expect(otherFilter?.startsWith('NOT ')).toBe(true);
  });
});
