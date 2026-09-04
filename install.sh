#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/neon-arena"
APP_USER="neonarena"
SERVICE_NAME="neon-arena"
DOMAIN=""
ENABLE_SSL=0
BUILD_ANDROID=1
GRADLE_VERSION="8.7"
ANDROID_CLI_VERSION="15859902"
ANDROID_CLI_SHA256="4e4c464f145a7512b57d088ac6c278c03c9eea610886b35a5e0804e74eedf583"
ANDROID_SDK_ROOT="/opt/android-sdk"

usage() {
  echo "Usage: sudo bash install.sh --domain game.example.com [--ssl] [--skip-android]"
  echo "       sudo bash install.sh --domain SERVER_IP"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain) DOMAIN="${2:-}"; shift 2 ;;
    --ssl) ENABLE_SSL=1; shift ;;
    --skip-android) BUILD_ANDROID=0; shift ;;
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
apt-get install -y git python3 python3-venv python3-pip nginx curl wget unzip ca-certificates openjdk-17-jdk-headless

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

if [[ "${BUILD_ANDROID}" -eq 1 ]]; then
  echo "Installing the Android build toolchain..."
  BUILD_TMP="$(mktemp -d /tmp/neon-arena-android.XXXXXX)"
  trap 'rm -rf "${BUILD_TMP}"' EXIT

  if [[ ! -x "/opt/gradle-${GRADLE_VERSION}/bin/gradle" ]]; then
    wget -q --show-progress -O "${BUILD_TMP}/gradle.zip" \
      "https://services.gradle.org/distributions/gradle-${GRADLE_VERSION}-bin.zip"
    unzip -q "${BUILD_TMP}/gradle.zip" -d /opt
  fi
  ln -sfn "/opt/gradle-${GRADLE_VERSION}/bin/gradle" /usr/local/bin/gradle

  if [[ ! -x "${ANDROID_SDK_ROOT}/cmdline-tools/latest/bin/android" ]]; then
    install -d "${ANDROID_SDK_ROOT}/cmdline-tools"
    wget -q --show-progress -O "${BUILD_TMP}/commandlinetools.zip" \
      "https://dl.google.com/android/repository/commandlinetools-linux-${ANDROID_CLI_VERSION}_latest.zip"
    echo "${ANDROID_CLI_SHA256}  ${BUILD_TMP}/commandlinetools.zip" | sha256sum -c -
    unzip -q "${BUILD_TMP}/commandlinetools.zip" -d "${BUILD_TMP}/commandlinetools"
    if [[ -d "${ANDROID_SDK_ROOT}/cmdline-tools/latest" ]]; then
      mv "${ANDROID_SDK_ROOT}/cmdline-tools/latest" \
        "${ANDROID_SDK_ROOT}/cmdline-tools/previous-$(date +%Y%m%d-%H%M%S)"
    fi
    mv "${BUILD_TMP}/commandlinetools/cmdline-tools" \
      "${ANDROID_SDK_ROOT}/cmdline-tools/latest"
  fi

  export ANDROID_HOME="${ANDROID_SDK_ROOT}"
  export ANDROID_SDK_ROOT
  export JAVA_HOME="/usr/lib/jvm/java-17-openjdk-amd64"
  export PATH="${JAVA_HOME}/bin:/opt/gradle-${GRADLE_VERSION}/bin:${ANDROID_SDK_ROOT}/cmdline-tools/latest/bin:${ANDROID_SDK_ROOT}/platform-tools:${PATH}"

  set +o pipefail
  yes | android --sdk="${ANDROID_SDK_ROOT}" sdk install \
    platform-tools platforms/android-35 build-tools/34.0.0 build-tools/35.0.0
  ANDROID_INSTALL_STATUS="${PIPESTATUS[1]}"
  set -o pipefail
  if [[ "${ANDROID_INSTALL_STATUS}" -ne 0 ]]; then
    echo "Android SDK package installation failed."
    exit "${ANDROID_INSTALL_STATUS}"
  fi

  echo "sdk.dir=${ANDROID_SDK_ROOT}" > "${SCRIPT_DIR}/android/local.properties"
  GRADLE_OPTS="-Djava.net.preferIPv4Stack=true -Djava.net.preferIPv6Addresses=false" \
    gradle -p "${SCRIPT_DIR}/android" :app:clean :app:assembleDebug --no-daemon

  APK_SOURCE="${SCRIPT_DIR}/android/app/build/outputs/apk/debug/app-debug.apk"
  GAME_VERSION="$(sed -n 's/^GAME_VERSION = "\([^"]*\)"/\1/p' "${SCRIPT_DIR}/server/main.py")"
  if [[ -z "${GAME_VERSION}" ]]; then
    echo "Could not determine the game version for the APK filename."
    exit 1
  fi
  APK_NAME="neon-arena-android-v${GAME_VERSION}.apk"
  install -m 0644 "${APK_SOURCE}" "${APP_DIR}/server/static/${APK_NAME}"
  install -m 0644 "${APK_SOURCE}" "${APP_DIR}/server/static/neon-arena-android-latest.apk"
fi

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
  if [[ "${BUILD_ANDROID}" -eq 1 ]]; then
    echo "APK: ${SCHEME}://${DOMAIN}/static/${APK_NAME}"
  fi
else
  echo "Installation finished, but the health check failed."
  echo "Check: journalctl -u ${SERVICE_NAME} -n 100 --no-pager"
  exit 1
fi
