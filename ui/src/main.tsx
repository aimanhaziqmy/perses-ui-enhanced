import { CssBaseline, ThemeProvider } from '@mui/material';
import * as PersesClient from '@perses-dev/client';
import * as PersesComponents from '@perses-dev/components';
import { ChartsProvider, SnackbarProvider } from '@perses-dev/components';
import * as PersesDashboards from '@perses-dev/dashboards';
import { HotkeysProvider } from '@perses-dev/dashboards';
import * as PersesExplore from '@perses-dev/explore';
import * as PersesPluginSystem from '@perses-dev/plugin-system';
import { registerHostSharedModules } from '@perses-dev/plugin-system';
import * as PersesSpec from '@perses-dev/spec';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React, { useMemo, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryParamProvider } from 'use-query-params';
import { ReactRouter6Adapter } from 'use-query-params/adapters/react-router-6';

import { App } from './App';
import { refreshAuthSession } from './api/persesClient';
import type { ThemeMode } from './theme/persesTheme';
import {
  THEME_STORAGE_KEY,
  createPersesChartsTheme,
  createPersesTheme,
  readStoredThemeMode,
} from './theme/persesTheme';

function toWebpackEsmModule<T extends object>(mod: T): T {
  if (Object.prototype.hasOwnProperty.call(mod, '__esModule')) {
    return mod;
  }
  const cloned = Object.create(null) as Record<PropertyKey, unknown>;
  for (const key of Reflect.ownKeys(mod)) {
    if (key === '__esModule') continue;
    const desc = Object.getOwnPropertyDescriptor(mod, key);
    if (desc) {
      Object.defineProperty(cloned, key, desc);
    }
  }
  Object.defineProperty(cloned, '__esModule', {
    value: true,
    enumerable: false,
    configurable: false,
  });
  return cloned as T;
}

// Register host singletons for Perses remote Module Federation plugins (v0.55.1 pattern)
registerHostSharedModules({
  '@perses-dev/spec': toWebpackEsmModule(PersesSpec),
  '@perses-dev/client': toWebpackEsmModule(PersesClient),
  '@perses-dev/components': toWebpackEsmModule(PersesComponents),
  '@perses-dev/plugin-system': toWebpackEsmModule(PersesPluginSystem),
  '@perses-dev/explore': toWebpackEsmModule(PersesExplore),
  '@perses-dev/dashboards': toWebpackEsmModule(PersesDashboards),
});

// Transparent JWT access token refresh on 401
const originalFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const res = await originalFetch(input, init);
  const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  if (res.status === 401 && !urlStr.includes('/api/auth/')) {
    const refreshed = await refreshAuthSession();
    if (refreshed) {
      return originalFetch(input, init);
    }
  }
  return res;
};

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 0,
      keepPreviousData: true,
    },
  },
});

function RootApp() {
  const [themeMode, setThemeMode] = useState<ThemeMode>(readStoredThemeMode);

  const muiTheme = useMemo(() => createPersesTheme(themeMode), [themeMode]);
  const chartsTheme = useMemo(() => createPersesChartsTheme(muiTheme, themeMode), [muiTheme, themeMode]);

  const toggleTheme = () => {
    setThemeMode((prev) => {
      const next: ThemeMode = prev === 'light' ? 'dark' : 'light';
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {
        // Ignore storage write errors
      }
      return next;
    });
  };

  return (
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <QueryParamProvider adapter={ReactRouter6Adapter}>
          <ThemeProvider theme={muiTheme}>
            <CssBaseline enableColorScheme={true} />
            <ChartsProvider chartsTheme={chartsTheme} enablePinning={true}>
              <SnackbarProvider anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}>
                <HotkeysProvider>
                  <App themeMode={themeMode} onToggleTheme={toggleTheme} />
                </HotkeysProvider>
              </SnackbarProvider>
            </ChartsProvider>
          </ThemeProvider>
        </QueryParamProvider>
      </QueryClientProvider>
    </BrowserRouter>
  );
}

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Root mount element #root not found');
}

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <RootApp />
  </React.StrictMode>,
);
