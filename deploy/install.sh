#!/usr/bin/env bash
# =============================================================================
# WindowPtero - cai dat panel tren VPS Linux
# Ho tro: Debian / Ubuntu / RHEL / Rocky / AlmaLinux (x86_64, arm64)
#
# Chay:
#   sudo bash deploy/install.sh
#
# Bien moi truong tuy chon:
#   WP_INSTALL_DIR   thu muc cai dat        (mac dinh /opt/windowptero)
#   WP_SERVICE_USER  user chay panel        (mac dinh windowptero)
#   WP_ACCESS        port | tunnel | both   (mac dinh both)
#   WP_PORT          cong panel             (mac dinh 2008)
#
# Script KHONG ghi de .env, data/ va volumes/ neu da ton tai.
# =============================================================================
set -euo pipefail

INSTALL_DIR="${WP_INSTALL_DIR:-/opt/windowptero}"
SERVICE_USER="${WP_SERVICE_USER:-windowptero}"
ACCESS="${WP_ACCESS:-both}"
PORT="${WP_PORT:-2008}"

SERVICE_NAME="windowptero"
TUNNEL_SERVICE="windowptero-tunnel"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="$INSTALL_DIR/runtime"
INFO_FILE="$INSTALL_DIR/_THONG-TIN-TRUY-CAP.txt"
TUNNEL_LOG="$INSTALL_DIR/_tunnel.log"

NODE_BIN=""
NPM_BIN=""
JAVA_BIN=""
PKG=""
ADMIN_USER="admin"
ADMIN_PASS=""
TUNNEL_LINK=""

# ---------- tien ich in ra man hinh ----------
c_info() { printf '\033[36m[ * ]\033[0m %s\n' "$*"; }
c_ok()   { printf '\033[32m[ OK ]\033[0m %s\n' "$*"; }
c_warn() { printf '\033[33m[ ! ]\033[0m %s\n' "$*"; }
c_err()  { printf '\033[31m[ X ]\033[0m %s\n' "$*" >&2; }
die()    { c_err "$*"; exit 1; }
have()   { command -v "$1" >/dev/null 2>&1; }

banner() {
  echo
  echo "============================================="
  echo "   WindowPtero - cai dat tren Linux"
  echo "============================================="
  echo "  Thu muc cai  : $INSTALL_DIR"
  echo "  User chay    : $SERVICE_USER"
  echo "  Cong panel   : $PORT"
  echo "  Cach truy cap: $ACCESS"
  echo
}

need_root() {
  [ "$(id -u)" -eq 0 ] || die "Phai chay bang quyen root: sudo bash deploy/install.sh"
}

check_systemd() {
  have systemctl || die "May nay khong dung systemd. Script nay chi ho tro systemd."
}

detect_pkg() {
  if have apt-get; then PKG="apt"
  elif have dnf; then PKG="dnf"
  elif have yum; then PKG="yum"
  else PKG=""; c_warn "Khong nhan ra trinh quan ly goi, se bo qua buoc cai goi he thong"
  fi
}

pkg_install() {
  [ -n "$PKG" ] || return 0
  case "$PKG" in
    apt)
      DEBIAN_FRONTEND=noninteractive apt-get update -qq || true
      DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$@" >/dev/null 2>&1 || return 1
      ;;
    dnf) dnf install -y -q "$@" >/dev/null 2>&1 || return 1 ;;
    yum) yum install -y -q "$@" >/dev/null 2>&1 || return 1 ;;
  esac
  return 0
}

ensure_basics() {
  local missing=()
  have curl || missing+=(curl)
  have tar  || missing+=(tar)
  have xz   || missing+=(xz-utils)
  if [ ${#missing[@]} -gt 0 ]; then
    c_info "Cai goi co ban: ${missing[*]}"
    if [ "$PKG" = "dnf" ] || [ "$PKG" = "yum" ]; then
      pkg_install curl tar xz || true
    else
      pkg_install "${missing[@]}" || true
    fi
  fi
  have curl || die "Thieu curl, hay cai thu cong roi chay lai"
  have tar  || die "Thieu tar, hay cai thu cong roi chay lai"
}

arch_node() {
  case "$(uname -m)" in
    x86_64|amd64) echo "linux-x64" ;;
    aarch64|arm64) echo "linux-arm64" ;;
    *) echo "" ;;
  esac
}

arch_temurin() {
  case "$(uname -m)" in
    x86_64|amd64) echo "x64" ;;
    aarch64|arm64) echo "aarch64" ;;
    *) echo "" ;;
  esac
}

# ---------- Node.js ----------
node_major_ok() {
  local bin="$1"
  local major
  major="$("$bin" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  [ "$major" -ge 18 ] 2>/dev/null
}

ensure_node() {
  if have node && node_major_ok "$(command -v node)"; then
    NODE_BIN="$(command -v node)"
    c_ok "Da co Node $(node -v) tai $NODE_BIN"
  elif [ -x "$RUNTIME_DIR/node/bin/node" ] && node_major_ok "$RUNTIME_DIR/node/bin/node"; then
    NODE_BIN="$RUNTIME_DIR/node/bin/node"
    c_ok "Dung Node rieng da cai truoc do: $NODE_BIN"
  else
    local arch tarname url
    arch="$(arch_node)"
    [ -n "$arch" ] || die "Kien truc $(uname -m) chua duoc ho tro"
    c_info "Chua co Node >= 18, dang tai Node 22 LTS ($arch)..."
    tarname="$(curl -fsSL https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt \
      | grep -o "node-v[0-9.]*-${arch}\\.tar\\.xz" | head -n1)"
    [ -n "$tarname" ] || die "Khong lay duoc ten ban Node moi nhat tu nodejs.org"
    url="https://nodejs.org/dist/latest-v22.x/$tarname"
    curl -fL --retry 3 -o "/tmp/$tarname" "$url" || die "Tai Node that bai: $url"
    mkdir -p "$RUNTIME_DIR/node"
    rm -rf "${RUNTIME_DIR:?}/node"; mkdir -p "$RUNTIME_DIR/node"
    tar -xJf "/tmp/$tarname" -C "$RUNTIME_DIR/node" --strip-components=1
    rm -f "/tmp/$tarname"
    NODE_BIN="$RUNTIME_DIR/node/bin/node"
    [ -x "$NODE_BIN" ] || die "Giai nen Node xong nhung khong thay $NODE_BIN"
    c_ok "Da cai Node $("$NODE_BIN" -v) vao $RUNTIME_DIR/node"
  fi

  NPM_BIN="$(dirname "$NODE_BIN")/npm"
  [ -x "$NPM_BIN" ] || NPM_BIN="$(command -v npm || true)"
  [ -n "$NPM_BIN" ] || die "Khong tim thay npm di kem Node"
}

# ---------- Java ----------
ensure_java() {
  if have java; then
    JAVA_BIN="$(command -v java)"
    c_ok "Da co Java: $(java -version 2>&1 | head -n1)"
    return
  fi
  if [ -x "$RUNTIME_DIR/jre21/bin/java" ]; then
    JAVA_BIN="$RUNTIME_DIR/jre21/bin/java"
    c_ok "Dung Java rieng da cai truoc do: $JAVA_BIN"
    return
  fi

  c_info "Chua co Java, thu cai OpenJDK 21 tu kho he thong..."
  case "$PKG" in
    apt) pkg_install openjdk-21-jre-headless || true ;;
    dnf|yum) pkg_install java-21-openjdk-headless || true ;;
  esac
  if have java; then
    JAVA_BIN="$(command -v java)"
    c_ok "Da cai Java he thong: $(java -version 2>&1 | head -n1)"
    return
  fi

  local arch url
  arch="$(arch_temurin)"
  [ -n "$arch" ] || die "Kien truc $(uname -m) chua duoc ho tro cho Temurin"
  c_info "Kho he thong khong co JDK 21, tai Temurin JRE 21 ($arch)..."
  url="https://api.adoptium.net/v3/binary/latest/21/ga/linux/$arch/jre/hotspot/normal/eclipse"
  curl -fL --retry 3 -o /tmp/jre21.tar.gz "$url" || die "Tai Temurin JRE that bai"
  rm -rf "${RUNTIME_DIR:?}/jre21"; mkdir -p "$RUNTIME_DIR/jre21"
  tar -xzf /tmp/jre21.tar.gz -C "$RUNTIME_DIR/jre21" --strip-components=1
  rm -f /tmp/jre21.tar.gz
  JAVA_BIN="$RUNTIME_DIR/jre21/bin/java"
  [ -x "$JAVA_BIN" ] || die "Giai nen JRE xong nhung khong thay $JAVA_BIN"
  c_ok "Da cai Temurin JRE 21 vao $RUNTIME_DIR/jre21"
}

# ---------- user he thong ----------
ensure_user() {
  if id -u "$SERVICE_USER" >/dev/null 2>&1; then
    c_ok "User $SERVICE_USER da ton tai"
  else
    c_info "Tao user he thong $SERVICE_USER (khong login duoc)"
    useradd --system --home-dir "$INSTALL_DIR" --shell /usr/sbin/nologin "$SERVICE_USER" 2>/dev/null \
      || useradd --system --home-dir "$INSTALL_DIR" --shell /sbin/nologin "$SERVICE_USER"
    c_ok "Da tao user $SERVICE_USER"
  fi
}

# ---------- copy source ----------
copy_panel() {
  mkdir -p "$INSTALL_DIR"
  if [ "$SRC_DIR" = "$INSTALL_DIR" ]; then
    c_warn "Dang chay ngay trong thu muc cai dat -> bo qua buoc copy"
  else
    c_info "Copy panel: $SRC_DIR -> $INSTALL_DIR"
    tar -C "$SRC_DIR" \
      --exclude=./node_modules \
      --exclude=./.git \
      --exclude=./.oatami \
      --exclude=./volumes \
      --exclude=./data \
      --exclude=./runtime \
      --exclude=./.env \
      --exclude=./_testsrv \
      --exclude='./*.bak' \
      --exclude='./*.log' \
      --exclude='./_*' \
      -cf - . | tar -C "$INSTALL_DIR" -xf -
    c_ok "Da copy source"
  fi
  mkdir -p "$INSTALL_DIR/data" "$INSTALL_DIR/volumes"
}

install_deps() {
  c_info "Cai thu vien Node (npm install --omit=dev)..."
  ( cd "$INSTALL_DIR" && PATH="$(dirname "$NODE_BIN"):$PATH" "$NPM_BIN" install --omit=dev --no-audit --no-fund >/dev/null )
  c_ok "Da cai thu vien"
}

# ---------- .env ----------
write_env() {
  local envf="$INSTALL_DIR/.env" bind="0.0.0.0"
  [ "$ACCESS" = "tunnel" ] && bind="127.0.0.1"

  if [ -f "$envf" ]; then
    c_warn ".env da ton tai -> giu nguyen, KHONG doi mat khau"
    ADMIN_PASS="(giu nguyen mat khau cu trong .env)"
    ADMIN_USER="$(grep -E '^WP_ADMIN_USER=' "$envf" | head -n1 | cut -d= -f2- || echo admin)"
    [ -n "$ADMIN_USER" ] || ADMIN_USER="admin"
    return
  fi

  ADMIN_PASS="$(head -c 128 /dev/urandom | tr -dc 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789' | head -c 20)"
  c_info "Tao .env voi mat khau admin ngau nhien"
  cat > "$envf" <<EOF
# File nay do deploy/install.sh sinh ra. Chua mat khau -> KHONG gui cho ai.
WP_PORT=$PORT
WP_HOST=$bind

WP_ADMIN_USER=$ADMIN_USER
WP_ADMIN_PASS=$ADMIN_PASS

# =1 khi panel dung sau HTTPS (Cloudflare Tunnel, nginx, Caddy)
WP_HTTPS=0

# So tang proxy tin cay (nginx/Cloudflare = 1)
# WP_TRUST_PROXY=1

# Cach truy cap: port | tunnel | both
WP_ACCESS=$ACCESS

# 2GB moi file
WP_MAX_UPLOAD_BYTES=2147483648
WP_MAX_UPLOAD_FILES=20
EOF
  chmod 600 "$envf"
  c_ok "Da tao .env (chmod 600)"
}

fix_perms() {
  chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"
  chmod 750 "$INSTALL_DIR"
  [ -f "$INSTALL_DIR/.env" ] && chmod 600 "$INSTALL_DIR/.env"
  c_ok "Da set quyen thu muc cho $SERVICE_USER"
}

# ---------- systemd ----------
write_service() {
  local svc_path="/etc/systemd/system/$SERVICE_NAME.service"
  local extra_path=""
  extra_path="$(dirname "$NODE_BIN")"
  [ -n "$JAVA_BIN" ] && extra_path="$extra_path:$(dirname "$JAVA_BIN")"

  c_info "Tao systemd service: $SERVICE_NAME"
  cat > "$svc_path" <<EOF
[Unit]
Description=WindowPtero - panel quan ly server Minecraft
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_USER
WorkingDirectory=$INSTALL_DIR
ExecStart=$NODE_BIN $INSTALL_DIR/server.js
Environment=NODE_ENV=production
Environment=PATH=$extra_path:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=$INSTALL_DIR
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable "$SERVICE_NAME" >/dev/null 2>&1 || true
  systemctl restart "$SERVICE_NAME"
  c_ok "Panel da duoc dang ky chay khi boot"
}

# ---------- firewall ----------
open_firewall() {
  if [ "$ACCESS" = "tunnel" ]; then
    c_info "Che do tunnel -> khong mo cong ra ngoai"
    return
  fi
  if have ufw && ufw status 2>/dev/null | grep -q "Status: active"; then
    ufw allow "$PORT"/tcp >/dev/null 2>&1 && c_ok "ufw: da mo cong $PORT/tcp"
  elif have firewall-cmd && systemctl is-active --quiet firewalld; then
    firewall-cmd --permanent --add-port="$PORT"/tcp >/dev/null 2>&1 || true
    firewall-cmd --reload >/dev/null 2>&1 || true
    c_ok "firewalld: da mo cong $PORT/tcp"
  else
    c_warn "Khong thay ufw/firewalld dang bat. Neu nha cung cap VPS co firewall rieng, nho mo cong $PORT"
  fi
}

# ---------- cloudflared ----------
ensure_cloudflared() {
  local bin="$RUNTIME_DIR/cloudflared" arch url
  if [ -x "$bin" ]; then c_ok "Da co cloudflared"; return; fi
  case "$(uname -m)" in
    x86_64|amd64) arch="amd64" ;;
    aarch64|arm64) arch="arm64" ;;
    *) c_warn "Kien truc $(uname -m) khong co ban cloudflared, bo qua tunnel"; return 1 ;;
  esac
  url="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-$arch"
  c_info "Tai cloudflared ($arch)..."
  mkdir -p "$RUNTIME_DIR"
  curl -fL --retry 3 -o "$bin" "$url" || { c_warn "Tai cloudflared that bai, bo qua tunnel"; return 1; }
  chmod +x "$bin"
  c_ok "Da tai cloudflared"
}

write_tunnel_service() {
  local svc_path="/etc/systemd/system/$TUNNEL_SERVICE.service"
  : > "$TUNNEL_LOG"
  chown "$SERVICE_USER:$SERVICE_USER" "$TUNNEL_LOG"

  c_info "Tao systemd service: $TUNNEL_SERVICE"
  cat > "$svc_path" <<EOF
[Unit]
Description=WindowPtero - Cloudflare Tunnel
After=network-online.target $SERVICE_NAME.service
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_USER
WorkingDirectory=$INSTALL_DIR
ExecStart=$RUNTIME_DIR/cloudflared tunnel --no-autoupdate --url http://127.0.0.1:$PORT
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=$INSTALL_DIR
StandardOutput=append:$TUNNEL_LOG
StandardError=append:$TUNNEL_LOG

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable "$TUNNEL_SERVICE" >/dev/null 2>&1 || true
  systemctl restart "$TUNNEL_SERVICE"
}

get_tunnel_link() {
  local i link=""
  c_info "Cho Cloudflare cap link (toi da 60 giay)..."
  for i in $(seq 1 30); do
    link="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" 2>/dev/null | tail -n1 || true)"
    [ -n "$link" ] && break
    sleep 2
  done
  TUNNEL_LINK="$link"
  if [ -n "$TUNNEL_LINK" ]; then
    c_ok "Link tunnel: $TUNNEL_LINK"
  else
    c_warn "Chua lay duoc link. Xem lai: cat $TUNNEL_LOG"
  fi
}

write_helper_scripts() {
  cat > "$INSTALL_DIR/xem-link.sh" <<EOF
#!/usr/bin/env bash
# In ra link tunnel hien tai (link doi moi lan tunnel khoi dong lai)
grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" 2>/dev/null | tail -n1 \\
  || echo "Chua co link. Kiem tra: systemctl status $TUNNEL_SERVICE"
EOF
  chmod +x "$INSTALL_DIR/xem-link.sh"
  chown "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR/xem-link.sh"
}

wait_health() {
  local i
  c_info "Kiem tra panel co song khong (toi da 60 giay)..."
  for i in $(seq 1 30); do
    if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
      c_ok "Panel da tra loi health check"
      return 0
    fi
    sleep 2
  done
  c_warn "Panel chua tra loi. Xem log: journalctl -u $SERVICE_NAME -n 50 --no-pager"
  return 1
}

lan_ip() {
  hostname -I 2>/dev/null | awk '{print $1}' || echo ""
}

write_info() {
  local ip
  ip="$(lan_ip)"
  {
    echo "WindowPtero - thong tin truy cap"
    echo "Sinh luc: $(date '+%Y-%m-%d %H:%M:%S')"
    echo
    echo "Tai khoan : $ADMIN_USER"
    echo "Mat khau  : $ADMIN_PASS"
    echo
    [ -n "$ip" ] && echo "Trong mang: http://$ip:$PORT"
    echo "Tren may  : http://127.0.0.1:$PORT"
    [ -n "$TUNNEL_LINK" ] && echo "Link public: $TUNNEL_LINK  (doi moi lan tunnel restart)"
    echo
    echo "Lenh hay dung:"
    echo "  systemctl status $SERVICE_NAME"
    echo "  systemctl restart $SERVICE_NAME"
    echo "  journalctl -u $SERVICE_NAME -f"
    echo "  bash $INSTALL_DIR/xem-link.sh"
    echo
    echo "Doi mat khau: sua WP_ADMIN_PASS trong $INSTALL_DIR/.env,"
    echo "xoa $INSTALL_DIR/data/auth.json roi systemctl restart $SERVICE_NAME"
  } > "$INFO_FILE"
  chmod 600 "$INFO_FILE"
  chown "$SERVICE_USER:$SERVICE_USER" "$INFO_FILE"
}

summary() {
  local ip
  ip="$(lan_ip)"
  echo
  echo "============================================="
  echo "   CAI DAT XONG"
  echo "============================================="
  echo "  Tai khoan : $ADMIN_USER"
  echo "  Mat khau  : $ADMIN_PASS"
  echo
  [ -n "$ip" ] && echo "  Trong mang : http://$ip:$PORT"
  echo "  Tren may   : http://127.0.0.1:$PORT"
  [ -n "$TUNNEL_LINK" ] && echo "  Link public: $TUNNEL_LINK"
  echo
  echo "  Da luu vao : $INFO_FILE"
  echo "  Xem log    : journalctl -u $SERVICE_NAME -f"
  echo "  Go cai dat : sudo bash deploy/uninstall.sh"
  echo "============================================="
  echo
}

main() {
  need_root
  check_systemd
  banner
  detect_pkg
  ensure_basics
  ensure_node
  ensure_java
  ensure_user
  copy_panel
  install_deps
  write_env
  fix_perms
  write_service
  open_firewall

  if [ "$ACCESS" = "tunnel" ] || [ "$ACCESS" = "both" ]; then
    if ensure_cloudflared; then
      write_tunnel_service
      get_tunnel_link
    fi
  fi

  write_helper_scripts
  wait_health || true
  write_info
  summary
}

main "$@"
