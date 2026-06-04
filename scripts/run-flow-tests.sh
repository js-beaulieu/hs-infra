#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="$1"
if [[ -z "${ENV_FILE}" ]]; then
  echo "Usage: $0 <path-to-env-file>"
  exit 1
fi

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Env file not found: ${ENV_FILE}"
  exit 1
fi

for tool in npx node; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "Missing required tool: $tool"
    exit 1
  fi
done

SCRIPT_DIR="$(dirname "$(realpath "$0")")"
PROJECT_DIR="$(dirname "${SCRIPT_DIR}")"
ENV_FILE_ABS="$(realpath "${ENV_FILE}")"

cd "${PROJECT_DIR}"
export FLOW_TEST_ENV_FILE="${ENV_FILE_ABS}"
echo "Running flow tests with env: ${FLOW_TEST_ENV_FILE}"
npx playwright test --config=playwright.config.ts
