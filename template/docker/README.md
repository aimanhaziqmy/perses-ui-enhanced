# Standalone Docker Template (`Perses + perses-ui-enhanced`)

Run **Perses** (`v0.55.1`) and **`perses-ui-enhanced`** (`v1.1.49`) locally in Docker / WSL without Kubernetes.

## Files

- `docker-compose.yml` — Runs `persesdev/perses:v0.55.1` + `perses-ui-enhanced:v1.1.49` on a shared `obs-net` bridge network.
- `config.yml` — Enables Perses native authentication (`enable_auth: true`, `enable_native: true`, `cookie.secure: false` for `http://localhost:8080`).
- `bootstrap.sh` — Generates `.env` (`PERSES_SECURITY_ENCRYPTION_KEY`), starts the stack, creates the initial `admin` user, and seeds the `admin` `GlobalRole` + `GlobalRoleBinding` in the `perses-data` volume.

## Quick Start

```bash
cd template/docker
chmod +x bootstrap.sh
./bootstrap.sh
```

Or pass credentials non-interactively:

```bash
ADMIN_USER=admin ADMIN_PASSWORD=your-password ./bootstrap.sh
```

Then open **`http://localhost:8080`** and sign in.

## Adding VictoriaMetrics / VictoriaLogs / VictoriaTraces Later

Attach any Victoria container to the same `obs-net` Docker network and add it directly in **Integrations → Data sources → + Add data source**:
- **VictoriaMetrics (`PrometheusDatasource`):** `http://victoriametrics:8428`
- **VictoriaLogs (`VictoriaLogsDatasource`):** `http://victorialogs:9428`
- **VictoriaTraces (`JaegerDatasource`):** `http://victoriatraces:10428/select/jaeger`
