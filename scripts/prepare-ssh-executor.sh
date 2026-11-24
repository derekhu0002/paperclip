#!/usr/bin/env bash
set -uo pipefail

PROG=${0##*/}
PORT=2222
HARNESS=opencode
SERVER_URL=""
WORKSPACE=""
INSTALL_SSHD=0
APPLY_SSHD=0
JSON=0
REPORT_ONLY=0
CA_BUNDLE=""
INSECURE=0
PUBKEYS=()

usage() {
  cat <<EOF
$PROG - prepare this machine for a Paperclip SSH environment.

Usage:
  $PROG --pubkey '<paperclip public key>' [--pubkey '<key2>'] [options]

Options:
  --pubkey KEY          Paperclip-side SSH public key to authorize (repeatable)
  --pubkey-file PATH    Read authorized public keys from a file
  --port N              sshd port Paperclip will dial (default 2222)
  --server-url URL      Paperclip base URL; checks this host -> Paperclip outbound
                        (use the same https:// origin you log in to)
  --ca-bundle PATH      Extra CA file for an https:// --server-url with a private CA
  --insecure            Skip TLS verification for the --server-url check (self-signed)
  --harness NAME|PATH   Agent CLI that must resolve in Paperclip's SSH shell
                        (default opencode)
  --workspace PATH      Repo to report (default: current directory)
  --install-sshd        Install openssh-server when missing (apt + sudo)
  --apply-sshd-config   Write /etc/ssh/sshd_config.d/99-paperclip.conf and
                        restart sshd (sudo)
  --json                Emit a JSON report instead of the text report
  --report-only         Report only; do not require an authorized key
  -h, --help            Show this help

The Paperclip-side public key is the public half of the private key stored in
the SSH environment (or its company SSH secret). On the Paperclip host:

  ssh-keygen -y -f ./paperclip_key > paperclip_key.pub

Run this script on the execution machine (the WSL/Linux host), then paste the
printed ENVIRONMENT block into Paperclip and run Test.

Exit codes: 0 ready, 1 a hard prerequisite failed, 2 usage error.
EOF
}

usage_error() {
  printf '%s: %s\n\n' "$PROG" "$1" >&2
  usage >&2
  exit 2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --pubkey)
      [[ $# -ge 2 ]] || usage_error "--pubkey needs a value"
      PUBKEYS+=("$2")
      shift 2
      ;;
    --pubkey-file)
      [[ $# -ge 2 ]] || usage_error "--pubkey-file needs a path"
      [[ -r "$2" ]] || usage_error "cannot read $2"
      while IFS= read -r line || [[ -n "$line" ]]; do
        line=$(printf '%s' "$line" | tr -d '\r' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
        [[ -z "$line" || "$line" == \#* ]] && continue
        PUBKEYS+=("$line")
      done < "$2"
      shift 2
      ;;
    --port)
      [[ $# -ge 2 ]] || usage_error "--port needs a value"
      [[ "$2" =~ ^[0-9]+$ ]] || usage_error "--port must be numeric"
      PORT="$2"
      shift 2
      ;;
    --server-url)
      [[ $# -ge 2 ]] || usage_error "--server-url needs a value"
      SERVER_URL="$2"
      shift 2
      ;;
    --harness)
      [[ $# -ge 2 ]] || usage_error "--harness needs a value"
      HARNESS="$2"
      shift 2
      ;;
    --workspace)
      [[ $# -ge 2 ]] || usage_error "--workspace needs a path"
      WORKSPACE="$2"
      shift 2
      ;;
    --install-sshd)
      INSTALL_SSHD=1
      shift
      ;;
    --apply-sshd-config)
      APPLY_SSHD=1
      shift
      ;;
    --json)
      JSON=1
      shift
      ;;
    --report-only)
      REPORT_ONLY=1
      shift
      ;;
    --ca-bundle)
      [[ $# -ge 2 ]] || usage_error "--ca-bundle needs a path"
      CA_BUNDLE="$2"
      shift 2
      ;;
    --insecure)
      INSECURE=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage_error "unknown argument: $1"
      ;;
  esac
done

RECORDS=()
OKS=0
WARNS=0
FAILS=0

ok() { RECORDS+=("ok|$1"); OKS=$((OKS + 1)); }
warn() { RECORDS+=("warn|$1"); WARNS=$((WARNS + 1)); }
fail() { RECORDS+=("fail|$1"); FAILS=$((FAILS + 1)); }

if [[ ${EUID:-0} -eq 0 ]]; then
  SUDO=()
  SUDO_READ=()
else
  if sudo -n true 2>/dev/null; then
    SUDO=(sudo -n)
    SUDO_READ=(sudo -n)
  else
    SUDO_READ=()
    if [[ -t 0 ]]; then
      SUDO=(sudo)
    else
      SUDO=(sudo -n)
    fi
  fi
fi

valid_pubkey() {
  printf '%s\n' "$1" | grep -Eq '^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp256|ecdsa-sha2-nistp384|ecdsa-sha2-nistp521|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com)[[:space:]]+[A-Za-z0-9+/]+={0,2}([[:space:]].*)?$'
}

is_wsl() {
  [[ -r /proc/version ]] && grep -qi microsoft /proc/version
}

WSL=0
is_wsl && WSL=1

NETMODE=""
if [[ $WSL -eq 1 ]]; then
  if command -v wslinfo >/dev/null 2>&1; then
    NETMODE=$(wslinfo --networking-mode 2>/dev/null | tr -d '\r')
  fi
  [[ -z "$NETMODE" ]] && NETMODE="unknown"
fi

GOOD_KEYS=()
for k in ${PUBKEYS[@]+"${PUBKEYS[@]}"}; do
  if valid_pubkey "$k"; then
    GOOD_KEYS+=("$k")
  else
    fail "ignored a malformed public key: $(printf '%s' "$k" | cut -c1-40)..."
  fi
done

KEYS_ADDED=0
KEYS_SKIPPED=0
if [[ ${#GOOD_KEYS[@]} -eq 0 ]]; then
  if [[ $REPORT_ONLY -eq 1 ]]; then
    warn "report-only: authorized_keys was not changed"
  else
    fail "no authorized key installed; pass --pubkey, or --report-only to skip"
  fi
else
  AK_DIR="$HOME/.ssh"
  AK="$AK_DIR/authorized_keys"
  installed=1
  mkdir -p "$AK_DIR" || installed=0
  chmod 700 "$AK_DIR" 2>/dev/null || true
  if [[ -f "$AK" ]]; then
    cp -p "$AK" "$AK.paperclip-backup-$(date +%Y%m%d%H%M%S)" || installed=0
  fi
  if [[ $installed -eq 1 ]]; then
    touch "$AK" || installed=0
  fi
  if [[ $installed -eq 1 ]]; then
    old_umask=$(umask)
    umask 077
    for k in "${GOOD_KEYS[@]}"; do
      blob=$(printf '%s' "$k" | awk '{print $2}')
      if grep -Fq -- "$blob" "$AK" 2>/dev/null; then
        KEYS_SKIPPED=$((KEYS_SKIPPED + 1))
        continue
      fi
      printf '%s\n' "$k" >> "$AK" && KEYS_ADDED=$((KEYS_ADDED + 1))
    done
    umask "$old_umask"
    chmod 600 "$AK" 2>/dev/null || true
    ok "authorized_keys: ${#GOOD_KEYS[@]} key(s) requested, ${KEYS_ADDED} added, ${KEYS_SKIPPED} already present"
  else
    fail "could not update $AK"
  fi
fi

SSHD_BIN=""
if command -v sshd >/dev/null 2>&1; then
  SSHD_BIN=$(command -v sshd)
elif [[ -x /usr/sbin/sshd ]]; then
  SSHD_BIN=/usr/sbin/sshd
fi

if [[ -z "$SSHD_BIN" ]]; then
  if [[ $INSTALL_SSHD -eq 1 ]]; then
    if command -v apt-get >/dev/null 2>&1; then
      if "${SUDO[@]}" apt-get update -y >/dev/null 2>&1 \
        && "${SUDO[@]}" env DEBIAN_FRONTEND=noninteractive apt-get install -y openssh-server >/dev/null 2>&1; then
        SSHD_BIN=$(command -v sshd || printf '/usr/sbin/sshd')
        ok "installed openssh-server"
      else
        fail "openssh-server install failed; install it manually"
      fi
    else
      fail "openssh-server is missing and apt-get is unavailable; install SSH server manually"
    fi
  else
    fail "openssh-server is not installed (re-run with --install-sshd)"
  fi
else
  ok "sshd present: $SSHD_BIN"
fi

listening_ports() {
  if command -v ss >/dev/null 2>&1; then
    ss -ltn 2>/dev/null | awk 'NR>1{n=split($4,a,":"); print a[n]}' | sort -un | paste -sd, -
  elif command -v netstat >/dev/null 2>&1; then
    netstat -ltn 2>/dev/null | awk 'NR>2{n=split($4,a,":"); print a[n]}' | sort -un | paste -sd, -
  fi
}

sshd_config_ports() {
  local out=""
  if [[ -n "$SSHD_BIN" ]]; then
    out=$("$SSHD_BIN" -T 2>/dev/null </dev/null | awk '$1=="port"{print $2}' | paste -sd, -)
    if [[ -z "$out" && ${#SUDO_READ[@]} -gt 0 ]]; then
      out=$("${SUDO_READ[@]}" "$SSHD_BIN" -T 2>/dev/null </dev/null | awk '$1=="port"{print $2}' | paste -sd, -)
    fi
  fi
  printf '%s' "$out"
}

if [[ $APPLY_SSHD -eq 1 ]]; then
  if [[ ${#GOOD_KEYS[@]} -eq 0 ]]; then
    fail "refusing --apply-sshd-config with no authorized key (would risk lockout)"
  elif [[ -z "$SSHD_BIN" ]]; then
    fail "refusing --apply-sshd-config without sshd installed"
  else
    CONF=/etc/ssh/sshd_config.d/99-paperclip.conf
    applied=1
    "${SUDO[@]}" mkdir -p /etc/ssh/sshd_config.d || applied=0
    if [[ $applied -eq 1 && -f "$CONF" ]]; then
      "${SUDO[@]}" cp -p "$CONF" "$CONF.paperclip-backup-$(date +%Y%m%d%H%M%S)" || applied=0
    fi
    if [[ $applied -eq 1 ]]; then
      printf 'Port %s\nPubkeyAuthentication yes\nPasswordAuthentication no\nUsePAM yes\n' "$PORT" \
        | "${SUDO[@]}" tee "$CONF" >/dev/null || applied=0
    fi
    if [[ $applied -eq 1 ]] && ! "${SUDO[@]}" "$SSHD_BIN" -t 2>/dev/null; then
      fail "sshd rejected the generated config; the previous config is untouched"
      applied=0
    fi
    if [[ $applied -eq 1 ]]; then
      restarted=0
      if [[ -d /run/systemd/system ]]; then
        if "${SUDO[@]}" systemctl restart ssh >/dev/null 2>&1; then restarted=1
        elif "${SUDO[@]}" systemctl restart sshd >/dev/null 2>&1; then restarted=1
        elif "${SUDO[@]}" systemctl enable --now ssh >/dev/null 2>&1; then restarted=1
        fi
      else
        if "${SUDO[@]}" service ssh restart >/dev/null 2>&1; then restarted=1
        elif "${SUDO[@]}" service sshd restart >/dev/null 2>&1; then restarted=1
        elif "${SUDO[@]}" service ssh start >/dev/null 2>&1; then restarted=1
        fi
      fi
      if [[ $restarted -eq 1 ]]; then
        ok "applied $CONF (Port $PORT, public key auth only) and restarted sshd"
      else
        fail "wrote $CONF but could not restart sshd; restart it manually"
      fi
    fi
  fi
fi

PORTS_LISTEN=$(listening_ports)
PORTS_CONFIG=$(sshd_config_ports)
if [[ -n "$PORTS_CONFIG" && -n "$PORTS_LISTEN" ]]; then
  if printf '%s' ",$PORTS_LISTEN," | grep -Fq ",$PORT,"; then
    ok "sshd listens on port $PORT (configured ports: $PORTS_CONFIG)"
  else
    warn "configured sshd port(s) $PORTS_CONFIG, but port $PORT is not listening yet (listening: $PORTS_LISTEN)"
  fi
elif [[ -n "$PORTS_CONFIG" ]]; then
  warn "sshd configured for port(s) $PORTS_CONFIG; cannot confirm the listening socket"
else
  warn "could not read the effective sshd port (need root for sshd -T); listening: ${PORTS_LISTEN:-unknown}"
fi

ADDRS=()
add_addr() {
  local label="$1" ip="$2" existing
  [[ -z "$ip" ]] && return 0
  for existing in ${ADDRS[@]+"${ADDRS[@]}"}; do
    [[ "${existing##*|}" == "$ip" ]] && return 0
  done
  ADDRS+=("$label|$ip")
}

GW=""
if [[ $WSL -eq 1 ]] && command -v tailscale >/dev/null 2>&1; then
  for ip in $(tailscale ip -4 2>/dev/null); do
    add_addr tailscale "$ip"
  done
fi

if command -v ip >/dev/null 2>&1; then
  while read -r iface cidr; do
    ip=${cidr%/*}
    case "$iface" in
      lo|docker*|br-*|veth*) continue ;;
    esac
    if [[ $WSL -eq 1 && "$NETMODE" == "nat" && "$iface" == eth0 ]]; then
      add_addr "wsl-nat:$iface" "$ip"
    else
      add_addr "$iface" "$ip"
    fi
  done < <(ip -4 -o addr show scope global 2>/dev/null | awk '{print $2, $4}')
  GW=$(ip route show default 2>/dev/null | awk '{print $3; exit}')
fi

if [[ ${#ADDRS[@]} -eq 0 ]]; then
  fail "no IPv4 address found to report"
else
  ok "candidate addresses: $(for a in "${ADDRS[@]}"; do printf '%s=%s ' "${a%%|*}" "${a##*|}"; done)"
fi

HOST_PICK=""
HAVE_TS=0
NAT_IP=""
for a in ${ADDRS[@]+"${ADDRS[@]}"}; do
  label=${a%%|*}
  case "$label" in
    tailscale) HAVE_TS=1 ;;
    wsl-nat:*) [[ -z "$NAT_IP" ]] && NAT_IP=${a##*|} ;;
  esac
  if [[ -z "$HOST_PICK" && "$label" != wsl-nat:* ]]; then
    HOST_PICK=${a##*|}
  fi
done
if [[ -z "$HOST_PICK" && ${#ADDRS[@]} -gt 0 ]]; then
  HOST_PICK=${ADDRS[0]##*|}
  warn "only a NAT'd WSL address is available; Paperclip must reach it through a Windows port proxy"
fi

if [[ $WSL -eq 1 ]]; then
  case "$NETMODE" in
    mirrored) ok "WSL networking mode is mirrored; Windows can reach ${HOST_PICK:-this host} directly" ;;
    nat)
      if [[ $HAVE_TS -eq 1 ]]; then
        ok "WSL networking is nat, but Tailscale is available; dial $HOST_PICK and skip the Windows portproxy"
      else
        warn "WSL networking is nat and no Tailscale address exists; a Windows portproxy + firewall rule is required for port $PORT"
      fi
      ;;
    *) warn "WSL networking mode unknown; verify the address is reachable from the Paperclip server host" ;;
  esac
fi

path_probe() {
  local cmd="$1" out
  out=$(env -i HOME="$HOME" USER="${USER:-$(id -un)}" LOGNAME="${USER:-$(id -un)}" SHELL=/bin/sh \
    PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    sh -c 'if [ -f "$HOME/.profile" ]; then . "$HOME/.profile" >/dev/null 2>&1 || true; fi; if [ -f "$HOME/.bash_profile" ]; then . "$HOME/.bash_profile" >/dev/null 2>&1 || true; elif [ -f "$HOME/.bashrc" ]; then . "$HOME/.bashrc" >/dev/null 2>&1 || true; fi; command -v "$1"' \
    sh "$cmd" 2>/dev/null | tail -n1)
  printf '%s' "$out"
}

HARNESS_PATH=$(path_probe "$HARNESS")
if [[ -n "$HARNESS_PATH" ]]; then
  ok "harness '$HARNESS' resolves in the Paperclip SSH shell: $HARNESS_PATH"
else
  fail "harness '$HARNESS' is not on PATH for a non-interactive SSH command (Paperclip will not find it)"
fi

GIT_PATH=$(path_probe git)
if [[ -n "$GIT_PATH" ]]; then
  ok "git resolves in the Paperclip SSH shell: $GIT_PATH"
else
  warn "git is not on the SSH PATH; project sync and checkouts will fail"
fi

WS_PATH=""
WS_BRANCH=""
WS_COMMIT=""
WS_DIRTY=""
ws="${WORKSPACE:-$PWD}"
if git -C "$ws" rev-parse --show-toplevel >/dev/null 2>&1; then
  WS_PATH=$(git -C "$ws" rev-parse --show-toplevel)
  WS_BRANCH=$(git -C "$ws" rev-parse --abbrev-ref HEAD 2>/dev/null)
  WS_COMMIT=$(git -C "$ws" rev-parse --short HEAD 2>/dev/null)
  if command -v timeout >/dev/null 2>&1; then
    WS_DIRTY=$(timeout 15 git -C "$ws" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
  else
    WS_DIRTY=$(git -C "$ws" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
  fi
  if [[ -z "$WS_DIRTY" ]]; then
    WS_DIRTY="?"
    warn "git status timed out (slow filesystem); the workspace check is incomplete"
  fi
  ok "workspace: $WS_PATH ($WS_BRANCH @ $WS_COMMIT, $WS_DIRTY uncommitted path(s))"
  if [[ -w "$WS_PATH" ]]; then
    ok "workspace is writable by $(id -un)"
  else
    fail "workspace $WS_PATH is not writable by $(id -un)"
  fi
else
  warn "$ws is not a git checkout; pass --workspace PATH to report the real project path"
fi

LIVENESS_CODE=""
if [[ -n "$SERVER_URL" ]]; then
  url="${SERVER_URL%/}"
  case "$url" in
    http://*|https://*) ;;
    *) warn "--server-url has no scheme; assuming https://" ; url="https://$url" ;;
  esac
  CURL_ARGS=(-sS -m 10 -o /dev/null -w '%{http_code}')
  [[ -n "$CA_BUNDLE" ]] && CURL_ARGS+=(--cacert "$CA_BUNDLE")
  [[ $INSECURE -eq 1 ]] && CURL_ARGS+=(-k)
  CURL_ERR=""
  if command -v curl >/dev/null 2>&1; then
    CURL_ERR=$(curl "${CURL_ARGS[@]}" "$url/api/liveness" 2>&1 >/tmp/.pc-liveness.$$)
    CURL_RC=$?
    LIVENESS_CODE=$(cat "/tmp/.pc-liveness.$$" 2>/dev/null)
    rm -f "/tmp/.pc-liveness.$$"
  elif command -v wget >/dev/null 2>&1; then
    WGET_ARGS=(-q -T 10 -O /dev/null)
    [[ $INSECURE -eq 1 ]] && WGET_ARGS+=(--no-check-certificate)
    if wget "${WGET_ARGS[@]}" "$url/api/liveness" 2>/dev/null; then LIVENESS_CODE=200; else LIVENESS_CODE=000; fi
    CURL_RC=0
  else
    LIVENESS_CODE=""
    CURL_RC=-1
  fi
  case "$LIVENESS_CODE" in
    2??) ok "outbound this host -> Paperclip works ($url/api/liveness answered $LIVENESS_CODE)" ;;
    3??) ok "reached Paperclip at $url (HTTP $LIVENESS_CODE redirect); check the redirect target is the app, not a login page" ;;
    401|403) warn "reached Paperclip at $url but it answered HTTP $LIVENESS_CODE; check the host allowlist or a proxy that blocks /api/liveness" ;;
    503) warn "reached Paperclip at $url but it reports 503 (starting); connectivity is fine" ;;
    000|"")
      case "$CURL_RC" in
        6) fail "DNS lookup failed for $url; the agent cannot call back to PAPERCLIP_API_URL" ;;
        60|35|51) fail "TLS trust/handshake failed for $url; retry with --ca-bundle PATH or --insecure for a self-signed proxy" ;;
        28) fail "timed out reaching $url; the agent cannot call back to PAPERCLIP_API_URL" ;;
        5) fail "proxy resolution failed for $url; check http_proxy/https_proxy on this host" ;;
        -1) warn "neither curl nor wget is installed; skipped the outbound check" ;;
        *) fail "cannot reach Paperclip at $url (curl exit $CURL_RC)${CURL_ERR:+: $CURL_ERR}" ;;
      esac
      ;;
    *) warn "Paperclip at $url answered HTTP $LIVENESS_CODE; check host/proxy allowlists" ;;
  esac
else
  warn "no --server-url given; skipped the this-host -> Paperclip outbound check"
fi

HOSTKEY_FILE=""
for f in /etc/ssh/ssh_host_ed25519_key.pub /etc/ssh/ssh_host_ecdsa_key.pub /etc/ssh/ssh_host_rsa_key.pub; do
  if [[ -r "$f" ]]; then HOSTKEY_FILE="$f"; break; fi
done

KNOWN_HOSTS_LINE=""
HOSTKEY_FP=""
if [[ -n "$HOSTKEY_FILE" && -n "$HOST_PICK" ]]; then
  hk_type=$(awk '{print $1}' "$HOSTKEY_FILE")
  hk_blob=$(awk '{print $2}' "$HOSTKEY_FILE")
  if [[ "$PORT" == "22" ]]; then
    KNOWN_HOSTS_LINE="$HOST_PICK $hk_type $hk_blob"
  else
    KNOWN_HOSTS_LINE="[$HOST_PICK]:$PORT $hk_type $hk_blob"
  fi
  if command -v ssh-keygen >/dev/null 2>&1; then
    HOSTKEY_FP=$(ssh-keygen -lf "$HOSTKEY_FILE" 2>/dev/null | awk '{print $2}')
  fi
  ok "host key: ${HOSTKEY_FP:-unknown} ($hk_type)"
else
  warn "could not read the sshd host public key; paste knownHosts manually or disable strict checking"
fi

json_escape() {
  printf '%s' "$1" | tr -d '\r' | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/\t/\\t/g'
}

if [[ $JSON -eq 1 ]]; then
  ready=true
  [[ $FAILS -gt 0 ]] && ready=false
  printf '{"ready":%s,"port":%s,"username":"%s","workspace":"%s","branch":"%s","commit":"%s","dirtyPaths":%s,"wsl":%s,"wslNetworking":"%s","host":%s,"knownHosts":%s,"hostKeyFingerprint":%s,"harnessPath":%s,"paperclipLiveness":%s,"addresses":[' \
    "$ready" "$PORT" "$(json_escape "$(id -un)")" "$(json_escape "$WS_PATH")" "$(json_escape "$WS_BRANCH")" \
    "$(json_escape "$WS_COMMIT")" "${WS_DIRTY:-null}" "$([[ $WSL -eq 1 ]] && printf true || printf false)" \
    "$(json_escape "$NETMODE")" "$([[ -n "$HOST_PICK" ]] && printf '"%s"' "$(json_escape "$HOST_PICK")" || printf null)" \
    "$([[ -n "$KNOWN_HOSTS_LINE" ]] && printf '"%s"' "$(json_escape "$KNOWN_HOSTS_LINE")" || printf null)" \
    "$([[ -n "$HOSTKEY_FP" ]] && printf '"%s"' "$(json_escape "$HOSTKEY_FP")" || printf null)" \
    "$([[ -n "$HARNESS_PATH" ]] && printf '"%s"' "$(json_escape "$HARNESS_PATH")" || printf null)" \
    "$([[ -n "$LIVENESS_CODE" ]] && printf '"%s"' "$(json_escape "$LIVENESS_CODE")" || printf null)"
  first=1
  for a in ${ADDRS[@]+"${ADDRS[@]}"}; do
    [[ $first -eq 1 ]] || printf ','
    first=0
    printf '{"label":"%s","address":"%s"}' "$(json_escape "${a%%|*}")" "$(json_escape "${a##*|}")"
  done
  printf '],"checks":['
  first=1
  for r in ${RECORDS[@]+"${RECORDS[@]}"}; do
    [[ $first -eq 1 ]] || printf ','
    first=0
    printf '{"status":"%s","message":"%s"}' "${r%%|*}" "$(json_escape "${r#*|}")"
  done
  printf ']}\n'
else
  printf '\nPaperclip SSH executor report\n'
  printf '=============================\n'
  for r in ${RECORDS[@]+"${RECORDS[@]}"}; do
    case "${r%%|*}" in
      ok) printf '  [ok]   %s\n' "${r#*|}" ;;
      warn) printf '  [warn] %s\n' "${r#*|}" ;;
      fail) printf '  [FAIL] %s\n' "${r#*|}" ;;
    esac
  done
  printf '\n  %d ok, %d warning(s), %d failure(s)\n' "$OKS" "$WARNS" "$FAILS"

  printf '\nENVIRONMENT (paste into Paperclip)\n'
  printf '%s\n' '----------------------------------'
  printf '  driver                = ssh\n'
  printf '  host                  = %s\n' "${HOST_PICK:-<fill in>}"
  printf '  port                  = %s\n' "$PORT"
  printf '  username              = %s\n' "$(id -un)"
  printf '  remoteWorkspacePath   = %s\n' "${WS_PATH:-<fill in>}"
  printf '  privateKey            = <the Paperclip-side PRIVATE key; never paste it here>\n'
  printf '  knownHosts            = %s\n' "${KNOWN_HOSTS_LINE:-<paste the line below>}"
  printf '  strictHostKeyChecking = true\n'

  if [[ -n "$KNOWN_HOSTS_LINE" ]]; then
    printf '\n  known_hosts line (verify the fingerprint on both sides):\n'
    printf '    %s\n' "$KNOWN_HOSTS_LINE"
    [[ -n "$HOSTKEY_FP" ]] && printf '    fingerprint %s\n' "$HOSTKEY_FP"
  fi

  if [[ $WSL -eq 1 && $HAVE_TS -eq 0 && "$NETMODE" != "mirrored" ]]; then
    printf '\nWSL NAT notes (run on Windows, in an elevated shell)\n'
    printf '%s\n' '--------------------------------------------------'
    printf '  netsh interface portproxy add v4tov4 listenport=%s listenaddress=0.0.0.0 connectport=%s connectaddress=%s\n' \
      "$PORT" "$PORT" "${NAT_IP:-${HOST_PICK:-<wsl-ip>}}"
    printf '  netsh advfirewall firewall add rule name="paperclip-sshd-%s" dir=in action=allow protocol=TCP localport=%s\n' \
      "$PORT" "$PORT"
    printf '  a portproxy pins the rule to one WSL IP; prefer Tailscale or mirrored networking\n'
  fi

  if [[ -n "$GW" ]]; then
    printf '\n  default gateway = %s\n' "$GW"
  fi

  printf '\n  the address above must be reachable from the Paperclip server process\n'
  printf '  (if Paperclip runs in Docker, from its container network - not from the Windows host)\n'
  if [[ -n "$SERVER_URL" ]]; then
    printf '\n  server-side: set PAPERCLIP_API_URL=%s on the Paperclip server\n' "${SERVER_URL%/}"
    printf '  so the remote agent calls back to this origin instead of container-localhost\n'
  fi

  if [[ $FAILS -gt 0 ]]; then
    printf '\n  NOT READY: fix the [FAIL] lines, then re-run this script.\n'
  else
    printf '\n  READY: create or update the environment in Paperclip, then run Test.\n'
  fi
fi

[[ $FAILS -gt 0 ]] && exit 1
exit 0
