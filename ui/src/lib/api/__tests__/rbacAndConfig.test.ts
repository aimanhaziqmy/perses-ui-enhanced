import { afterEach, describe, expect, it, vi } from 'vitest';
import { getUiCapabilities } from '../rbac';

describe('RBAC capabilities (M5) and config error propagation (M4)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('does not grant canManageUsers to read-only User/GlobalRole auditors', () => {
    const readOnlyAuditor = getUiCapabilities(
      {
        '*': [{ actions: ['read'], scopes: ['User', 'GlobalRole'] }],
      },
      true,
    );
    expect(readOnlyAuditor.canManageUsers).toBe(false);
    expect(readOnlyAuditor.isSiteAdmin).toBe(false);

    const userWriter = getUiCapabilities(
      {
        '*': [{ actions: ['create'], scopes: ['User'] }],
      },
      true,
    );
    expect(userWriter.canManageUsers).toBe(true);
  });

  it('propagates 500 errors in fetchGlobalJsonConfig while allowing 404 and opted-in 401 fallbacks', async () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => null,
        setItem: () => {},
      },
    });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('Not Found', { status: 404 }))
      .mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }))
      .mockResolvedValueOnce(new Response('Internal Server Error', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.resetModules();

    const { fetchGlobalJsonConfig } = await import('@/lib/api/http');

    await expect(
      fetchGlobalJsonConfig('cfg', 'k', (r) => r as { ok: boolean }, { ok: false }),
    ).resolves.toEqual({ ok: false });

    await expect(
      fetchGlobalJsonConfig('cfg', 'k', (r) => r as { ok: boolean }, { ok: false }, { allowUnauthorizedFallback: true }),
    ).resolves.toEqual({ ok: false });

    await expect(
      fetchGlobalJsonConfig('cfg', 'k', (r) => r as { ok: boolean }, { ok: false }),
    ).rejects.toThrow();
  });
});
