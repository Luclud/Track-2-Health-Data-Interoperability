#!/usr/bin/env bash
# Waits until Synapse, Element, HAPI and Mailpit answer. Usage: infra/wait-for-stack.sh [timeout_seconds]
# HAPI's image is distroless (no shell/curl), so health is checked from the host instead of a compose healthcheck.
set -euo pipefail
timeout="${1:-180}"
declare -A urls=(
  [synapse]="http://localhost:8008/health"
  [element]="http://localhost:8080/config.json"
  [hapi]="http://localhost:8090/fhir/metadata"
  [mailpit]="http://localhost:8025/api/v1/info"
)
start=$(date +%s)
for name in synapse element hapi mailpit; do
  until curl -fs -o /dev/null "${urls[$name]}"; do
    if (( $(date +%s) - start > timeout )); then
      echo "timeout: $name not ready at ${urls[$name]}" >&2
      exit 1
    fi
    sleep 2
  done
  echo "ready: $name ($(( $(date +%s) - start )) s)"
done
