{{/*
Expand the name of the chart.
*/}}
{{- define "vm-x-ai.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "vm-x-ai.fullname" -}}
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
Create chart name and version as used by the chart label.
*/}}
{{- define "vm-x-ai.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "vm-x-ai.labels" -}}
helm.sh/chart: {{ include "vm-x-ai.chart" . }}
{{ include "vm-x-ai.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- with .Values.commonLabels }}
{{ toYaml . }}
{{- end }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "vm-x-ai.selectorLabels" -}}
app.kubernetes.io/name: {{ include "vm-x-ai.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "vm-x-ai.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "vm-x-ai.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Generate database connection string
*/}}
{{- define "vm-x-ai.database.host" -}}
{{- if .Values.postgresql.enabled }}
{{- printf "%s-postgresql" (include "vm-x-ai.fullname" .) }}
{{- else }}
{{- .Values.postgresql.external.host }}
{{- end }}
{{- end }}

{{- define "vm-x-ai.database.roHost" -}}
{{- if .Values.postgresql.external.roHost }}
{{- .Values.postgresql.external.roHost }}
{{- else }}
{{- include "vm-x-ai.database.host" . }}
{{- end }}
{{- end }}

{{/*
Generate Redis connection details
*/}}
{{- define "vm-x-ai.redis.host" -}}
{{- if .Values.redis.enabled }}
{{- if eq .Values.redis.mode "cluster" }}
{{- printf "%s-redis-cluster" (include "vm-x-ai.fullname" .) }}
{{- else }}
{{- printf "%s-redis" (include "vm-x-ai.fullname" .) }}
{{- end }}
{{- else }}
{{- .Values.redis.external.host }}
{{- end }}
{{- end }}

{{- define "vm-x-ai.redis.port" -}}
{{- if .Values.redis.enabled }}
{{- if eq .Values.redis.mode "cluster" }}
{{- (index .Values.redis.cluster.service.ports 0).port }}
{{- else }}
{{- .Values.redis.single.service.port }}
{{- end }}
{{- else }}
{{- .Values.redis.external.port }}
{{- end }}
{{- end }}

{{/*
Generate Vault address
*/}}
{{- define "vm-x-ai.vault.addr" -}}
{{- if .Values.vault.enabled }}
{{- printf "http://%s-vault:%d" (include "vm-x-ai.fullname" .) .Values.vault.service.port }}
{{- else }}
{{- "" }}
{{- end }}
{{- end }}

{{/*
Generate QuestDB host
*/}}
{{- define "vm-x-ai.questdb.host" -}}
{{- if .Values.questdb.enabled }}
{{- printf "%s-questdb" (include "vm-x-ai.fullname" .) }}
{{- else }}
{{- "" }}
{{- end }}
{{- end }}

{{/*
Generate API base URL
*/}}
{{- define "vm-x-ai.api.baseUrl" -}}
{{- if .Values.ingress.enabled }}
{{- $host := (index .Values.ingress.hosts 0).host }}
{{- printf "https://%s/api" $host }}
{{- else }}
{{- printf "http://%s-api:%d" (include "vm-x-ai.fullname" .) .Values.api.service.port }}
{{- end }}
{{- end }}

{{/*
Generate UI base URL
*/}}
{{- define "vm-x-ai.ui.baseUrl" -}}
{{- if .Values.ingress.enabled }}
{{- $host := (index .Values.ingress.hosts 0).host }}
{{- printf "https://%s" $host }}
{{- else }}
{{- printf "http://%s-ui:%d" (include "vm-x-ai.fullname" .) .Values.ui.service.port }}
{{- end }}
{{- end }}

{{/*
Generate OIDC Provider Issuer
*/}}
{{- define "vm-x-ai.oidc.issuer" -}}
{{- include "vm-x-ai.api.baseUrl" . }}/oauth2
{{- end }}

{{/*
Generate random string
*/}}
{{- define "vm-x-ai.randomString" -}}
{{- randAlphaNum 32 }}
{{- end }}

{{/*
Image reference helper
*/}}
{{- define "vm-x-ai.image" -}}
{{- if .Values.global.imageRegistry }}
{{- printf "%s/%s:%s" .Values.global.imageRegistry .repository .tag }}
{{- else }}
{{- printf "%s:%s" .repository .tag }}
{{- end }}
{{- end }}

{{/*
Get secret name for database
*/}}
{{- define "vm-x-ai.secrets.database.name" -}}
{{- if eq $.Values.secrets.method "external" }}
{{- if $.Values.secrets.external.database.secretName }}
{{- $.Values.secrets.external.database.secretName }}
{{- else }}
{{- include "vm-x-ai.fullname" $ }}-database
{{- end }}
{{- else }}
{{- include "vm-x-ai.fullname" $ }}-database
{{- end }}
{{- end }}

{{/*
Get secret key for database password
*/}}
{{- define "vm-x-ai.secrets.database.passwordKey" -}}
{{- if eq $.Values.secrets.method "external" }}
{{- $.Values.secrets.external.database.passwordKey }}
{{- else }}
{{- "password" }}
{{- end }}
{{- end }}

{{/*
Get secret name for questdb
*/}}
{{- define "vm-x-ai.secrets.questdb.name" -}}
{{- if eq $.Values.secrets.method "external" }}
{{- if $.Values.secrets.external.questdb.secretName }}
{{- $.Values.secrets.external.questdb.secretName }}
{{- else }}
{{- include "vm-x-ai.fullname" $ }}-questdb
{{- end }}
{{- else }}
{{- include "vm-x-ai.fullname" $ }}-questdb
{{- end }}
{{- end }}

{{/*
Get secret key for questdb password
*/}}
{{- define "vm-x-ai.secrets.questdb.passwordKey" -}}
{{- if eq $.Values.secrets.method "external" }}
{{- $.Values.secrets.external.questdb.passwordKey }}
{{- else }}
{{- "password" }}
{{- end }}
{{- end }}

{{/*
Get secret name for ui
*/}}
{{- define "vm-x-ai.secrets.ui.name" -}}
{{- if eq $.Values.secrets.method "external" }}
{{- if $.Values.secrets.external.ui.secretName }}
{{- $.Values.secrets.external.ui.secretName }}
{{- else }}
{{- include "vm-x-ai.fullname" $ }}-ui
{{- end }}
{{- else }}
{{- include "vm-x-ai.fullname" $ }}-ui
{{- end }}
{{- end }}

{{/*
Get secret key for ui auth secret
*/}}
{{- define "vm-x-ai.secrets.ui.authSecretKey" -}}
{{- if eq $.Values.secrets.method "external" }}
{{- $.Values.secrets.external.ui.authSecretKey }}
{{- else }}
{{- "auth-secret" }}
{{- end }}
{{- end }}

