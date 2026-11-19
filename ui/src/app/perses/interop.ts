import * as PersesClient from '@perses-dev/client';
import * as PersesComponents from '@perses-dev/components';
import * as PersesDashboards from '@perses-dev/dashboards';
import * as PersesExplore from '@perses-dev/explore';
import * as PersesPluginSystem from '@perses-dev/plugin-system';
import { registerHostSharedModules } from '@perses-dev/plugin-system';
import * as PersesSpec from '@perses-dev/spec';

import { toWebpackEsmModule } from './federation-chunk';

export { toWebpackEsmModule };

export function registerPersesHostModules(): void {
  // Register host singletons for Perses remote Module Federation plugins (v0.55.1 pattern)
  registerHostSharedModules({
    '@perses-dev/spec': toWebpackEsmModule(PersesSpec),
    '@perses-dev/client': toWebpackEsmModule(PersesClient),
    '@perses-dev/components': toWebpackEsmModule(PersesComponents),
    '@perses-dev/plugin-system': toWebpackEsmModule(PersesPluginSystem),
    '@perses-dev/explore': toWebpackEsmModule(PersesExplore),
    '@perses-dev/dashboards': toWebpackEsmModule(PersesDashboards),
  });
}
