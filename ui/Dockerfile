FROM node:24-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.27-alpine
USER root
RUN sed -i '1i load_module modules/ngx_http_js_module.so;' /etc/nginx/nginx.conf
USER 101
ENV PERSES_UPSTREAM=perses.observability.svc.cluster.local:8080
COPY deploy/nginx/njs/audit.js /etc/nginx/njs/audit.js
COPY deploy/nginx/nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
CMD ["nginx", "-g", "daemon off;"]

