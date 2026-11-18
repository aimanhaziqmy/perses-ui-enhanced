import { CssBaseline, ThemeProvider } from '@mui/material';
import { FetchProvider } from '@perses-dev/client';
import { ChartsProvider, ErrorAlert, ErrorBoundary, SnackbarProvider } from '@perses-dev/components';
import { HotkeysProvider } from '@perses-dev/dashboards';
import { PluginRegistry, ValidationProvider } from '@perses-dev/plugin-system';
import { QueryClientProvider } from '@tanstack/react-query';
import React, { useMemo } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { QueryParamProvider } from 'use-query-params';
import { ReactRouter6Adapter } from 'use-query-params/adapters/react-router-6';

import { persesFetchFn } from '@/lib/api/http';
import { createPersesChartsTheme, createPersesTheme, type ThemeMode } from '@/theme/persesTheme';
import { pluginLoader } from '../perses/plugin-registry';
import { queryClient } from './query-client';

export function AppProviders({
  themeMode,
  children,
}: {
  themeMode: ThemeMode;
  children: React.ReactNode;
}) {
  const muiTheme = useMemo(() => createPersesTheme(themeMode), [themeMode]);
  const chartsTheme = useMemo(() => createPersesChartsTheme(muiTheme, themeMode), [muiTheme, themeMode]);

  return (
    <ErrorBoundary FallbackComponent={ErrorAlert}>
      <BrowserRouter>
        <FetchProvider fetchFn={persesFetchFn}>
          <QueryClientProvider client={queryClient}>
            <QueryParamProvider adapter={ReactRouter6Adapter}>
              <ThemeProvider theme={muiTheme}>
                <CssBaseline enableColorScheme={true} />
                <ChartsProvider chartsTheme={chartsTheme} enablePinning={true}>
                  <SnackbarProvider anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}>
                    <HotkeysProvider>
                      <PluginRegistry
                        pluginLoader={pluginLoader}
                        defaultPluginKinds={{
                          Panel: 'TimeSeriesChart',
                          TimeSeriesQuery: 'PrometheusTimeSeriesQuery',
                        }}
                      >
                        <ValidationProvider>{children}</ValidationProvider>
                      </PluginRegistry>
                    </HotkeysProvider>
                  </SnackbarProvider>
                </ChartsProvider>
              </ThemeProvider>
            </QueryParamProvider>
          </QueryClientProvider>
        </FetchProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
