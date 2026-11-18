import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';

import { installGlobalProxyFetchInterceptor } from '@/lib/api/http';
import { readStoredThemeMode, THEME_STORAGE_KEY, type ThemeMode } from '@/theme/persesTheme';
import { App } from './App';
import { registerPersesHostModules } from './perses/interop';
import { AppProviders } from './providers/AppProviders';

installGlobalProxyFetchInterceptor();
registerPersesHostModules();

function RootApp() {
  const [themeMode, setThemeMode] = useState<ThemeMode>(readStoredThemeMode);

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
    <AppProviders themeMode={themeMode}>
      <App themeMode={themeMode} onToggleTheme={toggleTheme} />
    </AppProviders>
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
