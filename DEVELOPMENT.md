# Developer & Maintainer Guide (`perses-ui-enhanced`)

This guide is for human engineers and AI agents modifying the **React/Nginx UI** (`ui/`) or the **Helm umbrella chart** (`helm/perses-observability/`).

---

## 1. Repository Layout

```text
.
├── ui/
│   ├── Dockerfile            # Multi-stage Node 24 build -> nginx-unprivileged:1.27-alpine + ngx_http_js_module
│   ├── .dockerignore         # Excludes node_modules and dist from Docker build context
│   ├── nginx.conf            # Gateway routing, auth gate, and JSON audit logging
│   ├── njs/audit.js          # Nginx njs actor extraction (X-Forwarded-User / jwtPayload / Bearer)
│   └── src/
│       ├── api/              # Modular API clients (http, auth, workspace, logs, metrics, traces, alerts, etc.)
│       ├── components/       # Shared UI components (ViewStates, EChart, LogDetailDrawer, BackendAlertsPanel)
│       ├── views/            # Route-level lazy views
│       └── App.tsx           # Routes & ErrorBoundary
├── helm/
│   ├── perses-observability/ # Main open-source Helm umbrella chart (Perses + VictoriaLogs + VictoriaMetrics + vmalert + Alertmanager)
│   └── vlcollector/          # Standalone VictoriaLogs DaemonSet collector values
├── README.md
└── Installation-Guide-Perses-Victoria-Stack.md
```

---

## 2. Architecture & Security Boundaries (ISO 27001 A.8.15 Ready)

Request and data flow:

1. **Browser → Nginx (`observability-ui`, `:8080`)**
   - Serves the React SPA (`dist/`).
   - Loads `ngx_http_js_module.so` + `/etc/nginx/njs/audit.js` to extract `$audit_actor` and `$is_authenticated`.
   - Blocks unauthenticated calls to `/api/v1/*` and `/proxy/*` with `401` (except `/api/v1/health` and `GET /api/v1/globalvariables/perses-ui-site-settings` for login-screen branding).
   - Emits structured `perses_audit` JSON logs to `/dev/stdout` for all mutations (`POST`/`PUT`/`PATCH`/`DELETE`), logouts (`GET /api/auth/logout`), and LogsQL queries/exports (`GET /proxy/.*/select/logsql/`).

2. **Nginx → Stock Perses (`v0.55.1`, `:8080`)**
   - Perses runs **unmodified** (`persesdev/perses:v0.55.1`) for clean upstream upgrades.
   - Handles authentication (native + OIDC/OAuth2), `GlobalRole` RBAC, dashboards, projects, and datasource HTTP proxying.
   - `disable_sign_up: true` prevents self-registration; `guest_permissions` grants authenticated OIDC users default Viewer read access.

3. **Perses → `vmauth` (`:8427`) → VictoriaLogs (`:9428`)**
   - Perses queries VictoriaLogs through `vmauth` using a provisioned `GlobalSecret` (`vmauth-perses-secret`) for `perses-readonly`.
   - `vmauth` explicitly denies `/delete.*`, `/internal/.*`, and `/insert.*` on query paths.
   - `NetworkPolicy` (`victorialogs-ingress-lockdown`) restricts direct ingress on VictoriaLogs `:9428` to `vlcollector`, `k8s-event-exporter`, `vmauth`, `victoria-metrics`/`victoriaMetrics`, and (when enabled) `victorialogs-archive`.

4. **Collection, Retention & Alerting**
   - `vlcollector` collects Kubernetes pod stdout/stderr plus host `/var/log/kern.log`, `/var/log/syslog`, `/var/log/auth.log`, `/var/log/secure` (and optional `collector.k8sAudit`).
   - `victoriaLogs.retentionPeriod` defaults to `90d` (with optional S3 / Object-Lock WORM archiving via `victoriaLogs.archive.enabled`).
   - `vmalert` + `Alertmanager` evaluate ISO 27001 pipeline/security rules (`LogIngestionStopped`, `VictoriaLogsDown`, `PersesBackendDown`, `ClockDriftHigh`, `HostRootDiskHighUsage`) 24/7.

---

## 3. Rules & Guardrails for Edits

1. **Keep it vendor-neutral & license-safe:**
   - Only Apache 2.0 / MIT compatible dependencies.
   - Never hardcode company names, internal IPs, or proprietary domains in `ui/`, `helm/perses-observability/`, or docs.
   - Keep Kubernetes-specific features (such as `observabilityUi.workspaceIsolation`) optional so standalone Docker / bare-host deployments continue to work.

2. **Keep `ui/nginx.conf` and Helm Nginx ConfigMaps in sync:**
   - Whenever you change routing, `log_format perses_audit`, or `njs` directives in `ui/nginx.conf`, apply the exact same change to `helm/perses-observability/templates/observability-ui-nginx-configmap.yaml`.
   - Note that Helm mounts `default.conf` from the ConfigMap, while `load_module modules/ngx_http_js_module.so;` and `/etc/nginx/njs/audit.js` live inside the `observability-ui` container image (`ui/Dockerfile`). Rebuild the image whenever `ui/njs/` or `ui/Dockerfile` changes.

3. **Perses `HTTPProxy` + `GlobalSecret`:**
   - Stock Perses `v0.55.1` strips inline `Authorization` headers from `HTTPProxy.spec.headers` and logs `"This is not allowed and will be ignored. Use Secret object to set Authorization header."`
   - Always configure datasource auth via a Perses `GlobalSecret` (`basicAuth`, `bearerToken`, etc.) referenced by `"secret": "<secret-name>"` in `HTTPProxy.spec`.

4. **Helm Template Nil-Safety & Upgrades:**
   - Guard new nested `values.yaml` keys with nil-safe checks (e.g., `{{- if and .Values.feature .Values.feature.enabled }}`) so `helm upgrade --reuse-values` never panics on older releases.
   - When upgrading a release after adding new top-level sections to `values.yaml`, use `helm upgrade --reset-then-reuse-values` so new defaults merge with existing `--set` overrides.

5. **NetworkPolicy Pod Labels:**
   - `vmauth` pods use `app.kubernetes.io/name: victoria-metrics-auth`. Do not confuse this with `victoria-metrics` / `victoriaMetrics`.

6. **Pinned Versions & Secrets:**
   - Never use `:latest` image tags in Helm `values.yaml` or `Dockerfile`.
   - Never commit plaintext production credentials; use `vmauth.existingSecret`, `persesAuth.existingSecret`, `oauth2Proxy.caSecretName`, and `victoriaLogs.archive.existingSecret`.

---

## 4. Local Validation Commands

### UI Type-Check & Build
```bash
cd ui
npm install
npm run build   # runs: tsc --noEmit && vite build
```

### Nginx + `njs` Syntax Validation
```bash
docker run --rm --add-host perses.observability.svc.cluster.local:127.0.0.1 \
  --entrypoint sh \
  -v "$(pwd)/ui/nginx.conf:/etc/nginx/conf.d/default.conf:ro" \
  -v "$(pwd)/ui/njs/audit.js:/etc/nginx/njs/audit.js:ro" \
  nginxinc/nginx-unprivileged:1.27-alpine \
  -c "cp /etc/nginx/nginx.conf /tmp/nginx.conf && sed -i '1i load_module modules/ngx_http_js_module.so;' /tmp/nginx.conf && nginx -t -c /tmp/nginx.conf"
```

### Docker Image Build
```bash
docker build -t perses-ui-enhanced:dev ./ui
```

### Helm Chart Lint & Template Rendering
```bash
helm lint ./helm/perses-observability

# Render with optional features enabled to verify all conditional templates:
helm template test-release ./helm/perses-observability \
  --set collector.k8sAudit.enabled=true \
  --set victoriaLogs.archive.enabled=true \
  --set victoriaLogs.archive.s3Bucket=audit-worm \
  --set oauth2Proxy.enabled=true \
  --set oauth2Proxy.caSecretName=oidc-ca \
  --set vmauth.existingSecret=custom-vmauth \
  --set persesAuth.existingSecret=custom-perses-auth > /dev/null
```
