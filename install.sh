#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/neon-arena"
APP_USER="neonarena"
SERVICE_NAME="neon-arena"
DOMAIN=""
PUBLIC_ORIGIN=""
ENABLE_SSL=0
BUILD_ANDROID=1
GRADLE_VERSION="8.7"
ANDROID_CLI_VERSION="15859902"
ANDROID_CLI_SHA256="4e4c464f145a7512b57d088ac6c278c03c9eea610886b35a5e0804e74eedf583"
ANDROID_SDK_ROOT="/opt/android-sdk"
BUILD_TMP=""
STAGE_DIR=""

usage() {
  cat <<'EOF'
Usage:
  sudo bash install.sh --domain game.example.com --ssl
  sudo bash install.sh --domain game.example.com --ssl --skip-android
  sudo bash install.sh --domain SERVER_IP --skip-android

Options:
  --domain HOST          Public domain or IP address (required)
  --ssl                  Obtain/install a Let's Encrypt certificate with Certbot
  --public-origin URL    Public origin used by CORS and the APK (advanced)
  --skip-android         Install only the web server; do not build an APK
  --help                 Show this help
EOF
}

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

cleanup() {
  if [[ -n "${BUILD_TMP}" && -d "${BUILD_TMP}" ]]; then
    rm -rf "${BUILD_TMP}"
  fi
  if [[ -n "${STAGE_DIR}" && -d "${STAGE_DIR}" ]]; then
    rm -rf "${STAGE_DIR}"
  fi
}
trap cleanup EXIT

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain)
      [[ $# -ge 2 ]] || fail "--domain needs a value"
      DOMAIN="$2"
      shift 2
      ;;
    --ssl)
      ENABLE_SSL=1
      shift
      ;;
    --public-origin)
      [[ $# -ge 2 ]] || fail "--public-origin needs a value"
      PUBLIC_ORIGIN="$2"
      shift 2
      ;;
    --skip-android)
      BUILD_ANDROID=0
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 2
      ;;
  esac
done

[[ "${EUID}" -eq 0 ]] || fail "Run with sudo: sudo bash install.sh --domain YOUR_DOMAIN --ssl"
[[ -n "${DOMAIN}" ]] || fail "--domain is required"
[[ "${DOMAIN}" =~ ^[A-Za-z0-9.-]+$ ]] || fail "Invalid domain/IP: ${DOMAIN}"
[[ "${DOMAIN}" != .* && "${DOMAIN}" != *. ]] || fail "Invalid domain/IP: ${DOMAIN}"

IS_IP=0
if [[ "${DOMAIN}" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  IS_IP=1
fi
if [[ "${ENABLE_SSL}" -eq 1 && "${IS_IP}" -eq 1 ]]; then
  fail "Let's Encrypt needs a domain name, not an IP. Point a domain to this server first."
fi

if [[ -z "${PUBLIC_ORIGIN}" ]]; then
  if [[ "${ENABLE_SSL}" -eq 1 ]]; then
    PUBLIC_ORIGIN="https://${DOMAIN}"
  else
    PUBLIC_ORIGIN="http://${DOMAIN}"
  fi
fi
[[ "${PUBLIC_ORIGIN}" =~ ^https?://[A-Za-z0-9.-]+(:[0-9]+)?$ ]] || \
  fail "Invalid --public-origin. Use an origin such as https://game.example.com"
if [[ "${BUILD_ANDROID}" -eq 1 && "${PUBLIC_ORIGIN}" != https://* ]]; then
  fail "The Android app requires HTTPS. Use --ssl, pass an HTTPS --public-origin, or add --skip-android."
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[[ -f "${SCRIPT_DIR}/server/main.py" ]] || \
  fail "Run install.sh from the cloned Neon Arena repository."
[[ -f "${SCRIPT_DIR}/verify.sh" ]] || fail "verify.sh is missing; update the repository and retry."

GAME_VERSION="$(sed -n 's/^GAME_VERSION = "\([^"]*\)"/\1/p' "${SCRIPT_DIR}/server/main.py")"
[[ -n "${GAME_VERSION}" ]] || fail "Could not determine GAME_VERSION from server/main.py"
APK_NAME="neon-arena-android-v${GAME_VERSION}.apk"

if [[ -r /etc/os-release ]]; then
  # shellcheck disable=SC1091
  source /etc/os-release
  [[ "${ID:-}" == "ubuntu" && "${VERSION_ID:-}" == "24.04" ]] || \
    echo "WARNING: This installer is tested on Ubuntu 24.04; detected ${PRETTY_NAME:-unknown}."
fi

AVAILABLE_MB="$(df -Pm /opt 2>/dev/null | awk 'NR==2 {print $4}' || true)"
if [[ "${BUILD_ANDROID}" -eq 1 && "${AVAILABLE_MB:-0}" -lt 3500 ]]; then
  fail "At least 3.5 GB of free disk space is required to build Android (available: ${AVAILABLE_MB:-unknown} MB)."
fi
if [[ "${BUILD_ANDROID}" -eq 1 && "$(uname -m)" != "x86_64" ]]; then
  fail "Android build tools require an x86_64 server. Use --skip-android on this architecture."
fi

echo "Installing Neon Arena ${GAME_VERSION} for ${PUBLIC_ORIGIN}"
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y \
  ca-certificates curl git nginx nodejs python3 python3-pip python3-venv \
  unzip wget openjdk-17-jdk-headless

if ! id "${APP_USER}" >/dev/null 2>&1; then
  useradd --system --home "${APP_DIR}" --shell /usr/sbin/nologin "${APP_USER}"
fi
install -d -o "${APP_USER}" -g "${APP_USER}" "${APP_DIR}"

python3 -m venv "${APP_DIR}/venv"
"${APP_DIR}/venv/bin/pip" install --upgrade pip
"${APP_DIR}/venv/bin/pip" install -r "${SCRIPT_DIR}/server/requirements.txt"
chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}/venv"

echo "Running unit and live multiplayer tests before deployment..."
chmod +x "${SCRIPT_DIR}/verify.sh"
"${SCRIPT_DIR}/verify.sh" --python "${APP_DIR}/venv/bin/python" --integration --port 8766

APK_SOURCE=""
if [[ "${BUILD_ANDROID}" -eq 1 ]]; then
  echo "Installing Android build tools and building the APK..."
  BUILD_TMP="$(mktemp -d /tmp/neon-arena-android.XXXXXX)"

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

  JAVA_HOME="/usr/lib/jvm/java-17-openjdk-amd64"
  [[ -x "${JAVA_HOME}/bin/jlink" ]] || fail "Java 17 JDK is incomplete: jlink was not found in ${JAVA_HOME}"
  export ANDROID_HOME="${ANDROID_SDK_ROOT}"
  export ANDROID_SDK_ROOT
  export JAVA_HOME
  export PATH="${JAVA_HOME}/bin:/opt/gradle-${GRADLE_VERSION}/bin:${ANDROID_SDK_ROOT}/cmdline-tools/latest/bin:${ANDROID_SDK_ROOT}/platform-tools:${PATH}"

  set +o pipefail
  yes | android --sdk="${ANDROID_SDK_ROOT}" sdk install \
    platform-tools platforms/android-35 build-tools/34.0.0 build-tools/35.0.0
  ANDROID_INSTALL_STATUS="${PIPESTATUS[1]}"
  set -o pipefail
  [[ "${ANDROID_INSTALL_STATUS}" -eq 0 ]] || fail "Android SDK package installation failed."

  echo "sdk.dir=${ANDROID_SDK_ROOT}" > "${SCRIPT_DIR}/android/local.properties"
  GRADLE_OPTS="-Djava.net.preferIPv4Stack=true -Djava.net.preferIPv6Addresses=false" \
    gradle -p "${SCRIPT_DIR}/android" :app:clean :app:assembleDebug --no-daemon \
    -PgameServerOrigin="${PUBLIC_ORIGIN}"

  APK_SOURCE="${SCRIPT_DIR}/android/app/build/outputs/apk/debug/app-debug.apk"
  [[ -s "${APK_SOURCE}" ]] || fail "Gradle finished but no APK was produced."
  "${ANDROID_SDK_ROOT}/build-tools/35.0.0/apksigner" verify --verbose "${APK_SOURCE}"
  unzip -p "${APK_SOURCE}" assets/game.js > "${BUILD_TMP}/embedded-game.js"
  grep -Fq "${PUBLIC_ORIGIN}" "${BUILD_TMP}/embedded-game.js" || \
    fail "The APK does not contain the selected server origin."
fi

echo "Staging server files..."
STAGE_DIR="$(mktemp -d "${APP_DIR}/server.new.XXXXXX")"
cp -a "${SCRIPT_DIR}/server/." "${STAGE_DIR}/"
if [[ "${BUILD_ANDROID}" -eq 1 ]]; then
  install -m 0644 "${APK_SOURCE}" "${STAGE_DIR}/static/${APK_NAME}"
  install -m 0644 "${APK_SOURCE}" "${STAGE_DIR}/static/neon-arena-android-latest.apk"
elif [[ -f "${APP_DIR}/server/static/neon-arena-android-latest.apk" ]]; then
  cp -a "${APP_DIR}/server/static/neon-arena-android-latest.apk" "${STAGE_DIR}/static/"
fi
chown -R "${APP_USER}:${APP_USER}" "${STAGE_DIR}"

sed -e "s|__APP_DIR__|${APP_DIR}|g" \
    -e "s|__PUBLIC_ORIGIN__|${PUBLIC_ORIGIN}|g" \
    "${SCRIPT_DIR}/deploy/neon-arena.service" > "/etc/systemd/system/${SERVICE_NAME}.service"
sed "s|__DOMAIN__|${DOMAIN}|g" \
  "${SCRIPT_DIR}/deploy/nginx.conf.template" > "/etc/nginx/sites-available/${SERVICE_NAME}"
ln -sfn "/etc/nginx/sites-available/${SERVICE_NAME}" "/etc/nginx/sites-enabled/${SERVICE_NAME}"
rm -f /etc/nginx/sites-enabled/default
nginx -t

systemctl daemon-reload
systemctl enable "${SERVICE_NAME}"
systemctl enable --now nginx
systemctl stop "${SERVICE_NAME}" 2>/dev/null || true

PREVIOUS_DIR=""
if [[ -d "${APP_DIR}/server" ]]; then
  if [[ -e "${APP_DIR}/server.previous" ]]; then
    mv "${APP_DIR}/server.previous" \
      "${APP_DIR}/server.backup-$(date +%Y%m%d-%H%M%S)"
  fi
  mv "${APP_DIR}/server" "${APP_DIR}/server.previous"
  PREVIOUS_DIR="${APP_DIR}/server.previous"
fi
mv "${STAGE_DIR}" "${APP_DIR}/server"
STAGE_DIR=""

systemctl start "${SERVICE_NAME}"
systemctl reload nginx

HEALTHY=0
for _ in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:8765/health >/dev/null 2>&1; then
    HEALTHY=1
    break
  fi
  sleep 0.25
done

if [[ "${HEALTHY}" -ne 1 ]]; then
  echo "The new service failed its health check; restoring the previous server files." >&2
  journalctl -u "${SERVICE_NAME}" -n 100 --no-pager >&2 || true
  systemctl stop "${SERVICE_NAME}" 2>/dev/null || true
  mv "${APP_DIR}/server" "${APP_DIR}/server.failed-$(date +%Y%m%d-%H%M%S)"
  if [[ -n "${PREVIOUS_DIR}" && -d "${PREVIOUS_DIR}" ]]; then
    mv "${PREVIOUS_DIR}" "${APP_DIR}/server"
    systemctl start "${SERVICE_NAME}"
  fi
  exit 1
fi

if [[ "${ENABLE_SSL}" -eq 1 ]]; then
  apt-get install -y certbot python3-certbot-nginx
  certbot --nginx -d "${DOMAIN}" --non-interactive --agree-tos \
    --register-unsafely-without-email --redirect || \
    fail "SSL setup failed. Confirm DNS points to this server and ports 80/443 are open, then rerun the installer."
fi

PUBLIC_HEALTH="${PUBLIC_ORIGIN}/health"
if ! curl -fsS --retry 5 --retry-delay 1 "${PUBLIC_HEALTH}" >/dev/null; then
  echo "WARNING: Local health is OK, but ${PUBLIC_HEALTH} could not be reached from this server."
  echo "Check DNS, the Cloudflare proxy setting, and ports 80/443."
fi

echo
echo "Neon Arena ${GAME_VERSION} is ready:"
echo "Game: ${PUBLIC_ORIGIN}"
echo "Health: ${PUBLIC_HEALTH}"
if [[ "${BUILD_ANDROID}" -eq 1 ]]; then
  echo "APK (latest): ${PUBLIC_ORIGIN}/static/neon-arena-android-latest.apk"
  echo "APK (versioned): ${PUBLIC_ORIGIN}/static/${APK_NAME}"
fi
