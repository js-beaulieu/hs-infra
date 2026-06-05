import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const envFileRaw = process.env['FLOW_TEST_ENV_FILE'] || path.resolve(__dirname, 'current.env');
dotenv.config({ path: path.resolve(envFileRaw), override: true });

const KEYCLOAK_ADMIN_USERNAME = process.env['KEYCLOAK_ADMIN_USERNAME'] || '';
const KEYCLOAK_ADMIN_PASSWORD = process.env['KEYCLOAK_ADMIN_PASSWORD'] || '';
const KEYCLOAK_CONTAINER = process.env['KEYCLOAK_CONTAINER_NAME'] || 'home-stack-keycloak-1';

const REALM = 'homelab';
const KC = '/opt/keycloak/bin/kcadm.sh';
const SERVER = 'http://keycloak:8080';
const generatedUsersPath = path.resolve(__dirname, '.generated-users.json');

function kcExec(cmd: string): string {
  const script = [
    `set -e`,
    `"${KC}" config credentials --server "${SERVER}" --realm master --user "${KEYCLOAK_ADMIN_USERNAME}" --password "${KEYCLOAK_ADMIN_PASSWORD}" >/dev/null 2>&1 || exit 1`,
    cmd,
  ].join('\n');
  return execSync(`docker exec -i ${KEYCLOAK_CONTAINER} /bin/sh`, {
    input: script,
    encoding: 'utf-8',
    timeout: 30000,
  });
}

function deleteUser(username: string) {
  const uid = kcExec(
    `"${KC}" get users -r "${REALM}" -q username="${username}" --fields id --format csv --noquotes 2>/dev/null | tail -n 1 || true`
  ).trim();
  if (uid) {
    console.log(`Deleting test user ${username}`);
    kcExec(`"${KC}" delete users/${uid} -r "${REALM}"`);
  }
}

async function globalTeardown() {
  if (!KEYCLOAK_ADMIN_PASSWORD || !fs.existsSync(generatedUsersPath)) return;

  const generatedUsers = JSON.parse(fs.readFileSync(generatedUsersPath, 'utf-8')) as {
    testUser?: { username?: string };
    deniedUser?: { username?: string };
  };

  for (const username of [generatedUsers.testUser?.username, generatedUsers.deniedUser?.username]) {
    if (username) deleteUser(username);
  }

  fs.rmSync(generatedUsersPath, { force: true });
}

export default globalTeardown;
