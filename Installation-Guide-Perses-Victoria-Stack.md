# Step-by-Step Installation Guide: Perses + Victoria Stack on a Fresh Kubernetes Cluster

This guide walks through deploying the full observability stack (**Perses `0.55.1` + Enhanced React UI + VictoriaMetrics + VictoriaLogs + optional Jaeger v2**) on a fresh Kubernetes cluster, exposed on HTTPS port **`50555`** with **Keycloak OIDC** authentication.

---

## Prerequisites

- Kubernetes `1.26+` with a default `StorageClass`
- `kubectl` and Helm `3.12+`
- Container runtime CLI (`docker` or `nerdctl` + `ctr`) for building/importing the UI image
- Gateway API (`Gateway` + `ListenerSet` / TLS secret) if exposing HTTPS on port `50555` (e.g., Envoy Gateway)
- An existing **Keycloak** instance reachable from both your browser and the cluster

---

## Step 1: Clone the Repository & Build the UI Image

```bash
git clone https://github.com/aimanhaziqmy/perses-ui-enhanced.git
cd perses-ui-enhanced
```

Build the UI container image (`ui/Dockerfile`):

```bash
docker build -t perses-ui-enhanced:v1.1.26 ./ui
```

Push it to your container registry, or if deploying on a single-node / RKE2 cluster without an external registry, import it directly into containerd's `k8s.io` namespace:

```bash
docker save perses-ui-enhanced:v1.1.26 | sudo ctr --address /run/k3s/containerd/containerd.sock -n k8s.io images import -
```

---

## Step 2: Create Namespace & Install VictoriaLogs + Collector

Create the observability namespace:

```bash
kubectl create namespace observability
```

Install **VictoriaLogs Single**:

```bash
helm upgrade --install vl oci://ghcr.io/victoriametrics/helm-charts/victoria-logs-single \
  --namespace observability \
  --set server.persistentVolume.size=50Gi \
  --set server.retentionPeriod=14d
```

Install **VictoriaLogs Collector (`vlcollector`)** to collect pod logs, host kernel/syslog, and (optionally) Kubernetes API Server audit logs:

```bash
cat << 'EOF' > vlcollector-values.yaml
env:
  - name: HOSTNAME
    valueFrom:
      fieldRef:
        fieldPath: spec.nodeName

extraArgs:
  envflag.enable: true
  envflag.prefix: VL_
  fileCollector.checkpointsPath: /var/lib/vl-collector/file-checkpoints.json
  fileCollector.hostnameField: collector_pod
  fileCollector.msgField: requestURI,message,msg,log
  fileCollector.streamFields: stream,hostname,log_type
  loggerFormat: json
  tmpDataPath: /var/lib/vl-collector

fileCollector:
  - glob: /var/log/kern.log
    extraFields: '{"stream":"host_kernel","log_type":"kernel","host":"%{HOSTNAME}","hostname":"%{HOSTNAME}"}'
  - glob: /var/log/syslog
    extraFields: '{"stream":"host_syslog","log_type":"systemd","host":"%{HOSTNAME}","hostname":"%{HOSTNAME}"}'
  # Uncomment if your cluster writes Kubernetes API audit logs (e.g. RKE2):
  # - glob: /var/lib/rancher/rke2/server/logs/audit.log
  #   extraFields: '{"stream":"k8s_audit","log_type":"k8s_audit","host":"%{HOSTNAME}","hostname":"%{HOSTNAME}"}'

remoteWrite:
  - url: http://vl-victoria-logs-single-server.observability.svc.cluster.local:9428

tolerations:
  - effect: NoSchedule
    operator: Exists
EOF

helm upgrade --install vlcollector oci://ghcr.io/victoriametrics/helm-charts/victoria-logs-collector \
  --version 0.3.8 \
  --namespace observability \
  -f vlcollector-values.yaml
```

*(Optional)* Install **k8s-event-exporter** so Kubernetes cluster events appear under `stream:="k8s_events"`.

---

## Step 3: Create the Keycloak OIDC Client

In your Keycloak Admin Console (replace `<KEYCLOAK_URL>`, `<REALM>`, and `<LB_IP>`):

1. Go to **Clients → Create client**:
   - **Client type**: `OpenID Connect`
   - **Client ID**: `perses`
2. Enable **Client authentication** (Confidential) and **Standard flow** (`Authorization Code`).
3. Set **Valid redirect URIs**:
   ```text
   https://<LB_IP>:50555/api/auth/providers/oauth/keycloak/callback
   ```
4. Set **Web origins**:
   ```text
   https://<LB_IP>:50555
   ```
5. Copy the **Client Secret** from the **Credentials** tab.

---

## Step 4: Build Chart Dependencies & Deploy `perses-observability` on Port `50555`

Build the umbrella Helm dependencies:

```bash
cd helm/perses-observability
helm dependency build
```

Create `values-prod.yaml` (override all passwords, keys, and Keycloak URLs):

```yaml
persesAuth:
  encryptionKey: "<EXACTLY_32_CHAR_RANDOM_AES_KEY>"
  oidcClientId: "perses"
  oidcClientSecret: "<KEYCLOAK_CLIENT_SECRET>"
  nativeAdminUsername: "admin"
  nativeAdminPassword: "<STRONG_ADMIN_PASSWORD>"

observabilityUi:
  enabled: true
  image:
    repository: perses-ui-enhanced
    tag: "v1.1.26"
    pullPolicy: IfNotPresent
  listenerSet:
    enabled: true
    name: perses-ui
    sectionName: https-ui
    port: 50555
    gatewayName: external
    gatewayNamespace: gateway-system
    tlsSecretName: perses-ui-tls

# Optional: enable built-in Jaeger v2 (Apache 2.0) for Distributed Tracing
jaeger:
  enabled: false

perses:
  config:
    security:
      enable_auth: true
      authentication:
        disable_sign_up: false
        providers:
          enable_native: true
          oauth:
            - slug_id: "keycloak"
              name: "Keycloak"
              client_id: "perses"
              client_secret: "${PERSES_OIDC_CLIENT_SECRET}"
              auth_url: "https://<KEYCLOAK_URL>/realms/<REALM>/protocol/openid-connect/auth"
              token_url: "https://<KEYCLOAK_URL>/realms/<REALM>/protocol/openid-connect/token"
              user_infos_url: "https://<KEYCLOAK_URL>/realms/<REALM>/protocol/openid-connect/userinfo"
              redirect_uri: "https://<LB_IP>:50555/api/auth/providers/oauth/keycloak/callback"
              custom_login_property: "preferred_username"
      authorization:
        guest_permissions:
          - actions: ["read"]
            scopes: ["GlobalVariable"]
          # Optional: uncomment to grant all OIDC users read-only Viewer access automatically:
          # - actions: ["read"]
          #   scopes: ["Project", "Dashboard", "Datasource", "GlobalDatasource", "Variable"]
```

*(Note: If you expose the UI via standard `HTTPRoute` instead of `ListenerSet`, keep `listenerSet.enabled: false` and configure `observabilityUi.httpRoute`.)*

Deploy the release:

```bash
helm upgrade --install observability . \
  --namespace observability \
  -f values-prod.yaml
```

Verify all pods are running:

```bash
kubectl get pods -n observability
```

---

## Step 5: First Login & Add Data Sources in the UI

Open `https://<LB_IP>:50555` in your browser:

1. **Sign in as `admin`** (native break-glass account) using `persesAuth.nativeAdminPassword`.
2. Go to **Integrations → Data sources → + Add data source** and add your **Global** datasources:
   - **Metrics (`PrometheusDatasource`)**:
     - Endpoint: `http://observability-victoria-metrics-single-server.observability.svc.cluster.local:8428`
     - Click **Test** (`OK`).
   - **Logs (`VictoriaLogsDatasource`)**:
     - Endpoint: `http://vl-victoria-logs-single-server.observability.svc.cluster.local:9428`
     - Click **Test** (`OK`).
   - **Traces (`JaegerDatasource`, if `jaeger.enabled=true` or external Jaeger/VictoriaTraces)**:
     - Endpoint: `http://jaeger.observability.svc.cluster.local:16686`
     - Click **Test** (`OK`).
3. *(Optional)* Customize branding under **System → Site settings** (Name, Description, Logo).

---

## Step 6: Assign OIDC User Roles & Verify

1. Have a user sign in once via **Sign in with Keycloak** (Perses auto-creates their user record on first OIDC login).
2. As `admin`, go to **Organization → Users** and assign either:
   - A **Global Role** (`viewer` for read-only across all projects, `admin` for administrators), or
   - A **Project RoleBinding** (`viewer` on a specific workspace project).
3. Verify that **Viewer** users:
   - Can view **Dashboards** (read-only) and query **Explorer → Metrics**, **Explorer → Logs**, **Explorer → Traces**, and **Infrastructure → Hosts**.
   - Cannot see **Organization (`Users`, `Roles`)**, **Site settings**, or **Create / Edit / Delete** buttons.
4. *(Optional Portal Deep Link)*: Link from external portals using:
   ```text
   https://<LB_IP>:50555/dashboards?project=<workspace>&namespace=<k8s-namespace>
   ```
   This pre-selects `<workspace>` in Dashboards/Metrics and scopes Logs Explorer queries to `kubernetes.namespace_name:="<k8s-namespace>"`.
