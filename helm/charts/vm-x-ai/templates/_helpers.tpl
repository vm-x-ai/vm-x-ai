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
{{- $fullname := include "vm-x-ai.fullname" . }}
{{- printf "%s-redis-cluster-0.%s-redis-cluster" $fullname $fullname }}
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
Get secret name for libsodium
*/}}
{{- define "vm-x-ai.secrets.libsodium.name" -}}
{{- if eq (default "create" $.Values.secrets.libsodium.method) "external" }}
{{- if $.Values.secrets.libsodium.external.secretName }}
{{- $.Values.secrets.libsodium.external.secretName }}
{{- else }}
{{- include "vm-x-ai.fullname" $ }}-libsodium
{{- end }}
{{- else }}
{{- include "vm-x-ai.fullname" $ }}-libsodium
{{- end }}
{{- end }}

{{/*
Get secret key for libsodium encryption key
*/}}
{{- define "vm-x-ai.secrets.libsodium.keyKey" -}}
{{- if eq (default "create" $.Values.secrets.libsodium.method) "external" }}
{{- $.Values.secrets.libsodium.external.encryptionKeyKey }}
{{- else }}
{{- "encryption-key" }}
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
Check if TLS is enabled for ingress
*/}}
{{- define "vm-x-ai.ingress.tlsEnabled" -}}
{{- range .Values.ingress.istio.gateway.servers }}
{{- if and (eq .port.protocol "HTTPS") .tls }}
true
{{- end }}
{{- end }}
{{- end }}

{{/*
Generate API base URL (without BASE_PATH prefix)
BASE_URL should be the base host, BASE_PATH is separate
*/}}
{{- define "vm-x-ai.api.baseUrl" -}}
{{- if .Values.ingress.enabled }}
{{- $host := .Values.ingress.istio.host }}
{{- $tlsEnabled := include "vm-x-ai.ingress.tlsEnabled" . }}
{{- $scheme := "http" }}
{{- if $tlsEnabled }}
{{- $scheme = "https" }}
{{- end }}
{{- printf "%s://%s" $scheme $host }}
{{- else }}
{{- printf "http://%s-api:%d" (include "vm-x-ai.fullname" .) (int .Values.api.service.port) }}
{{- end }}
{{- end }}

{{/*
Generate UI base URL
*/}}
{{- define "vm-x-ai.ui.baseUrl" -}}
{{- if .Values.ingress.enabled }}
{{- $host := .Values.ingress.istio.host }}
{{- $tlsEnabled := include "vm-x-ai.ingress.tlsEnabled" . }}
{{- if $tlsEnabled }}
{{- printf "https://%s" $host }}
{{- else }}
{{- printf "http://%s" $host }}
{{- end }}
{{- else }}
{{- printf "http://%s-ui:%d" (include "vm-x-ai.fullname" .) (int .Values.ui.service.port) }}
{{- end }}
{{- end }}

{{/*
Generate API base URL with BASE_PATH (for UI API_BASE_URL)
This should be BASE_URL + BASE_PATH
*/}}
{{- define "vm-x-ai.api.baseUrlWithPath" -}}
{{- $baseUrl := include "vm-x-ai.api.baseUrl" . }}
{{- $basePath := .Values.api.env.BASE_PATH }}
{{- if $basePath }}
{{- printf "%s%s" $baseUrl $basePath }}
{{- else }}
{{- printf "%s/api" $baseUrl }}
{{- end }}
{{- end }}

{{/*
Generate internal API base URL (for server-side requests within cluster)
Uses Kubernetes service name instead of external hostname
*/}}
{{- define "vm-x-ai.api.internalBaseUrl" -}}
{{- $basePath := .Values.api.env.BASE_PATH }}
{{- if $basePath }}
{{- printf "http://%s-api:%d%s" (include "vm-x-ai.fullname" .) (int .Values.api.service.port) $basePath }}
{{- else }}
{{- printf "http://%s-api:%d/api" (include "vm-x-ai.fullname" .) (int .Values.api.service.port) }}
{{- end }}
{{- end }}

{{/*
Generate internal OIDC issuer URL (for server-side requests within cluster)
*/}}
{{- define "vm-x-ai.oidc.internalIssuer" -}}
{{- $basePath := .Values.api.env.BASE_PATH }}
{{- if $basePath }}
{{- printf "http://%s-api:%d%s/oauth2" (include "vm-x-ai.fullname" .) (int .Values.api.service.port) $basePath }}
{{- else }}
{{- printf "http://%s-api:%d/oauth2" (include "vm-x-ai.fullname" .) (int .Values.api.service.port) }}
{{- end }}
{{- end }}

{{/*
Generate OIDC Provider Issuer
OIDC issuer should be BASE_URL + BASE_PATH + /oauth2
*/}}
{{- define "vm-x-ai.oidc.issuer" -}}
{{- $baseUrl := include "vm-x-ai.api.baseUrl" . }}
{{- $basePath := .Values.api.env.BASE_PATH }}
{{- if $basePath }}
{{- printf "%s%s/oauth2" $baseUrl $basePath }}
{{- else }}
{{- printf "%s/oauth2" $baseUrl }}
{{- end }}
{{- end }}

{{/*
Generate OTEL Exporter Endpoint
*/}}
{{- define "vm-x-ai.otel.exporterEndpoint" -}}
{{- if .Values.otel.exporterEndpoint }}
{{- .Values.otel.exporterEndpoint }}
{{- else if and .Values.otel.enabled .Values.otel.collector.enabled }}
{{- printf "http://%s-otel-collector:%d" (include "vm-x-ai.fullname" .) (int (index .Values.otel.collector.service.ports 1).port) }}
{{- else }}
{{- "" }}
{{- end }}
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
{{- if eq (default "create" $.Values.secrets.database.method) "external" }}
{{- if $.Values.secrets.database.external.secretName }}
{{- $.Values.secrets.database.external.secretName }}
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
{{- if eq (default "create" $.Values.secrets.database.method) "external" }}
{{- $.Values.secrets.database.external.passwordKey }}
{{- else }}
{{- "password" }}
{{- end }}
{{- end }}

{{/*
Get secret key for database host
*/}}
{{- define "vm-x-ai.secrets.database.hostKey" -}}
{{- if eq (default "create" $.Values.secrets.database.method) "external" }}
{{- if $.Values.secrets.database.external.hostKey }}
{{- $.Values.secrets.database.external.hostKey }}
{{- else }}
{{- "host" }}
{{- end }}
{{- else if eq (default "create" $.Values.secrets.database.method) "eso" }}
{{- if $.Values.secrets.database.externalSecrets.hostKey }}
{{- $.Values.secrets.database.externalSecrets.hostKey }}
{{- else }}
{{- "host" }}
{{- end }}
{{- else }}
{{- "host" }}
{{- end }}
{{- end }}

{{/*
Get secret key for database port
*/}}
{{- define "vm-x-ai.secrets.database.portKey" -}}
{{- if eq (default "create" $.Values.secrets.database.method) "external" }}
{{- if $.Values.secrets.database.external.portKey }}
{{- $.Values.secrets.database.external.portKey }}
{{- else }}
{{- "port" }}
{{- end }}
{{- else if eq (default "create" $.Values.secrets.database.method) "eso" }}
{{- if $.Values.secrets.database.externalSecrets.portKey }}
{{- $.Values.secrets.database.externalSecrets.portKey }}
{{- else }}
{{- "port" }}
{{- end }}
{{- else }}
{{- "port" }}
{{- end }}
{{- end }}

{{/*
Get secret key for database name
*/}}
{{- define "vm-x-ai.secrets.database.databaseKey" -}}
{{- if eq (default "create" $.Values.secrets.database.method) "external" }}
{{- if $.Values.secrets.database.external.databaseKey }}
{{- $.Values.secrets.database.external.databaseKey }}
{{- else }}
{{- "database" }}
{{- end }}
{{- else if eq (default "create" $.Values.secrets.database.method) "eso" }}
{{- if $.Values.secrets.database.externalSecrets.databaseKey }}
{{- $.Values.secrets.database.externalSecrets.databaseKey }}
{{- else }}
{{- "database" }}
{{- end }}
{{- else }}
{{- "database" }}
{{- end }}
{{- end }}

{{/*
Get secret key for database username
*/}}
{{- define "vm-x-ai.secrets.database.usernameKey" -}}
{{- if eq (default "create" $.Values.secrets.database.method) "external" }}
{{- if $.Values.secrets.database.external.usernameKey }}
{{- $.Values.secrets.database.external.usernameKey }}
{{- else }}
{{- "username" }}
{{- end }}
{{- else if eq (default "create" $.Values.secrets.database.method) "eso" }}
{{- if $.Values.secrets.database.externalSecrets.usernameKey }}
{{- $.Values.secrets.database.externalSecrets.usernameKey }}
{{- else }}
{{- "username" }}
{{- end }}
{{- else }}
{{- "username" }}
{{- end }}
{{- end }}

{{/*
Check if database connection details should come from secrets
Returns true if using external PostgreSQL and secret method supports it
*/}}
{{- define "vm-x-ai.secrets.database.useSecretForConnection" -}}
{{- if not $.Values.postgresql.enabled }}
{{- $method := default "create" $.Values.secrets.database.method }}
{{- if or (eq $method "create") (eq $method "eso") (eq $method "external") }}
true
{{- end }}
{{- end }}
{{- end }}

{{/*
Get secret name for questdb
*/}}
{{- define "vm-x-ai.secrets.questdb.name" -}}
{{- if eq (default "create" $.Values.secrets.questdb.method) "external" }}
{{- if $.Values.secrets.questdb.external.secretName }}
{{- $.Values.secrets.questdb.external.secretName }}
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
{{- if eq (default "create" $.Values.secrets.questdb.method) "external" }}
{{- $.Values.secrets.questdb.external.passwordKey }}
{{- else }}
{{- "password" }}
{{- end }}
{{- end }}

{{/*
Get secret name for ui
*/}}
{{- define "vm-x-ai.secrets.ui.name" -}}
{{- if eq (default "create" $.Values.secrets.ui.method) "external" }}
{{- if $.Values.secrets.ui.external.secretName }}
{{- $.Values.secrets.ui.external.secretName }}
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
{{- if eq (default "create" $.Values.secrets.ui.method) "external" }}
{{- $.Values.secrets.ui.external.authSecretKey }}
{{- else }}
{{- "auth-secret" }}
{{- end }}
{{- end }}


