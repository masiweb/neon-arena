#!/usr/bin/env bash
set -euo pipefail

ANDROID_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${ANDROID_DIR}"

if ! command -v gradle >/dev/null 2>&1; then
  echo "Gradle is required. Use the included GitHub Actions workflow or install Gradle 8.7."
  exit 1
fi

gradle :app:assembleDebug
echo "APK: ${ANDROID_DIR}/app/build/outputs/apk/debug/app-debug.apk"

