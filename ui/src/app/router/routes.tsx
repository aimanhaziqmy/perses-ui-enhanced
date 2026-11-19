import { ErrorAlert, ErrorBoundary } from '@perses-dev/components';
import React, { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

import { ViewForbiddenState, ViewLoadingState } from '@/components/ui/ViewStates';
import type { PersesFrontendConfig, PersesHealthResponse } from '@/lib/api/auth';
import type { SiteBrandingConfig } from '@/lib/api/branding';
import type { UiCapabilities } from '@/lib/api/rbac';
import type { RoleViewPermissionsConfig } from '@/lib/api/viewPermissions';

const DashboardsView = lazy(() =>
  import('@/features/dashboards/DashboardsView').then((m) => ({ default: m.DashboardsView })),
);
const ExploreView = lazy(() =>
  import('@/features/metrics-explore/ExploreView').then((m) => ({ default: m.ExploreView })),
);
const LogsExplorerView = lazy(() =>
  import('@/features/logs/LogsExplorerView').then((m) => ({ default: m.LogsExplorerView })),
);
const TracesExplorerView = lazy(() =>
  import('@/features/traces/TracesExplorerView').then((m) => ({ default: m.TracesExplorerView })),
);
const HostsView = lazy(() =>
  import('@/features/hosts/HostsView').then((m) => ({ default: m.HostsView })),
);
const AlertRulesView = lazy(() =>
  import('@/features/alerts/AlertRulesView').then((m) => ({ default: m.AlertRulesView })),
);
const DatasourcesView = lazy(() =>
  import('@/features/datasources/DatasourcesView').then((m) => ({ default: m.DatasourcesView })),
);
const UsersView = lazy(() =>
  import('@/features/users/UsersView').then((m) => ({ default: m.UsersView })),
);
const RolesView = lazy(() =>
  import('@/features/roles/RolesView').then((m) => ({ default: m.RolesView })),
);
const SiteSettingsView = lazy(() =>
  import('@/features/site-settings/SiteSettingsView').then((m) => ({ default: m.SiteSettingsView })),
);
const SystemAboutView = lazy(() =>
  import('@/features/site-settings/SystemAboutView').then((m) => ({ default: m.SystemAboutView })),
);

export function RouteView({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary FallbackComponent={ErrorAlert}>
      <Suspense fallback={<ViewLoadingState message="Loading view..." minHeight={320} />}>
        {children}
      </Suspense>
    </ErrorBoundary>
  );
}

export function EmbedDashboardRoute({
  isFullscreen,
  onToggleFullscreen,
}: {
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
}) {
  return (
    <RouteView>
      <DashboardsView isEmbed={true} isFullscreen={isFullscreen} onToggleFullscreen={onToggleFullscreen} />
    </RouteView>
  );
}

export interface AppRoutesProps {
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  workspaceContext: { project: string; namespace: string };
  logsInitialQuery: string;
  isNamespaceScoped: boolean;
  isSiteAdmin: boolean;
  loadingPermissions: boolean;
  capabilities: UiCapabilities;
  branding: SiteBrandingConfig;
  onSaveBranding: (next: SiteBrandingConfig) => Promise<void>;
  roleViewPermissions: RoleViewPermissionsConfig;
  onSaveRolePermissions: (next: RoleViewPermissionsConfig) => Promise<void>;
  health: PersesHealthResponse | undefined;
  config: PersesFrontendConfig | undefined;
  defaultAllowedPath: string;
  onNavigate: (path: string) => void;
}

export function AppRoutes({
  isFullscreen,
  onToggleFullscreen,
  workspaceContext,
  logsInitialQuery,
  isNamespaceScoped,
  isSiteAdmin,
  loadingPermissions,
  capabilities,
  branding,
  onSaveBranding,
  roleViewPermissions,
  onSaveRolePermissions,
  health,
  config,
  defaultAllowedPath,
  onNavigate,
}: AppRoutesProps) {
  return (
    <Routes>
      <Route
        path="/dashboards/*"
        element={
          <RouteView>
            <DashboardsView
              isEmbed={false}
              isFullscreen={isFullscreen}
              onToggleFullscreen={onToggleFullscreen}
              defaultProject={workspaceContext.project || undefined}
              canCreateProject={capabilities.canCreateProject}
              canDeleteProject={capabilities.canDeleteProject}
              canManageDashboards={capabilities.canManageDashboards}
            />
          </RouteView>
        }
      />
      <Route
        path="/explore/metrics/*"
        element={
          <RouteView>
            <ExploreView defaultProject={workspaceContext.project || undefined} />
          </RouteView>
        }
      />
      <Route
        path="/explore/logs/*"
        element={
          <RouteView>
            <LogsExplorerView
              initialQuery={logsInitialQuery}
              lockedNamespace={workspaceContext.namespace || undefined}
            />
          </RouteView>
        }
      />
      <Route
        path="/explore/traces/*"
        element={
          <RouteView>
            <TracesExplorerView />
          </RouteView>
        }
      />
      <Route
        path="/explore/*"
        element={
          <RouteView>
            <ExploreView />
          </RouteView>
        }
      />
      <Route
        path="/hosts/*"
        element={
          <RouteView>
            {isNamespaceScoped ? (
              <ViewForbiddenState
                description="Cluster-wide host infrastructure is restricted to site administrators."
                onBack={() => onNavigate('/dashboards')}
              />
            ) : (
              <HostsView />
            )}
          </RouteView>
        }
      />
      <Route
        path="/alerts/*"
        element={
          <RouteView>
            <AlertRulesView defaultSubTab="rules" canEdit={capabilities.canManageAlertRules} />
          </RouteView>
        }
      />
      <Route
        path="/events/*"
        element={
          <RouteView>
            <AlertRulesView defaultSubTab="events" canEdit={capabilities.canManageAlertRules} />
          </RouteView>
        }
      />
      <Route
        path="/datasources/*"
        element={
          <RouteView>
            {isNamespaceScoped ? (
              <ViewForbiddenState
                description="Cluster data source endpoints are restricted to site administrators."
                onBack={() => onNavigate('/dashboards')}
              />
            ) : (
              <DatasourcesView canManage={capabilities.canManageDatasources} />
            )}
          </RouteView>
        }
      />
      <Route
        path="/users/*"
        element={
          <RouteView>
            {loadingPermissions ? (
              <ViewLoadingState message="Checking permissions..." />
            ) : !capabilities.canManageUsers ? (
              <ViewForbiddenState
                description="Administrator permissions are required to manage users."
                onBack={() => onNavigate('/dashboards')}
              />
            ) : (
              <UsersView />
            )}
          </RouteView>
        }
      />
      <Route
        path="/roles/*"
        element={
          <RouteView>
            {loadingPermissions ? (
              <ViewLoadingState message="Checking permissions..." />
            ) : !capabilities.canManageUsers ? (
              <ViewForbiddenState
                description="Administrator permissions are required to manage roles."
                onBack={() => onNavigate('/dashboards')}
              />
            ) : (
              <RolesView />
            )}
          </RouteView>
        }
      />
      <Route
        path="/settings/*"
        element={
          <RouteView>
            {loadingPermissions ? (
              <ViewLoadingState message="Checking permissions..." />
            ) : !isSiteAdmin ? (
              <ViewForbiddenState
                description="Only site administrators can access Site settings."
                onBack={() => onNavigate('/dashboards')}
              />
            ) : (
              <SiteSettingsView
                branding={branding}
                onSaveBranding={onSaveBranding}
                rolePermissions={roleViewPermissions}
                onSaveRolePermissions={onSaveRolePermissions}
                canEdit={isSiteAdmin}
              />
            )}
          </RouteView>
        }
      />
      <Route
        path="/about/*"
        element={
          <RouteView>
            <SystemAboutView health={health} config={config} />
          </RouteView>
        }
      />
      <Route path="*" element={<Navigate to={defaultAllowedPath} replace />} />
    </Routes>
  );
}
