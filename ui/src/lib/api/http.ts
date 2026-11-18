import type { GlobalVariableResource } from '@perses-dev/client';
import { buildProxyUrl } from '@perses-dev/client';

import { rewriteProxyRequestForNamespaces } from '@/lib/api/workspace';

export class UnauthorizedError extends Error {
  readonly status = 401;
  constructor(message = 'Authentication required') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends Error {
  readonly status = 403;
  constructor(message = 'Permission denied (403 Forbidden)') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

const nativeFetch = globalThis.fetch.bind(globalThis);
let refreshInFlight: Promise<boolean> | null = null;
let proxyInterceptorInstalled = false;

export function installGlobalProxyFetchInterceptor(): void {
  if (proxyInterceptorInstalled || typeof globalThis.fetch !== 'function') return;
  proxyInterceptorInstalled = true;
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const { input: scopedInput, init: scopedInit } = rewriteProxyRequestForNamespaces(input, init);
    return nativeFetch(scopedInput, scopedInit);
  };
}

export async function refreshAuthSession(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = nativeFetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    })
      .then((res) => res.ok)
      .catch(() => false)
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

export async function persesFetchFn(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const { input: scopedInput, init: scopedInit } = rewriteProxyRequestForNamespaces(input, init);
  const urlStr =
    typeof scopedInput === 'string'
      ? scopedInput
      : scopedInput instanceof URL
        ? scopedInput.toString()
        : scopedInput.url;
  const retryRequest = scopedInput instanceof Request ? scopedInput.clone() : null;
  const res = await nativeFetch(scopedInput, scopedInit);
  if (res.status === 401 && !urlStr.includes('/api/auth/')) {
    const refreshed = await refreshAuthSession();
    if (refreshed) {
      return nativeFetch(retryRequest ?? scopedInput, scopedInit);
    }
  }
  return res;
}

export async function throwForBadResponse(res: Response, url: string): Promise<never> {
  if (res.status === 401) {
    throw new UnauthorizedError('Perses session expired or unauthenticated');
  }
  const body = await res.text();
  if (res.status === 403) {
    throw new ForbiddenError(`Permission denied (403): ${body || 'Your role lacks permission for this action.'}`);
  }
  throw new Error(`HTTP ${res.status} from ${url}: ${body || res.statusText}`);
}

export async function apiGetJson<T>(url: string, options?: { signal?: AbortSignal }): Promise<T> {
  const res = await persesFetchFn(url, {
    method: 'GET',
    credentials: 'include',
    signal: options?.signal,
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    await throwForBadResponse(res, url);
  }
  return (await res.json()) as T;
}

export async function apiSendJson<T>(url: string, method: 'POST' | 'PUT', payload: unknown): Promise<T> {
  const res = await persesFetchFn(url, {
    method,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    await throwForBadResponse(res, url);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export async function apiDelete(url: string): Promise<void> {
  const res = await persesFetchFn(url, {
    method: 'DELETE',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    await throwForBadResponse(res, url);
  }
}

export interface DatasourceTargetRef {
  scope: 'global' | 'project';
  project?: string;
  name: string;
}

export function toProxyBasePath(target: DatasourceTargetRef | string): string {
  if (typeof target === 'string') {
    return buildProxyUrl({ name: target });
  }
  return buildProxyUrl({
    project: target.scope === 'project' ? target.project : undefined,
    name: target.name,
  });
}

export async function fetchGlobalJsonConfig<T>(
  varName: string,
  storageKey: string,
  normalize: (raw: unknown) => T,
  fallback: T,
  options?: { allowUnauthorizedFallback?: boolean },
): Promise<T> {
  let localVal = fallback;
  try {
    const rawLocal = window.localStorage.getItem(storageKey);
    if (rawLocal) {
      localVal = normalize(JSON.parse(rawLocal));
    }
  } catch {
    localVal = fallback;
  }

  const endpoint = `/api/v1/globalvariables/${encodeURIComponent(varName)}`;
  const res = await persesFetchFn(endpoint, {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  if (res.status === 404) {
    return localVal;
  }
  if (res.status === 401 && options?.allowUnauthorizedFallback) {
    return localVal;
  }
  if (!res.ok) {
    await throwForBadResponse(res, endpoint);
  }
  const payload = (await res.json()) as GlobalVariableResource;
  const rawValue = payload?.spec?.kind === 'TextVariable' ? payload.spec.spec?.value : undefined;
  if (!rawValue) return localVal;
  const normalized = normalize(JSON.parse(rawValue));
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(normalized));
  } catch {
    // Ignore storage quota errors
  }
  return normalized;
}

export async function saveGlobalJsonConfig<T>(
  varName: string,
  storageKey: string,
  value: T,
  displayName: string,
  description: string,
): Promise<T> {
  const resource: GlobalVariableResource = {
    kind: 'GlobalVariable',
    metadata: { name: varName },
    spec: {
      kind: 'TextVariable',
      spec: {
        name: varName,
        value: JSON.stringify(value),
        constant: true,
        display: {
          name: displayName,
          description,
          hidden: true,
        },
      },
    },
  };

  const putRes = await persesFetchFn(`/api/v1/globalvariables/${encodeURIComponent(varName)}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(resource),
  });

  if (putRes.status === 404) {
    const postRes = await persesFetchFn('/api/v1/globalvariables', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(resource),
    });
    if (!postRes.ok) {
      await throwForBadResponse(postRes, '/api/v1/globalvariables');
    }
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      // Ignore storage quota errors
    }
    return value;
  }

  if (!putRes.ok) {
    await throwForBadResponse(putRes, `/api/v1/globalvariables/${varName}`);
  }

  try {
    window.localStorage.setItem(storageKey, JSON.stringify(value));
  } catch {
    // Ignore storage quota errors
  }

  return value;
}
