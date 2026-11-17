import { fetchJson } from '@perses-dev/client';

import { apiGetJson, persesFetchFn } from './http';

export interface PersesHealthResponse {
  buildTime?: string;
  version?: string;
  commit?: string;
  database?: boolean;
}

export interface PersesAuthProviderSummary {
  slug_id: string;
  name: string;
  auth_url?: string;
  issuer?: string;
}

export interface PersesFrontendConfig {
  security?: {
    enable_auth?: boolean;
    readonly?: boolean;
    authentication?: {
      disable_sign_up?: boolean;
      providers?: {
        enable_native?: boolean;
        oauth?: PersesAuthProviderSummary[];
        oidc?: PersesAuthProviderSummary[];
      };
    };
  };
  frontend?: {
    explorer?: { enable?: boolean };
    information?: string;
  };
}

export interface PersesPluginModuleResource {
  kind?: string;
  metadata?: {
    name?: string;
    version?: string;
  };
  spec?: {
    plugins?: Array<{
      kind?: string;
      spec?: {
        name?: string;
        display?: {
          name?: string;
          description?: string;
        };
      };
    }>;
  };
}

const CURRENT_USER_STORAGE_KEY = 'perses-current-user';

function decodeBase64UrlJson(segment: string): Record<string, unknown> | null {
  try {
    const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const jsonText = new TextDecoder().decode(bytes);
    const parsed = JSON.parse(jsonText) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function getCurrentPersesUsername(): string {
  if (typeof document !== 'undefined') {
    try {
      const cookies = document.cookie.split(';').map((c) => c.trim());
      const payloadCookie = cookies.find((c) => c.startsWith('jwtPayload='));
      if (payloadCookie) {
        const raw = decodeURIComponent(payloadCookie.slice('jwtPayload='.length)).replace(/^"|"$/g, '');
        const parts = raw.split('.');
        const candidate = parts.length >= 2 ? parts[1] : parts[0];
        const decoded = decodeBase64UrlJson(candidate);
        const sub = decoded?.sub ?? decoded?.preferred_username ?? decoded?.username ?? decoded?.name;
        if (typeof sub === 'string' && sub.trim()) {
          return sub.trim();
        }
      }
    } catch {
      // Ignore cookie parse errors and fall back to session cache
    }
  }
  try {
    const stored = window.sessionStorage.getItem(CURRENT_USER_STORAGE_KEY);
    if (stored && stored.trim()) {
      return stored.trim();
    }
  } catch {
    // Ignore storage read errors
  }
  return 'guest';
}

export function fetchPersesHealth(): Promise<PersesHealthResponse> {
  return apiGetJson<PersesHealthResponse>('/api/v1/health');
}

export function fetchPersesConfig(): Promise<PersesFrontendConfig> {
  return apiGetJson<PersesFrontendConfig>('/api/config');
}

export async function loginNative(login: string, password: string): Promise<void> {
  await fetchJson<void>('/api/auth/providers/native/login', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ login, password }),
  });
  try {
    window.sessionStorage.setItem(CURRENT_USER_STORAGE_KEY, login);
  } catch {
    // Ignore storage errors
  }
}

export async function logoutPerses(): Promise<void> {
  try {
    window.sessionStorage.removeItem(CURRENT_USER_STORAGE_KEY);
  } catch {
    // Ignore storage errors
  }
  await persesFetchFn('/api/auth/logout', {
    method: 'GET',
    credentials: 'include',
  });
}

export function fetchPersesPlugins(): Promise<PersesPluginModuleResource[]> {
  return apiGetJson<PersesPluginModuleResource[]>('/api/v1/plugins');
}
