#!/usr/bin/env bash
# =============================================================================
# WindowPtero - go cai dat tren Linux
#
# Chay:
#   sudo bash deploy/uninstall.sh          # go panel, GIU LAI world + tai khoan
#   sudo WP_KEEP_DATA=0 bash deploy/uninstall.sh   # xoa sach ca world
#
# Bien tuy chon: WP_INSTALL_DIR, WP_SERVICE_USER, WP_KEEP_DATA (1 = giu, 0 = xoa)
# =============================================================================
set -euo pipefail

INSTALL_DIR="${WP_INSTALL_DIR:-/opt/windowptero}"
SERVICE_USER="${WP_SERVICE_USER:-windowptero}"
KEEP_DATA="${WP_KEEP_DATA:-1}"

SERVICE_NAME="windowptero"
TUNNEL_SERVICE="windowptero-tunnel"

c_info() { printf '\033[36m[ * ]\033[0m %s\n' "$*"; }
c_ok()   { printf '\033[32m[ OK ]\033[0m %s\n' "$*"; }
c_warn() { printf '\033[33m[ ! ]\033[0m %s\n' "$*"; }
die()    { printf '\033[31m[ X ]\033[0m %s\n' "$*" >&2; exit 1; }
have()   { command -v "$1" >/dev/null 2>&1; }

[ "$(id -u)" -eq 0 ] || die "Phai chay bang quyen root: sudo bash deploy/uninstall.sh"
have systemctl || die "May nay khong dung systemd"

echo
echo "============================================="
echo "   WindowPtero - go cai dat"
echo "============================================="
echo "  Thu muc : $INSTALL_DIR"
echo "  Giu data: $([ "$KEEP_DATA" = "1" ] && echo 'CO (giu world + tai khoan)' || echo 'KHONG (xoa sach)')"
echo

stop_service() {
  local name="$1"
  if systemctl list-unit-files 2>/dev/null | grep -q "^$name.service"; then
    c_info "Dung va go service $name"
    systemctl disable --now "$name" >/dev/null 2>&1 || true
    rm -f "/etc/systemd/system/$name.service"
    c_ok "Da go $name"
  fi
}

stop_service "$TUNNEL_SERVICE"
stop_service "$SERVICE_NAME"
systemctl daemon-reload
systemctl reset-failed >/dev/null 2>&1 || true

# Dong cong tren firewall neu truoc do co mo
PORT="$(grep -E '^WP_PORT=' "$INSTALL_DIR/.env" 2>/dev/null | head -n1 | cut -d= -f2- || true)"
PORT="${PORT:-2008}"
if have ufw && ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw delete allow "$PORT"/tcp >/dev/null 2>&1 && c_ok "ufw: da dong cong $PORT" || true
elif have firewall-cmd && systemctl is-active --quiet firewalld; then
  firewall-cmd --permanent --remove-port="$PORT"/tcp >/dev/null 2>&1 || true
  firewall-cmd --reload >/dev/null 2>&1 || true
  c_ok "firewalld: da dong cong $PORT"
fi

if [ ! -d "$INSTALL_DIR" ]; then
  c_warn "Khong thay $INSTALL_DIR, chi go service"
elif [ "$KEEP_DATA" = "1" ]; then
  c_info "Xoa code, GIU LAI data/ va volumes/"
  find "$INSTALL_DIR" -mindepth 1 -maxdepth 1 \
    ! -name data ! -name volumes \
    -exec rm -rf {} + 2>/dev/null || true
  c_ok "Da xoa code. World va tai khoan van con o: $INSTALL_DIR"
  c_warn "Muon xoa not thi: rm -rf $INSTALL_DIR"
else
  c_info "Xoa toan bo $INSTALL_DIR"
  rm -rf "${INSTALL_DIR:?}"
  c_ok "Da xoa sach"
  if id -u "$SERVICE_USER" >/dev/null 2>&1; then
    userdel "$SERVICE_USER" >/dev/null 2>&1 && c_ok "Da xoa user $SERVICE_USER" || true
  fi
fi

echo
c_ok "Xong."
echo
