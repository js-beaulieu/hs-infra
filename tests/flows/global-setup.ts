import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { startTestcontainersStack } from './testcontainers-stack';
import { KEYCLOAK_ORIGIN } from './env';

const envFileRaw = process.env['FLOW_TEST_ENV_FILE'] || path.resolve(__dirname, 'current.env');
dotenv.config({ path: path.resolve(envFileRaw), override: true });

const REALM = 'homelab';
const KC = '/opt/keycloak/bin/kcadm.sh';
const SERVER = 'http://keycloak:8080';
const generatedUsersPath = path.resolve(__dirname, '.generated-users.json');
const generatedTokensPath = path.resolve(__dirname, '.generated-tokens.json');

function kcExec(cmd: string): string {
  const keycloakAdminUsername = process.env['KEYCLOAK_ADMIN_USERNAME'] || '';
  const keycloakAdminPassword = process.env['KEYCLOAK_ADMIN_PASSWORD'] || '';
  const keycloakContainer = process.env['KEYCLOAK_CONTAINER_NAME'] || 'home-stack-keycloak-1';
  const script = [
    `"${KC}" config credentials --server "${SERVER}" --realm master --user "${keycloakAdminUsername}" --password "${keycloakAdminPassword}" >/dev/null 2>&1 || exit 1`,
    cmd,
  ].join('\n');
  return execSync(`docker exec -i ${keycloakContainer} /bin/sh`, {
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
  kcExec(`"${KC}" set-password --username "${username}" -r "${REALM}" --new-password "${password}" --temporary=false`);
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

function createRopcClient(clientId: string, clientSecret: string, audience: string): string {
  const existingId = kcExec(
    `"${KC}" get clients -r "${REALM}" -q clientId="${clientId}" --fields id --format csv --noquotes | tail -n 1 || true`
  ).trim();
  if (existingId) {
    kcExec(`"${KC}" delete clients/${existingId} -r "${REALM}"`);
  }
  const clientJson = JSON.stringify({
    clientId,
    secret: clientSecret,
    publicClient: false,
    standardFlowEnabled: false,
    directAccessGrantsEnabled: true,
    serviceAccountsEnabled: false,
    implicitFlowEnabled: false,
    redirectUris: [],
    attributes: {},
  });
  const tmpFile = `/tmp/mcp-test-client-${clientId}.json`;
  kcExec(`cat > ${tmpFile} <<'CLIENTJSON'\n${clientJson}\nCLIENTJSON\n"${KC}" create clients -r "${REALM}" -f "${tmpFile}"\nrm -f ${tmpFile}`);
  const cid = kcExec(
    `"${KC}" get clients -r "${REALM}" -q clientId="${clientId}" --fields id --format csv --noquotes | tail -n 1`
  ).trim();

  const groupsMapperName = `${clientId}-groups`;
  const audienceMapperName = `${clientId}-audience`;
  const mappers = kcExec(
    `"${KC}" get clients/${cid}/protocol-mappers/models -r "${REALM}" --fields id,name --format csv --noquotes || true`
  ).trim();
  for (const line of mappers.split('\n')) {
    const parts = line.split(',');
    const name = parts.slice(1).join(',');
    if (name === groupsMapperName || name === audienceMapperName) {
      const mapperId = parts[0];
      try { kcExec(`"${KC}" delete clients/${cid}/protocol-mappers/models/${mapperId} -r "${REALM}"`); } catch { /* ignore */ }
    }
  }
  kcExec(`"${KC}" create clients/${cid}/protocol-mappers/models -r "${REALM}" -s name="${groupsMapperName}" -s protocol=openid-connect -s protocolMapper=oidc-group-membership-mapper -s 'config."claim.name"=groups' -s 'config."full.path"=true' -s 'config."access.token.claim"=true' -s 'config."id.token.claim"=true' -s 'config."userinfo.token.claim"=true'`);
  kcExec(`"${KC}" create clients/${cid}/protocol-mappers/models -r "${REALM}" -s name="${audienceMapperName}" -s protocol=openid-connect -s protocolMapper=oidc-audience-mapper -s 'config."included.custom.audience"=${audience}' -s 'config."access.token.claim"=true' -s 'config."id.token.claim"=false'`);
  return cid;
}

function createWrongAudClient(clientId: string, clientSecret: string, wrongAudience: string): string {
  const existingId = kcExec(
    `"${KC}" get clients -r "${REALM}" -q clientId="${clientId}" --fields id --format csv --noquotes | tail -n 1 || true`
  ).trim();
  if (existingId) {
    kcExec(`"${KC}" delete clients/${existingId} -r "${REALM}"`);
  }
  const clientJson = JSON.stringify({
    clientId,
    secret: clientSecret,
    publicClient: false,
    standardFlowEnabled: false,
    directAccessGrantsEnabled: true,
    serviceAccountsEnabled: false,
    implicitFlowEnabled: false,
    redirectUris: [],
    attributes: {},
  });
  const tmpFile = `/tmp/mcp-test-client-${clientId}.json`;
  kcExec(`cat > ${tmpFile} <<'CLIENTJSON'\n${clientJson}\nCLIENTJSON\n"${KC}" create clients -r "${REALM}" -f "${tmpFile}"\nrm -f ${tmpFile}`);
  const cid = kcExec(
    `"${KC}" get clients -r "${REALM}" -q clientId="${clientId}" --fields id --format csv --noquotes | tail -n 1`
  ).trim();

  const groupsMapperName = `${clientId}-groups`;
  const audienceMapperName = `${clientId}-audience`;
  const mappers = kcExec(
    `"${KC}" get clients/${cid}/protocol-mappers/models -r "${REALM}" --fields id,name --format csv --noquotes || true`
  ).trim();
  for (const line of mappers.split('\n')) {
    const parts = line.split(',');
    const name = parts.slice(1).join(',');
    if (name === groupsMapperName || name === audienceMapperName) {
      const mapperId = parts[0];
      try { kcExec(`"${KC}" delete clients/${cid}/protocol-mappers/models/${mapperId} -r "${REALM}"`); } catch { /* ignore */ }
    }
  }
  kcExec(`"${KC}" create clients/${cid}/protocol-mappers/models -r "${REALM}" -s name="${groupsMapperName}" -s protocol=openid-connect -s protocolMapper=oidc-group-membership-mapper -s 'config."claim.name"=groups' -s 'config."full.path"=true' -s 'config."access.token.claim"=true' -s 'config."id.token.claim"=true' -s 'config."userinfo.token.claim"=true'`);
  kcExec(`"${KC}" create clients/${cid}/protocol-mappers/models -r "${REALM}" -s name="${audienceMapperName}" -s protocol=openid-connect -s protocolMapper=oidc-audience-mapper -s 'config."included.custom.audience"=${wrongAudience}' -s 'config."access.token.claim"=true' -s 'config."id.token.claim"=false'`);
  return cid;
}

function deleteClient(clientId: string) {
  const existingId = kcExec(
    `"${KC}" get clients -r "${REALM}" -q clientId="${clientId}" --fields id --format csv --noquotes | tail -n 1 || true`
  ).trim();
  if (existingId) {
    kcExec(`"${KC}" delete clients/${existingId} -r "${REALM}"`);
  }
}

function getToken(clientId: string, clientSecret: string, username: string, password: string): string {
  const body = `grant_type=password&client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}&username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
  let result: string;
  const tokenUrl = process.env['KEYCLOAK_TOKEN_URL']
    || (() => { try { return new URL('/realms/' + REALM + '/protocol/openid-connect/token', KEYCLOAK_ORIGIN).toString(); } catch { return ''; } })();
  if (tokenUrl) {
    result = execSync(
      `curl -sk -s -X POST "${tokenUrl}" -H "Content-Type: application/x-www-form-urlencoded" -d "${body}"`,
      { encoding: 'utf-8', timeout: 15000 }
    );
  } else {
    const keycloakContainer = process.env['KEYCLOAK_CONTAINER_NAME'] || 'home-stack-keycloak-1';
    result = execSync(
      `docker exec -i ${keycloakContainer} /bin/sh -c 'curl -s -X POST "http://keycloak:8080/realms/${REALM}/protocol/openid-connect/token" -H "Content-Type: application/x-www-form-urlencoded" -d "${body}"'`,
      { encoding: 'utf-8', timeout: 15000 }
    );
  }
  const json = JSON.parse(result);
  if (!json.access_token) {
    throw new Error(`Failed to obtain token for ${username}: ${JSON.stringify(json)}`);
  }
  return json.access_token;
}

async function globalSetup() {
  if (process.env['FLOW_TEST_USE_TESTCONTAINERS'] === '1') {
    await startTestcontainersStack();
    dotenv.config({ path: path.resolve(process.env['FLOW_TEST_ENV_FILE']!), override: true });
  }

  if (!process.env['KEYCLOAK_ADMIN_PASSWORD']) {
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

  const mcpUser = `${userPrefix}-mcp-${runId}`;
  const mcpPass = process.env['MCP_USER_PASSWORD'] || testPass;
  createUser(mcpUser, mcpPass, `${mcpUser}@example.com`);
  joinGroups(mcpUser, ['homelab-users', 'mcp-users']);

  const mcpResourceUri = process.env['MCP_RESOURCE'] || process.env['MCP_RESOURCE_URI'] || '';
  const mcpTokenValid = process.env['MCP_TOKEN_VALID'] || '';
  const mcpTokenWrongAud = process.env['MCP_TOKEN_WRONG_AUD'] || '';
  const mcpTokenMissingGroup = process.env['MCP_TOKEN_MISSING_GROUP'] || '';

  let generatedTokens: Record<string, string> = {};
  let mcpClientsToCleanup: string[] = [];

  if (mcpResourceUri && !mcpTokenValid) {
    try {
      const runIdShort = runId.replace(/[^a-zA-Z0-9-]/g, '').substring(0, 12);
      const validClientSecret = process.env['MCP_TEST_CLIENT_SECRET'] || `mcp-valid-${runIdShort}`;
      const wrongAudClientSecret = process.env['MCP_WRONG_AUD_CLIENT_SECRET'] || `mcp-wrong-aud-${runIdShort}`;

      const validClientId = `mcp-test-valid-${runIdShort}`;
      const wrongAudClientId = `mcp-test-wrong-aud-${runIdShort}`;

      mcpClientsToCleanup = [validClientId, wrongAudClientId];

      const wrongAudience = `${mcpResourceUri}-wrong`;

      console.log('Creating temporary Keycloak clients for MCP token generation');
      createRopcClient(validClientId, validClientSecret, mcpResourceUri);
      createWrongAudClient(wrongAudClientId, wrongAudClientSecret, wrongAudience);

      console.log('Generating MCP tokens via Keycloak token endpoint');

      generatedTokens['MCP_TOKEN_VALID'] = getToken(validClientId, validClientSecret, mcpUser, mcpPass);
      generatedTokens['MCP_TOKEN_MISSING_GROUP'] = getToken(validClientId, validClientSecret, deniedUser, deniedPass);
      generatedTokens['MCP_TOKEN_WRONG_AUD'] = getToken(wrongAudClientId, wrongAudClientSecret, mcpUser, mcpPass);

      console.log('Cleaning up temporary Keycloak clients');
      for (const clientId of mcpClientsToCleanup) {
        try { deleteClient(clientId); } catch { /* best-effort */ }
      }
      mcpClientsToCleanup = [];
    } catch (err) {
      console.warn('MCP token generation failed; MCP token tests will be skipped:', err instanceof Error ? err.message : err);
      for (const clientId of mcpClientsToCleanup) {
        try { deleteClient(clientId); } catch { /* best-effort */ }
      }
    }
  }

  if (mcpResourceUri && mcpTokenValid) {
    generatedTokens['MCP_TOKEN_VALID'] = mcpTokenValid;
  }
  if (mcpResourceUri && mcpTokenWrongAud) {
    generatedTokens['MCP_TOKEN_WRONG_AUD'] = mcpTokenWrongAud;
  }
  if (mcpResourceUri && mcpTokenMissingGroup) {
    generatedTokens['MCP_TOKEN_MISSING_GROUP'] = mcpTokenMissingGroup;
  }

  for (const [key, value] of Object.entries(generatedTokens)) {
    process.env[key] = value;
  }

  fs.writeFileSync(generatedUsersPath, JSON.stringify({
    testUser: { username: testUser, password: testPass },
    deniedUser: { username: deniedUser, password: deniedPass },
    mcpUser: { username: mcpUser, password: mcpPass },
  }, null, 2));

  if (Object.keys(generatedTokens).length > 0) {
    fs.writeFileSync(generatedTokensPath, JSON.stringify(generatedTokens, null, 2));
  } else {
    try { fs.rmSync(generatedTokensPath, { force: true }); } catch { /* ignore */ }
  }
}

export default globalSetup;
