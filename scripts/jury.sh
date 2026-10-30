#!/usr/bin/env bash
# Jury demo: like scripts/demo.sh, but the outside portal is reachable from a judge's phone.
# Usage: scripts/jury.sh          stack up -> seed -> UI build -> Cloudflare quick tunnel -> core (JURY_MODE=true)
#        scripts/jury.sh --lan    no tunnel, PUBLIC_BASE_URL=http://<LAN IP>:3000 (phone on the same Wi-Fi / hotspot)
# Env:   JURY_SKIP_BUILD=1 reuse apps/doctor-ui/dist · JURY_LAN_IP=<ip> override LAN IP detection
# Ctrl-C stops core and tunnel; `npm run stack:down` stops Docker.
set -euo pipefail
cd "$(dirname "$0")/.."

mode=tunnel
for arg in "$@"; do
  case "$arg" in
    --lan) mode=lan ;;
    -h|--help) sed -n '2,6p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown argument: $arg (use --lan or --help)" >&2; exit 2 ;;
  esac
done

step() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m%s\033[0m\n' "$*" >&2; }
cache_dir="${HOME}/.cache/brieftaube"

command -v docker >/dev/null || { echo "docker not found" >&2; exit 1; }
command -v node >/dev/null || { echo "node not found (need Node 22)" >&2; exit 1; }
command -v curl >/dev/null || { echo "curl not found" >&2; exit 1; }

[[ -f .env ]] || { step "Creating .env from .env.example"; cp .env.example .env; }
[[ -d node_modules ]] || { step "npm install"; npm install; }
set -a; source .env; set +a
port="${PORT:-3000}"
local_base="http://localhost:${port}"

# Returns the cloudflared binary path (PATH first, else a cached/downloaded static binary).
ensure_cloudflared() {
  if command -v cloudflared >/dev/null; then command -v cloudflared; return; fi
  local bin="${cache_dir}/cloudflared"
  if [[ -x "$bin" ]]; then echo "$bin"; return; fi
  local os arch url
  case "$(uname -s)" in Linux) os=linux ;; Darwin) os=darwin ;; *) os="" ;; esac
  case "$(uname -m)" in x86_64|amd64) arch=amd64 ;; aarch64|arm64) arch=arm64 ;; armv7l|armv6l) arch=arm ;; i386|i686) arch=386 ;; *) arch="" ;; esac
  if [[ -n "$os" && -n "$arch" ]]; then
    mkdir -p "$cache_dir"
    url="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-${os}-${arch}"
    step "Downloading cloudflared (${os}/${arch}) into ${cache_dir}" >&2
    if [[ "$os" == darwin ]]; then
      curl -fsSL -m 120 "${url}.tgz" | tar -xz -C "$cache_dir" cloudflared 2>/dev/null || true
    else
      curl -fsSL -m 120 -o "${bin}.part" "$url" && mv "${bin}.part" "$bin" || rm -f "${bin}.part"
    fi
    [[ -f "$bin" ]] && chmod +x "$bin" && "$bin" --version >/dev/null 2>&1 && { echo "$bin"; return; }
  fi
  warn "Could not get cloudflared. Install it manually, then re-run:"
  warn "  macOS:  brew install cloudflared"
  warn "  Linux:  curl -fL -o ~/.local/bin/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 && chmod +x ~/.local/bin/cloudflared"
  warn "  or use: scripts/jury.sh --lan"
  return 1
}

lan_ip() {
  if [[ -n "${JURY_LAN_IP:-}" ]]; then echo "$JURY_LAN_IP"; return; fi
  local ip=""
  if [[ "$(uname -s)" == Darwin ]]; then
    ip="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
  else
    ip="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<NF;i++) if($i=="src"){print $(i+1); exit}}' || true)"
    [[ -n "$ip" ]] || ip="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
  fi
  [[ -n "$ip" ]] || { echo "could not detect the LAN IP; set JURY_LAN_IP=<ip>" >&2; return 1; }
  echo "$ip"
}

print_qr() {
  local text="$1"
  if command -v qrencode >/dev/null; then qrencode -t ansiutf8 "$text"; return; fi
  if node -e 'require.resolve("qrcode")' 2>/dev/null; then
    node -e 'require("qrcode").toString(process.argv[1], { type: "terminal", small: true }).then((s) => process.stdout.write(s))' "$text" && return
  fi
  local t=(); command -v timeout >/dev/null && t=(timeout 60)
  # qrcode-terminal reads the text from stdin when stdin is not a TTY, so always pipe it in
  printf '%s' "$text" | ${t[@]+"${t[@]}"} npx --yes qrcode-terminal@0.12.0 2>/dev/null || warn "(no terminal QR: install qrencode, or open the URL on the phone by hand)"
}

tunnel_pid=""
core_pid=""
cleanup() {
  trap - INT TERM EXIT
  [[ -n "$core_pid" ]] && kill "$core_pid" 2>/dev/null || true
  [[ -n "$tunnel_pid" ]] && kill "$tunnel_pid" 2>/dev/null || true
  wait 2>/dev/null || true
  echo; echo "Stopped core${tunnel_pid:+ and tunnel}. Docker stack still runs (npm run stack:down)."
}
trap cleanup INT TERM EXIT

if [[ "$mode" == tunnel ]]; then cloudflared_bin="$(ensure_cloudflared)"; fi

if curl -fs -o /dev/null "${local_base}/health"; then
  echo "Port ${port} is already in use (a core is running?). Stop it first." >&2; exit 1
fi

step "Starting Docker stack (Synapse, Element, HAPI, Mailpit)"
npm run --silent stack:up
bash infra/wait-for-stack.sh "${JURY_STACK_TIMEOUT:-240}"

step "Seeding users, room, widget, FHIR resources"
# The widget runs in Element on this laptop, so it keeps the local URL; only the outside portal goes public.
PUBLIC_BASE_URL="$local_base" npm run --silent seed

if [[ "${JURY_SKIP_BUILD:-0}" != "1" || ! -d apps/doctor-ui/dist ]]; then
  step "Building doctor UI"
  npm run --silent ui:build
fi

if [[ "$mode" == tunnel ]]; then
  step "Starting Cloudflare quick tunnel to ${local_base}"
  mkdir -p "$cache_dir"
  tunnel_log="${cache_dir}/tunnel.log"
  "$cloudflared_bin" tunnel --no-autoupdate --url "$local_base" >"$tunnel_log" 2>&1 &
  tunnel_pid=$!
  public_base=""
  for _ in $(seq 1 60); do
    # Only the banner line ("|  https://<name>.trycloudflare.com  |"); error lines also contain https://api.trycloudflare.com
    public_base="$({ grep -E '^[^|]*\|[[:space:]]+https://[a-z0-9-]+\.trycloudflare\.com' "$tunnel_log" || true; } | grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' | grep -v '^https://api\.' | head -1 || true)"
    [[ -n "$public_base" ]] && break
    kill -0 "$tunnel_pid" 2>/dev/null || break
    sleep 1
  done
  if [[ -z "$public_base" ]]; then
    warn "No tunnel URL after 60 s. Last lines of ${tunnel_log}:"; tail -n 15 "$tunnel_log" >&2 || true
    warn "Fallback: scripts/jury.sh --lan (phone on the same Wi-Fi or the laptop's hotspot)"
    exit 1
  fi
else
  public_base="http://$(lan_ip):${port}"
fi

step "Starting core on ${public_base} (JURY_MODE=true CHAT_MODE=matrix AUTH_MODE=matrix MAIL_MODE=smtp)"
export PUBLIC_BASE_URL="$public_base" EID_ISSUER_URL="${public_base}/mock-eid" JURY_MODE=true \
  CHAT_MODE=matrix AUTH_MODE=matrix MAIL_MODE=smtp
node_modules/.bin/tsx services/core/src/main.ts &
core_pid=$!

for _ in $(seq 1 60); do
  curl -fs -o /dev/null "${local_base}/health" && break
  kill -0 "$core_pid" 2>/dev/null || { echo "core exited" >&2; exit 1; }
  sleep 1
done

public_ok="no"
for _ in $(seq 1 45); do
  if curl -fs -m 5 -o /dev/null "${public_base}/health"; then public_ok="yes"; break; fi
  sleep 2
done
[[ "$public_ok" == yes ]] || warn "Warning: ${public_base}/health is not reachable from this machine yet (tunnel DNS may need a moment; test with your phone)."

cat <<URLS

  JURY MODE: links are also shown in the doctor UI. Demo only.

  Public base (phone)       ${public_base}
  Element (Dr. Lena Hofer)  http://localhost:8080   login lena.hofer / demo-lena-2026
  Doctor UI (standalone)    ${local_base}/widget/?mode=standalone
  SMS simulator             ${local_base}/dev/sms
  Mailpit (e-mail inbox)    http://localhost:8025
  HAPI FHIR                 http://localhost:8090/fhir

  Base URL as QR (scan with your phone to check it reaches the laptop):
URLS
print_qr "${public_base}"
echo
echo "Ready. Ctrl-C stops core${tunnel_pid:+ and tunnel}."
wait "$core_pid"
