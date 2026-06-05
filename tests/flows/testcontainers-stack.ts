import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import { randomBytes } from 'crypto';
import { execSync } from 'child_process';
import { DockerComposeEnvironment, Wait } from 'testcontainers';

const repoRoot = path.resolve(__dirname, '../..');
const statePath = path.resolve(__dirname, '.testcontainers-state.json');

type TestcontainersState = {
  projectName: string;
  envFile: string;
};

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === 'object') resolve(address.port);
        else reject(new Error('Unable to allocate a free port'));
      });
    });
  });
}

function writeEnvFile(filePath: string, values: Record<string, string>) {
  const body = Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  fs.writeFileSync(filePath, `${body}\n`);
}

async function waitForUrl(url: string, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const status = execSync(`curl -k -s -o /dev/null -w "%{http_code}" "${url}"`, {
        encoding: 'utf-8',
        timeout: 10000,
      }).trim();
      if (Number(status) < 500) return;
    } catch {
      // Keep polling until Caddy, Keycloak and upstream services settle.
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function composeDown(projectName: string) {
  execSync(
    `docker compose -p ${projectName} -f docker-compose.yml -f docker-compose.test.yml down -v --remove-orphans`,
    { cwd: repoRoot, stdio: 'inherit', timeout: 120000 }
  );
}

export async function startTestcontainersStack() {
  if (fs.existsSync(statePath)) {
    const previous = JSON.parse(fs.readFileSync(statePath, 'utf-8')) as TestcontainersState;
    try { composeDown(previous.projectName); } catch { /* best-effort cleanup */ }
    fs.rmSync(previous.envFile, { force: true });
    fs.rmSync(statePath, { force: true });
  }

  const projectName = `home-stack-flow-${Date.now().toString(36)}-${process.pid}`.toLowerCase();
  const domain = process.env['FLOW_TEST_DOMAIN'] || 'home-stack.localhost';
  const httpsPort = await getFreePort();
  const httpPort = await getFreePort();
  const webOrigin = `https://tasks.${domain}:${httpsPort}`;
  const apiOrigin = `https://api.tasks.${domain}:${httpsPort}`;
  const authOrigin = `https://auth.${domain}:${httpsPort}`;
  const mcpResource = `${apiOrigin}/mcp`;
  const subnetThirdOctet = 40 + Math.floor(Math.random() * 180);
  const caddyAuthIp = `172.28.${subnetThirdOctet + 1}.10`;
  const authSubnet = `172.28.${subnetThirdOctet + 1}.0/24`;
  const keycloakAdminUsername = process.env['KEYCLOAK_ADMIN_USERNAME'] || 'admin';
  const keycloakAdminPassword = process.env['KEYCLOAK_ADMIN_PASSWORD'] || `admin-${randomBytes(6).toString('hex')}`;
  const envFile = path.resolve(__dirname, `.testcontainers-${projectName}.env`);

  const composeEnv = {
    DOMAIN: domain,
    PUBLIC_AUTH_ORIGIN: authOrigin,
    PUBLIC_WEB_ORIGIN: webOrigin,
    PUBLIC_API_ORIGIN: apiOrigin,
    MCP_RESOURCE_URI: mcpResource,
    CADDY_HTTP_PORT: String(httpPort),
    CADDY_HTTPS_PORT: String(httpsPort),
    ACME_EMAIL: 'test@example.invalid',
    CADDY_TLS_DIRECTIVE: 'tls /certs/local.pem /certs/local-key.pem',
    CADDY_TRUSTED_PROXIES: 'private_ranges',
    KEYCLOAK_ADMIN_REMOTE_IP_RANGES: 'private_ranges',
    KEYCLOAK_ADMIN_CLIENT_IP_RANGES: 'private_ranges',
    KEYCLOAK_ADMIN_USERNAME: keycloakAdminUsername,
    KEYCLOAK_ADMIN_PASSWORD: keycloakAdminPassword,
    KEYCLOAK_DB_NAME: 'keycloak',
    KEYCLOAK_DB_USER: 'keycloak',
    KEYCLOAK_DB_PASSWORD: `kc-${randomBytes(12).toString('hex')}`,
    KEYCLOAK_PROXY_TRUSTED_ADDRESSES: `${caddyAuthIp}/32`,
    OAUTH2_PROXY_CLIENT_SECRET: randomBytes(32).toString('base64url'),
    OAUTH2_PROXY_COOKIE_SECRET: randomBytes(32).toString('base64url'),
    OAUTH2_PROXY_PROVIDER_CA_FILES: '/certs/rootCA.pem',
    OAUTH2_PROXY_TRUSTED_PROXY_IPS: authSubnet,
    OAUTH2_PROXY_WHITELIST_DOMAINS: `tasks.${domain}:${httpsPort},api.tasks.${domain}:${httpsPort}`,
    AGENTGATEWAY_SSL_CERT_FILE: '/certs/rootCA.pem',
    TASKS_DB_NAME: 'tasks',
    TASKS_DB_USER: 'tasks',
    TASKS_DB_PASSWORD: `tasks-${randomBytes(12).toString('hex')}`,
    AUTH_RESOLVE_IP: 'host-gateway',
    CADDY_AUTH_IP: caddyAuthIp,
    EDGE_SUBNET: `172.28.${subnetThirdOctet}.0/24`,
    AUTH_SUBNET: authSubnet,
    AUTH_DB_SUBNET: `172.28.${subnetThirdOctet + 2}.0/24`,
    AUTH_SESSION_SUBNET: `172.28.${subnetThirdOctet + 3}.0/24`,
    TASKS_SUBNET: `172.28.${subnetThirdOctet + 4}.0/24`,
    TASKS_DB_SUBNET: `172.28.${subnetThirdOctet + 5}.0/24`,
    INTERNAL_GATEWAY_SUBNET: `172.28.${subnetThirdOctet + 6}.0/24`,
  };

  console.log(`Starting isolated Compose project ${projectName} on https port ${httpsPort}`);
  await new DockerComposeEnvironment(repoRoot, ['docker-compose.yml', 'docker-compose.test.yml'])
    .withProjectName(projectName)
    .withEnvironment(composeEnv)
    .withWaitStrategy('caddy-1', Wait.forListeningPorts())
    .withWaitStrategy('keycloak-1', Wait.forHealthCheck())
    .withStartupTimeout(360000)
    .up();

  await waitForUrl(`${apiOrigin}/health`);
  await waitForUrl(`${apiOrigin}/users/me`);
  await waitForUrl(`${webOrigin}/`);

  writeEnvFile(envFile, {
    WEB_ORIGIN: webOrigin,
    API_BASE: apiOrigin,
    MCP_RESOURCE: mcpResource,
    MCP_METADATA: `${apiOrigin}/.well-known/oauth-protected-resource/mcp`,
    OAUTH2_BASE: `${apiOrigin}/oauth2`,
    KEYCLOAK_ADMIN_USERNAME: keycloakAdminUsername,
    KEYCLOAK_ADMIN_PASSWORD: keycloakAdminPassword,
    KEYCLOAK_CONTAINER_NAME: `${projectName}-keycloak-1`,
    TEST_USER_PREFIX: process.env['TEST_USER_PREFIX'] || 'flowtest',
    TEST_USER_PASSWORD: process.env['TEST_USER_PASSWORD'] || 'ChangeMe123',
    TEST_DENIED_USER_PASSWORD: process.env['TEST_DENIED_USER_PASSWORD'] || process.env['TEST_USER_PASSWORD'] || 'ChangeMe123',
    MCP_TOKEN_VALID: process.env['MCP_TOKEN_VALID'] || '',
    MCP_TOKEN_WRONG_AUD: process.env['MCP_TOKEN_WRONG_AUD'] || '',
    MCP_TOKEN_EXPIRED: process.env['MCP_TOKEN_EXPIRED'] || '',
    MCP_TOKEN_MISSING_GROUP: process.env['MCP_TOKEN_MISSING_GROUP'] || '',
  });

  fs.writeFileSync(statePath, JSON.stringify({ projectName, envFile }, null, 2));
  process.env['FLOW_TEST_ENV_FILE'] = envFile;
  for (const [key, value] of Object.entries({ ...composeEnv, FLOW_TEST_ENV_FILE: envFile })) {
    process.env[key] = value;
  }
}

export function stopTestcontainersStack() {
  if (!fs.existsSync(statePath)) return;
  const state = JSON.parse(fs.readFileSync(statePath, 'utf-8')) as TestcontainersState;
  if (process.env['FLOW_TEST_KEEP_TESTCONTAINERS'] === '1') {
    console.log(`Keeping isolated Compose project ${state.projectName} for debugging`);
    return;
  }
  try {
    composeDown(state.projectName);
  } finally {
    fs.rmSync(state.envFile, { force: true });
    fs.rmSync(statePath, { force: true });
  }
}
