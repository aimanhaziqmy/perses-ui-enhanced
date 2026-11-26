#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

ADMIN_USER="${ADMIN_USER:-admin}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"

# 1. Generate .env with a 32-char encryption key if missing
if [ ! -f .env ]; then
  if command -v openssl >/dev/null 2>&1; then
    ENC_KEY="$(openssl rand -hex 16)"
  else
    ENC_KEY="$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  fi
  printf 'PERSES_SECURITY_ENCRYPTION_KEY=%s\n' "$ENC_KEY" > .env
  chmod 600 .env
  echo "Generated .env with PERSES_SECURITY_ENCRYPTION_KEY."
fi

# 2. Prompt for initial admin password if not provided
if [ -z "$ADMIN_PASSWORD" ]; then
  read -rsp "Enter initial password for Perses user '$ADMIN_USER': " ADMIN_PASSWORD
  echo ""
  if [ -z "$ADMIN_PASSWORD" ]; then
    echo "Error: password cannot be empty." >&2
    exit 1
  fi
fi

# 3. Start Perses + perses-ui-enhanced
docker compose up -d --build

# 4. Wait for Perses API to become reachable on obs-net
echo "Waiting for Perses to be ready..."
for i in $(seq 1 30); do
  if docker exec perses-ui-enhanced wget -qO- http://perses:8080/api/v1/health >/dev/null 2>&1; then
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "Error: Perses did not become ready in time." >&2
    exit 1
  fi
  sleep 2
done

# 5. Create initial admin user (ignore if already created)
PAYLOAD=$(printf '{"kind":"User","metadata":{"name":"%s"},"spec":{"nativeProvider":{"password":"%s"}}}' "$ADMIN_USER" "$ADMIN_PASSWORD")
if docker exec perses-ui-enhanced wget -qO- --header="Content-Type: application/json" --post-data="$PAYLOAD" http://perses:8080/api/v1/users >/dev/null 2>&1; then
  echo "Created Perses user '$ADMIN_USER'."
else
  echo "User '$ADMIN_USER' already exists or could not be created via /api/v1/users; continuing..."
fi

# 6. Seed admin GlobalRole + GlobalRoleBinding into the perses-data volume
VOLUME_NAME="$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/perses"}}{{.Name}}{{end}}{{end}}' perses)"
if [ -z "$VOLUME_NAME" ]; then
  echo "Error: could not locate /perses volume on container 'perses'." >&2
  exit 1
fi

docker run --rm -e ADMIN_USER="$ADMIN_USER" -v "${VOLUME_NAME}:/perses" alpine:3.20 sh -c '
set -eu
mkdir -p /perses/globalroles /perses/globalrolebindings
cat <<EOF > /perses/globalroles/admin.json
{"kind":"GlobalRole","metadata":{"name":"admin"},"spec":{"permissions":[{"actions":["*"],"scopes":["*"]}]}}
EOF
cat <<EOF > /perses/globalrolebindings/admin.json
{"kind":"GlobalRoleBinding","metadata":{"name":"admin"},"spec":{"role":"admin","subjects":[{"kind":"User","name":"'"$ADMIN_USER"'"}]}}
EOF
'

# 7. Restart Perses to load seeded GlobalRole / GlobalRoleBinding
docker compose restart perses

echo ""
echo "Done! Open http://localhost:8080 and sign in as '$ADMIN_USER'."
