#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="$1"
if [[ -z "${ENV_FILE}" ]]; then
  echo "Usage: $0 <path-to-env-file>"
  exit 1
fi
shift

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Env file not found: ${ENV_FILE}"
  exit 1
fi

SCRIPT_DIR="$(dirname "$(realpath "$0")")"
PROJECT_DIR="$(dirname "${SCRIPT_DIR}")"
ENV_FILE_ABS="$(realpath "${ENV_FILE}")"

cd "${PROJECT_DIR}"
export FLOW_TEST_ENV_FILE="${ENV_FILE_ABS}"
echo "Running flow tests with env: ${FLOW_TEST_ENV_FILE}"

if command -v uv >/dev/null 2>&1; then
  UV_BIN="uv"
elif [[ -x "${HOME}/.local/bin/uv" ]]; then
  UV_BIN="${HOME}/.local/bin/uv"
else
  echo "Missing required tool: uv"
  exit 1
fi

PYTEST_ARGS=(--group dev pytest)
if [[ -n "${CI:-}" ]]; then
  PYTEST_ARGS+=(--reruns 2)
fi
PYTEST_ARGS+=(tests/flows "$@")

"${UV_BIN}" run "${PYTEST_ARGS[@]}"
