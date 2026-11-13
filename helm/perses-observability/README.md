# perses-observability Umbrella Helm Chart

Turnkey Kubernetes Helm chart bundling the complete **Perses + VictoriaMetrics + VictoriaLogs + perses-ui-enhanced** observability stack.

## Included Components

| Component | Chart / Image | Role |
| :--- | :--- | :--- |
| **VictoriaLogs Single** | `victoriametrics/victoria-logs` | Log database, LogsQL query engine & VMUI |
| **VictoriaLogs Collector** | `victoriametrics/vlagent` DaemonSet | Kubernetes pod logs & host kernel/syslog collection |
| **Kubernetes Event Exporter** | `ghcr.io/resmoio/kubernetes-event-exporter` | Streams Kubernetes cluster lifecycle events into VictoriaLogs |
| **VictoriaMetrics Single** | `victoria-metrics-single` (`0.51.0`) | Time-series metrics DB & PromQL scraper (`node-exporter`, `kube-state-metrics`, `dcgm-exporter`, `cAdvisor`) |
| **Perses Backend** | `perses` (`0.24.0`, app `v0.55.1`) | Untouched upstream Go backend with auth, RBAC, dashboards & plugin serving |
| **Enhanced UI Shell** | `perses-ui-enhanced` | Custom React UI reverse-proxying `/api`, `/proxy`, and `/plugins` to Perses |
| **Optional `vmauth` & `oauth2-proxy`** | Disabled by default | Multi-tenant LogQL proxy & OIDC reverse-proxy gate |

---

## Installation

### 1. Build Subchart Dependencies
```bash
helm dependency build .
```

### 2. Validate Before Deploying
```bash
helm lint .
helm template observability . -n observability > /dev/null
```

### 3. Install / Upgrade
```bash
helm upgrade --install observability . \
  --namespace observability \
  --create-namespace \
  --set persesAuth.nativeAdminPassword="replace-with-strong-password" \
  --set persesAuth.encryptionKey="replace-with-32-byte-secret-key!!"
```

If serving behind HTTPS/TLS (for example via Gateway API `HTTPRoute`), enable `perses.config.security.cookie.secure: true` and `observabilityUi.httpRoute.enabled: true`:

```bash
helm upgrade --install observability . \
  --namespace observability \
  --set perses.config.security.cookie.secure=true \
  --set observabilityUi.httpRoute.enabled=true \
  --set observabilityUi.httpRoute.hostname="perses.example.com" \
  --set observabilityUi.httpRoute.parentGateway.name="main-gateway" \
  --set observabilityUi.httpRoute.parentGateway.namespace="gateway-system"
```

---

## Key Configuration Values

| Parameter | Default | Description |
| :--- | :--- | :--- |
| `victoriaLogs.enabled` | `true` | Deploy VictoriaLogs StatefulSet (`false` uses `victoriaLogs.serviceUrl`) |
| `victoriaLogs.persistence.storageClassName` | `""` | StorageClass for VictoriaLogs PVC (`""` = cluster default) |
| `subcharts.victoriaMetricsEnabled` | `true` | Deploy `victoria-metrics-single` subchart |
| `victoriaMetrics.server.persistentVolume.storageClassName` | `""` | StorageClass for VictoriaMetrics PVC (`""` = cluster default) |
| `subcharts.persesEnabled` | `true` | Deploy upstream `perses` Go backend subchart |
| `perses.persistence.storageClass` | unset | StorageClass for Perses PVC (omitted = cluster default; set explicitly if needed) |
| `persesAuth.encryptionKey` | `ChangeMe...` | 32-byte AES-256 encryption key for Perses tokens |
| `persesAuth.nativeAdminPassword` | `changeme` | Provisioned native `admin` user password |
| `perses.config.security.cookie.secure` | `false` | Set to `true` when exposed over HTTPS |
| `observabilityUi.enabled` | `true` | Deploy `perses-ui-enhanced` frontend container |
| `observabilityUi.image.repository` | `ghcr.io/aimanhaziqmy/perses-ui-enhanced` | Custom UI container image repository |
| `observabilityUi.httpRoute.enabled` | `false` | Create Gateway API `HTTPRoute` for the UI |
