import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

const envFileRaw = process.env['FLOW_TEST_ENV_FILE'] || path.resolve(__dirname, 'current.env');
const envPath = path.resolve(envFileRaw);
dotenv.config({ path: envPath, override: true });

const generatedUsersPath = path.resolve(__dirname, '.generated-users.json');
const generatedUsers = fs.existsSync(generatedUsersPath)
  ? JSON.parse(fs.readFileSync(generatedUsersPath, 'utf-8')) as {
      testUser?: { username?: string; password?: string };
      deniedUser?: { username?: string; password?: string };
      mcpUser?: { username?: string; password?: string };
    }
  : {};

const generatedTokensPath = path.resolve(__dirname, '.generated-tokens.json');
const generatedTokens: Record<string, string> = fs.existsSync(generatedTokensPath)
  ? JSON.parse(fs.readFileSync(generatedTokensPath, 'utf-8')) as Record<string, string>
  : {};

function requireVar(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

export const WEB_ORIGIN = requireVar('WEB_ORIGIN');
export const API_BASE = requireVar('API_BASE');
export const MCP_RESOURCE = requireVar('MCP_RESOURCE');
export const MCP_METADATA = requireVar('MCP_METADATA');
export const MCP_AS_METADATA = `${API_BASE}/.well-known/oauth-authorization-server/mcp`;
export const MCP_DCR = `${API_BASE}/.well-known/oauth-authorization-server/mcp/client-registration`;
export const OAUTH2_BASE = requireVar('OAUTH2_BASE');

export const TEST_USER_USERNAME = generatedUsers.testUser?.username || process.env['TEST_USER_USERNAME'] || '';
export const TEST_USER_PASSWORD = generatedUsers.testUser?.password || process.env['TEST_USER_PASSWORD'] || '';
export const TEST_DENIED_USER_USERNAME = generatedUsers.deniedUser?.username || process.env['TEST_DENIED_USER_USERNAME'] || '';
export const TEST_DENIED_USER_PASSWORD = generatedUsers.deniedUser?.password || process.env['TEST_DENIED_USER_PASSWORD'] || '';

export const MCP_TOKEN_VALID = process.env['MCP_TOKEN_VALID'] || generatedTokens['MCP_TOKEN_VALID'] || '';
export const MCP_TOKEN_WRONG_AUD = process.env['MCP_TOKEN_WRONG_AUD'] || generatedTokens['MCP_TOKEN_WRONG_AUD'] || '';
export const MCP_TOKEN_MISSING_GROUP = process.env['MCP_TOKEN_MISSING_GROUP'] || generatedTokens['MCP_TOKEN_MISSING_GROUP'] || '';

export const KEYCLOAK_ADMIN_USERNAME = process.env['KEYCLOAK_ADMIN_USERNAME'] || '';
export const KEYCLOAK_ADMIN_PASSWORD = process.env['KEYCLOAK_ADMIN_PASSWORD'] || '';

export const KEYCLOAK_ORIGIN = (() => {
  try {
    const url = new URL(WEB_ORIGIN);
    const parts = url.hostname.split('.');
    const domain = parts.slice(1).join('.');
    const port = url.port ? `:${url.port}` : '';
    return `https://auth.${domain}${port}`;
  } catch {
    return 'https://auth.home-stack.localhost';
  }
})();
