#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/neon-arena"
APP_USER="neonarena"
SERVICE_NAME="neon-arena"
DOMAIN=""
ENABLE_SSL=0

usage() {
  echo "Usage: sudo bash install.sh --domain game.example.com [--ssl]"
  echo "       sudo bash install.sh --domain SERVER_IP"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain) DOMAIN="${2:-}"; shift 2 ;;
    --ssl) ENABLE_SSL=1; shift ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown option: $1"; usage; exit 1 ;;
  esac
done

if [[ "${EUID}" -ne 0 ]]; then
  echo "Please run with sudo: sudo bash install.sh --domain YOUR_DOMAIN_OR_IP"
  exit 1
fi

if [[ -z "${DOMAIN}" ]]; then
  DOMAIN="$(hostname -I | awk '{print $1}')"
fi

if [[ -z "${DOMAIN}" ]]; then
  echo "Could not detect a server address. Pass --domain explicitly."
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ ! -f "${SCRIPT_DIR}/server/main.py" ]]; then
  echo "Run install.sh from the extracted Neon Arena project directory."
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y python3 python3-venv python3-pip nginx curl

if ! id "${APP_USER}" >/dev/null 2>&1; then
  useradd --system --home "${APP_DIR}" --shell /usr/sbin/nologin "${APP_USER}"
fi

install -d -o "${APP_USER}" -g "${APP_USER}" "${APP_DIR}"
install -d -o "${APP_USER}" -g "${APP_USER}" "${APP_DIR}/server"
cp -a "${SCRIPT_DIR}/server/." "${APP_DIR}/server/"
chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"

python3 -m venv "${APP_DIR}/venv"
"${APP_DIR}/venv/bin/pip" install --upgrade pip
"${APP_DIR}/venv/bin/pip" install -r "${APP_DIR}/server/requirements.txt"
chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}/venv"

sed "s|__APP_DIR__|${APP_DIR}|g" "${SCRIPT_DIR}/deploy/neon-arena.service" > "/etc/systemd/system/${SERVICE_NAME}.service"
sed "s|__DOMAIN__|${DOMAIN}|g" "${SCRIPT_DIR}/deploy/nginx.conf.template" > "/etc/nginx/sites-available/${SERVICE_NAME}"
ln -sfn "/etc/nginx/sites-available/${SERVICE_NAME}" "/etc/nginx/sites-enabled/${SERVICE_NAME}"
rm -f /etc/nginx/sites-enabled/default

systemctl daemon-reload
systemctl enable "${SERVICE_NAME}"
systemctl restart "${SERVICE_NAME}"
nginx -t
systemctl reload nginx

SCHEME="http"
if [[ "${ENABLE_SSL}" -eq 1 ]]; then
  if [[ "${DOMAIN}" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "SSL was skipped because Let's Encrypt needs a domain, not an IP address."
  else
    apt-get install -y certbot python3-certbot-nginx
    if certbot --nginx -d "${DOMAIN}" --non-interactive --agree-tos --register-unsafely-without-email --redirect; then
      SCHEME="https"
    else
      echo "SSL setup failed; the game remains available over HTTP."
    fi
  fi
fi

if curl -fsS http://127.0.0.1:8765/health >/dev/null; then
  echo
  echo "Neon Arena is ready:"
  echo "${SCHEME}://${DOMAIN}"
else
  echo "Installation finished, but the health check failed."
  echo "Check: journalctl -u ${SERVICE_NAME} -n 100 --no-pager"
  exit 1
fi
