#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PYTHON_BIN="${PYTHON_BIN:-python3}"
RUN_INTEGRATION=0
PORT="${NEON_TEST_PORT:-8766}"
SERVER_PID=""
SERVER_LOG=""

usage() {
  cat <<'EOF'
Usage: ./verify.sh [--python /path/to/python] [--integration] [--port 8766]

Runs shell/JavaScript syntax checks and Python unit tests. With --integration,
it also starts an isolated local server and tests HTTP plus WebSocket gameplay.
EOF
}

cleanup() {
  if [[ -n "${SERVER_PID}" ]] && kill -0 "${SERVER_PID}" 2>/dev/null; then
    kill "${SERVER_PID}" 2>/dev/null || true
    wait "${SERVER_PID}" 2>/dev/null || true
  fi
  if [[ -n "${SERVER_LOG}" && -f "${SERVER_LOG}" ]]; then
    rm -f "${SERVER_LOG}"
  fi
}
trap cleanup EXIT

while [[ $# -gt 0 ]]; do
  case "$1" in
    --python)
      [[ $# -ge 2 ]] || { echo "--python needs a value" >&2; exit 2; }
      PYTHON_BIN="$2"
      shift 2
      ;;
    --integration)
      RUN_INTEGRATION=1
      shift
      ;;
    --port)
      [[ $# -ge 2 ]] || { echo "--port needs a value" >&2; exit 2; }
      PORT="$2"
      shift 2
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

[[ "${PORT}" =~ ^[0-9]+$ ]] && (( PORT >= 1024 && PORT <= 65535 )) || {
  echo "Invalid test port: ${PORT}" >&2
  exit 2
}

command -v "${PYTHON_BIN}" >/dev/null 2>&1 || {
  echo "Python not found: ${PYTHON_BIN}" >&2
  exit 1
}
command -v node >/dev/null 2>&1 || {
  echo "Node.js is required for JavaScript syntax checks." >&2
  exit 1
}

echo "[1/3] Checking shell and JavaScript syntax..."
bash -n "${ROOT_DIR}/install.sh"
bash -n "${ROOT_DIR}/android/build-apk.sh"
bash -n "${ROOT_DIR}/verify.sh"
node --check "${ROOT_DIR}/server/static/game.js"
node --check "${ROOT_DIR}/server/static/renderer3d.js"

echo "[2/3] Running Python unit tests..."
(
  cd "${ROOT_DIR}"
  PYTHONPATH="${ROOT_DIR}" "${PYTHON_BIN}" -m unittest discover -s tests -p 'test_*.py'
)

if [[ "${RUN_INTEGRATION}" -eq 0 ]]; then
  echo "[3/3] Integration test skipped (pass --integration to enable it)."
  echo "Verification successful."
  exit 0
fi

echo "[3/3] Running isolated HTTP/WebSocket integration test..."
SERVER_LOG="$(mktemp /tmp/neon-arena-test.XXXXXX.log)"
(
  cd "${ROOT_DIR}"
  exec env PYTHONPATH="${ROOT_DIR}" NEON_PUBLIC_ORIGIN="http://127.0.0.1:${PORT}" \
    "${PYTHON_BIN}" -m uvicorn server.main:app \
    --host 127.0.0.1 --port "${PORT}" --workers 1
) >"${SERVER_LOG}" 2>&1 &
SERVER_PID=$!

READY=0
for _ in $(seq 1 80); do
  if curl -fsS "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
    READY=1
    break
  fi
  if ! kill -0 "${SERVER_PID}" 2>/dev/null; then
    break
  fi
  sleep 0.25
done

if [[ "${READY}" -ne 1 ]]; then
  echo "The isolated test server did not become healthy:" >&2
  tail -n 100 "${SERVER_LOG}" >&2 || true
  exit 1
fi

(
  cd "${ROOT_DIR}"
  NEON_TEST_HTTP="http://127.0.0.1:${PORT}" \
  NEON_TEST_WS="ws://127.0.0.1:${PORT}" \
  PYTHONPATH="${ROOT_DIR}" \
    "${PYTHON_BIN}" tests/integration_test.py
)

echo "Verification successful."
