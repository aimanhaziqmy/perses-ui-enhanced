import { fetchGlobalJsonConfig, saveGlobalJsonConfig } from './http';

export interface SiteBrandingConfig {
  appName: string;
  appSubtitle: string;
  orgName: string;
  logoUrl: string;
  logoText: string;
}

export const DEFAULT_SITE_BRANDING: SiteBrandingConfig = {
  appName: 'Perses',
  appSubtitle: 'Observability · Metrics, Traces & Logs',
  orgName: 'Observability',
  logoUrl: '',
  logoText: 'P',
};

const SITE_BRANDING_STORAGE_KEY = 'perses-site-branding';
const SITE_BRANDING_VAR_NAME = 'site_branding_config';

function normalizeBranding(raw: Partial<SiteBrandingConfig> | null | undefined): SiteBrandingConfig {
  return {
    appName: (raw?.appName ?? '').trim() || DEFAULT_SITE_BRANDING.appName,
    appSubtitle: (raw?.appSubtitle ?? '').trim() || DEFAULT_SITE_BRANDING.appSubtitle,
    orgName: (raw?.orgName ?? '').trim() || DEFAULT_SITE_BRANDING.orgName,
    logoUrl: (raw?.logoUrl ?? '').trim(),
    logoText: ((raw?.logoText ?? '').trim() || DEFAULT_SITE_BRANDING.logoText).slice(0, 2),
  };
}

export function applySiteBrandingToDocument(cfg: SiteBrandingConfig): void {
  if (typeof document === 'undefined') return;
  document.title = cfg.appSubtitle ? `${cfg.appName} — ${cfg.appSubtitle}` : cfg.appName;
  if (cfg.logoUrl) {
    let iconLink = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!iconLink) {
      iconLink = document.createElement('link');
      iconLink.rel = 'icon';
      document.head.appendChild(iconLink);
    }
    iconLink.href = cfg.logoUrl;
  }
}

export function getLocalSiteBranding(): SiteBrandingConfig {
  try {
    const raw = window.localStorage.getItem(SITE_BRANDING_STORAGE_KEY);
    if (!raw) return DEFAULT_SITE_BRANDING;
    const parsed = JSON.parse(raw) as Partial<SiteBrandingConfig>;
    return normalizeBranding(parsed);
  } catch {
    return DEFAULT_SITE_BRANDING;
  }
}

export function setLocalSiteBranding(cfg: SiteBrandingConfig): SiteBrandingConfig {
  const normalized = normalizeBranding(cfg);
  try {
    window.localStorage.setItem(SITE_BRANDING_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Ignore storage quota errors cleanly
  }
  applySiteBrandingToDocument(normalized);
  return normalized;
}

export async function fetchClusterSiteBranding(): Promise<SiteBrandingConfig> {
  const local = getLocalSiteBranding();
  return fetchGlobalJsonConfig(
    SITE_BRANDING_VAR_NAME,
    SITE_BRANDING_STORAGE_KEY,
    (raw) => {
      const normalized = normalizeBranding(raw as Partial<SiteBrandingConfig>);
      applySiteBrandingToDocument(normalized);
      return normalized;
    },
    local,
    { allowUnauthorizedFallback: true },
  );
}

export async function saveClusterSiteBranding(cfg: SiteBrandingConfig): Promise<SiteBrandingConfig> {
  const normalized = normalizeBranding(cfg);
  await saveGlobalJsonConfig(
    SITE_BRANDING_VAR_NAME,
    SITE_BRANDING_STORAGE_KEY,
    normalized,
    'Site Branding Configuration',
    'Dynamic application name, subtitle, organization label, and logo.',
  );
  return setLocalSiteBranding(normalized);
}
