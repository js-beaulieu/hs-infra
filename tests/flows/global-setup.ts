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

function createUser(username: string, password: string, email: string): string {
  console.log(`Creating user ${username}`);
  kcExec(
    `"${KC}" create users -r "${REALM}" -s username="${username}" -s enabled=true -s email="${email}" -s emailVerified=true -s firstName="Flow" -s lastName="Test"`
  );
  const uid = kcExec(
    `"${KC}" get users -r "${REALM}" -q username="${username}" --fields id --format csv --noquotes | tail -n 1`
  ).trim();
  kcExec(`"${KC}" set-password --username "${username}" -r "${REALM}" --new-password "${password}"`);
  return uid;
}

function joinGroups(username: string, groups: string[]) {
  const uid = kcExec(
    `"${KC}" get users -r "${REALM}" -q username="${username}" --fields id --format csv --noquotes | tail -n 1`
  ).trim();
  for (const group of groups) {
    const gid = kcExec(
      `"${KC}" get groups -r "${REALM}" -q search="${group}" --fields id,name --format csv --noquotes | grep ",${group}$" | cut -d, -f1 || true`
    ).trim();
    if (gid) {
      console.log(`Adding ${username} to ${group}`);
      try {
        kcExec(`"${KC}" update users/${uid}/groups/${gid} -r "${REALM}"`);
      } catch { /* may already be member */ }
    }
  }
}

function leaveGroups(username: string, groups: string[]) {
  const uid = kcExec(
    `"${KC}" get users -r "${REALM}" -q username="${username}" --fields id --format csv --noquotes | tail -n 1`
  ).trim();
  for (const group of groups) {
    const gid = kcExec(
      `"${KC}" get groups -r "${REALM}" -q search="${group}" --fields id,name --format csv --noquotes | grep ",${group}$" | cut -d, -f1 || true`
    ).trim();
    if (gid) {
      try {
        kcExec(`"${KC}" delete users/${uid}/groups/${gid} -r "${REALM}"`);
      } catch { /* may not be a member */ }
    }
  }
}

async function globalSetup() {
  if (!KEYCLOAK_ADMIN_PASSWORD) {
    console.warn('KEYCLOAK_ADMIN_PASSWORD not set; skipping test user setup');
    return;
  }

  for (const group of ['homelab-users', 'tasks-users', 'mcp-users']) {
    try {
      kcExec(`"${KC}" get groups -r "${REALM}" -q search="${group}" | grep '"name" : "${group}"'`);
    } catch {
      console.log(`Creating group ${group}`);
      kcExec(`"${KC}" create groups -r "${REALM}" -s name="${group}"`);
    }
  }

  const runId = `${Date.now()}-${process.pid}`;
  const userPrefix = process.env['TEST_USER_PREFIX'] || 'flowtest';
  const testUser = `${userPrefix}-allowed-${runId}`;
  const deniedUser = `${userPrefix}-denied-${runId}`;
  const testPass = process.env['TEST_USER_PASSWORD'] || 'ChangeMe123';
  const deniedPass = process.env['TEST_DENIED_USER_PASSWORD'] || testPass;

  createUser(testUser, testPass, `${testUser}@example.com`);
  createUser(deniedUser, deniedPass, `${deniedUser}@example.com`);

  joinGroups(testUser, ['homelab-users', 'tasks-users']);
  leaveGroups(testUser, ['mcp-users']);

  joinGroups(deniedUser, ['homelab-users']);
  leaveGroups(deniedUser, ['tasks-users', 'mcp-users']);

  fs.writeFileSync(generatedUsersPath, JSON.stringify({
    testUser: { username: testUser, password: testPass },
    deniedUser: { username: deniedUser, password: deniedPass },
  }, null, 2));
}

export default globalSetup;
