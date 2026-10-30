#!/usr/bin/env bash
# One-command demo: stack up -> seed -> UI build -> core with Matrix chat, SMTP mail, Matrix auth.
# Usage: scripts/demo.sh            (Ctrl-C stops the core; `npm run stack:down` stops Docker)
#        DEMO_SKIP_BUILD=1 scripts/demo.sh   to reuse apps/doctor-ui/dist
set -euo pipefail
cd "$(dirname "$0")/.."

step() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

command -v docker >/dev/null || { echo "docker not found" >&2; exit 1; }
command -v node >/dev/null || { echo "node not found (need Node 22)" >&2; exit 1; }

[[ -f .env ]] || { step "Creating .env from .env.example"; cp .env.example .env; }
[[ -d node_modules ]] || { step "npm install"; npm install; }

step "Starting Docker stack (Synapse, Element, HAPI, Mailpit)"
npm run --silent stack:up
bash infra/wait-for-stack.sh "${DEMO_STACK_TIMEOUT:-240}"

step "Seeding users, room, widget, FHIR resources"
npm run --silent seed

if [[ "${DEMO_SKIP_BUILD:-0}" != "1" || ! -d apps/doctor-ui/dist ]]; then
  step "Building doctor UI"
  npm run --silent ui:build
fi

port="$(grep -E '^PORT=' .env | cut -d= -f2 || true)"
port="${port:-3000}"
base="http://localhost:${port}"

cat <<URLS

  Element (Dr. Lena Hofer)  http://localhost:8080   login lena.hofer / demo-lena-2026
  Doctor UI (standalone)    ${base}/widget/?mode=standalone
  SMS simulator             ${base}/dev/sms
  Mailpit (e-mail inbox)    http://localhost:8025
  HAPI FHIR                 http://localhost:8090/fhir
  Synapse                   http://localhost:8008

URLS

step "Starting core on ${base} (CHAT_MODE=matrix MAIL_MODE=smtp AUTH_MODE=matrix)"
set -a; source .env; set +a
export CHAT_MODE=matrix MAIL_MODE=smtp AUTH_MODE=matrix
exec npm run --silent start
