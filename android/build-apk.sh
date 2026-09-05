#!/usr/bin/env bash
set -euo pipefail

ANDROID_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${ANDROID_DIR}"

GAME_SERVER_ORIGIN="${GAME_SERVER_ORIGIN:-https://game.chanelchat.ir}"
if [[ ! "${GAME_SERVER_ORIGIN}" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?$ ]]; then
  echo "GAME_SERVER_ORIGIN must be an HTTPS origin, for example https://game.example.com" >&2
  exit 1
fi

if ! command -v gradle >/dev/null 2>&1; then
  echo "Gradle is required. Use the included GitHub Actions workflow or install Gradle 8.7."
  exit 1
fi

gradle :app:assembleDebug --no-daemon -PgameServerOrigin="${GAME_SERVER_ORIGIN}"
echo "Server: ${GAME_SERVER_ORIGIN}"
echo "APK: ${ANDROID_DIR}/app/build/outputs/apk/debug/app-debug.apk"
