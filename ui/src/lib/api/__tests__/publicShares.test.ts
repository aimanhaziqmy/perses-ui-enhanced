import { describe, expect, it } from 'vitest';

import {
  findShareForTarget,
  normalizePublicSharesConfig,
  revokePublicShare,
  upsertPublicShare,
} from '@/lib/api/publicShares';

describe('publicShares config helpers', () => {
  it('publishes, updates namespace scope, finds by target/panel, and revokes tokens', () => {
    const empty = normalizePublicSharesConfig(null);
    expect(empty.shares).toEqual([]);

    const created = upsertPublicShare(empty, {
      project: 'observability',
      dashboard: 'logs-and-k8s-events',
      panel: 'logVolumeByStream',
      allowedNamespaces: ['team-a'],
      createdBy: 'admin',
    });
    expect(created.entry.token.length).toBeGreaterThanOrEqual(16);
    expect(created.entry.allowedNamespaces).toEqual(['team-a']);

    const found = findShareForTarget(created.config, 'observability', 'logs-and-k8s-events', 'logVolumeByStream');
    expect(found?.token).toBe(created.entry.token);
    expect(findShareForTarget(created.config, 'observability', 'logs-and-k8s-events')).toBeUndefined();

    // Updating the same target keeps the same token and updates namespace scope
    const updated = upsertPublicShare(created.config, {
      project: 'observability',
      dashboard: 'logs-and-k8s-events',
      panel: 'logVolumeByStream',
      allowedNamespaces: ['*'],
      createdBy: 'admin',
    });
    expect(updated.entry.token).toBe(created.entry.token);
    expect(updated.entry.allowedNamespaces).toEqual(['*']);

    // Revoking removes the token
    const revoked = revokePublicShare(updated.config, updated.entry.token);
    expect(revoked.shares).toEqual([]);
  });
});
