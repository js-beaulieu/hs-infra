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

if ! command -v node >/dev/null 2>&1; then
  if command -v fnm >/dev/null 2>&1; then
    eval "$(fnm env)"
  elif [[ -x "${HOME}/.local/share/fnm/fnm" ]]; then
    eval "$(${HOME}/.local/share/fnm/fnm env)"
  fi
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Missing required tool: node"
  exit 1
fi

SCRIPT_DIR="$(dirname "$(realpath "$0")")"
PROJECT_DIR="$(dirname "${SCRIPT_DIR}")"
ENV_FILE_ABS="$(realpath "${ENV_FILE}")"

cd "${PROJECT_DIR}"
export FLOW_TEST_ENV_FILE="${ENV_FILE_ABS}"
echo "Running flow tests with env: ${FLOW_TEST_ENV_FILE}"

if [[ -x "./node_modules/.bin/playwright" ]]; then
  ./node_modules/.bin/playwright test --config=playwright.config.ts
elif command -v npx >/dev/null 2>&1; then
  npx playwright test --config=playwright.config.ts
else
  echo "Missing Playwright runner. Run npm install or install npx."
  exit 1
fi
