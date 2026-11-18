{{/*
Expand the name of the chart.
*/}}
{{- define "perses-observability.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "perses-observability.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "perses-observability.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{ include "perses-observability.selectorLabels" . }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: perses-observability
{{- end }}

{{/*
Selector labels
*/}}
{{- define "perses-observability.selectorLabels" -}}
app.kubernetes.io/name: {{ include "perses-observability.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Service name for Perses backend
*/}}
{{- define "perses-observability.perses.serviceName" -}}
{{- if and .Values.perses .Values.perses.fullnameOverride -}}
{{- .Values.perses.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else if .Values.fullnameOverride -}}
{{- printf "%s-perses" .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-perses" .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end }}

{{/*
Service name for VictoriaMetrics server
*/}}
{{- define "perses-observability.victoriaMetrics.serviceName" -}}
{{- if and .Values.victoriaMetrics .Values.victoriaMetrics.server .Values.victoriaMetrics.server.fullnameOverride -}}
{{- .Values.victoriaMetrics.server.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else if and .Values.victoriaMetrics .Values.victoriaMetrics.fullnameOverride -}}
{{- .Values.victoriaMetrics.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else if .Values.fullnameOverride -}}
{{- printf "%s-victoria-metrics" .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "victoria-metrics" -}}
{{- end -}}
{{- end }}

{{/*
Service name for VictoriaLogs single server
*/}}
{{- define "perses-observability.victoriaLogs.serviceName" -}}
{{- if and .Values.victoriaLogs .Values.victoriaLogs.fullnameOverride -}}
{{- .Values.victoriaLogs.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else if .Values.fullnameOverride -}}
{{- printf "%s-victoria-logs" .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "vl-victoria-logs-single-server" -}}
{{- end -}}
{{- end }}

{{/*
Service name for vmauth proxy
*/}}
{{- define "perses-observability.vmauth.serviceName" -}}
{{- if and .Values.vmauth .Values.vmauth.fullnameOverride -}}
{{- .Values.vmauth.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else if .Values.fullnameOverride -}}
{{- printf "%s-vmauth" .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "vmauth-victoria-metrics-auth" -}}
{{- end -}}
{{- end }}

