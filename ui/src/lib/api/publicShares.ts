import { fetchGlobalJsonConfig, saveGlobalJsonConfig } from '@/lib/api/http';

export interface PublicShareEntry {
  token: string;
  project: string;
  dashboard: string;
  panel?: string;
  allowedNamespaces: string[];
  enabled: boolean;
  createdBy: string;
  createdAt: string;
}

export interface PublicSharesConfig {
  shares: PublicShareEntry[];
}

export const PUBLIC_SHARES_VAR_NAME = 'perses_ui_public_shares';
const PUBLIC_SHARES_STORAGE_KEY = 'perses-ui-public-shares';
const EMPTY_PUBLIC_SHARES: PublicSharesConfig = { shares: [] };

export function normalizePublicSharesConfig(raw: unknown): PublicSharesConfig {
  const obj = raw && typeof raw === 'object' ? (raw as Partial<PublicSharesConfig>) : null;
  const list = Array.isArray(obj?.shares) ? obj.shares : [];
  const seen = new Set<string>();
  const shares: PublicShareEntry[] = [];

  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const token = typeof item.token === 'string' ? item.token.trim() : '';
    const project = typeof item.project === 'string' ? item.project.trim() : '';
    const dashboard = typeof item.dashboard === 'string' ? item.dashboard.trim() : '';
    if (!token || !project || !dashboard || seen.has(token)) continue;
    seen.add(token);

    const panel = typeof item.panel === 'string' && item.panel.trim() ? item.panel.trim() : undefined;
    const rawNs = Array.isArray(item.allowedNamespaces) ? item.allowedNamespaces : [];
    const allowedNamespaces = Array.from(
      new Set(rawNs.map((ns) => (typeof ns === 'string' ? ns.trim() : '')).filter(Boolean)),
    );

    shares.push({
      token,
      project,
      dashboard,
      ...(panel ? { panel } : {}),
      allowedNamespaces: allowedNamespaces.length > 0 ? allowedNamespaces : ['*'],
      enabled: item.enabled !== false,
      createdBy: typeof item.createdBy === 'string' ? item.createdBy : '',
      createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
    });
  }

  return { shares };
}

export function generateShareToken(): string {
  const bytes = new Uint8Array(18);
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function fetchPublicShares(): Promise<PublicSharesConfig> {
  return fetchGlobalJsonConfig<PublicSharesConfig>(
    PUBLIC_SHARES_VAR_NAME,
    PUBLIC_SHARES_STORAGE_KEY,
    normalizePublicSharesConfig,
    EMPTY_PUBLIC_SHARES,
  );
}

export async function savePublicShares(config: PublicSharesConfig): Promise<PublicSharesConfig> {
  const normalized = normalizePublicSharesConfig(config);
  return saveGlobalJsonConfig<PublicSharesConfig>(
    PUBLIC_SHARES_VAR_NAME,
    PUBLIC_SHARES_STORAGE_KEY,
    normalized,
    'Public Dashboard Shares',
    'Managed by Perses UI Enhanced — published public dashboard/panel embed share tokens and namespace scopes',
  );
}

export function findShareForTarget(
  config: PublicSharesConfig,
  project: string,
  dashboard: string,
  panel?: string,
): PublicShareEntry | undefined {
  const targetPanel = panel?.trim() || undefined;
  return config.shares.find(
    (s) => s.enabled && s.project === project && s.dashboard === dashboard && (s.panel || undefined) === targetPanel,
  );
}

export function upsertPublicShare(
  config: PublicSharesConfig,
  entry: Omit<PublicShareEntry, 'token' | 'createdAt' | 'enabled'> & { token?: string },
): { config: PublicSharesConfig; entry: PublicShareEntry } {
  const targetPanel = entry.panel?.trim() || undefined;
  const existing = findShareForTarget(config, entry.project, entry.dashboard, targetPanel);
  const nextEntry: PublicShareEntry = {
    token: entry.token?.trim() || existing?.token || generateShareToken(),
    project: entry.project,
    dashboard: entry.dashboard,
    ...(targetPanel ? { panel: targetPanel } : {}),
    allowedNamespaces: entry.allowedNamespaces.length > 0 ? entry.allowedNamespaces : ['*'],
    enabled: true,
    createdBy: entry.createdBy,
    createdAt: new Date().toISOString(),
  };

  const remaining = config.shares.filter(
    (s) => !(s.project === entry.project && s.dashboard === entry.dashboard && (s.panel || undefined) === targetPanel),
  );
  return {
    config: normalizePublicSharesConfig({ shares: [...remaining, nextEntry] }),
    entry: nextEntry,
  };
}

export function revokePublicShare(config: PublicSharesConfig, token: string): PublicSharesConfig {
  return normalizePublicSharesConfig({
    shares: config.shares.filter((s) => s.token !== token),
  });
}
