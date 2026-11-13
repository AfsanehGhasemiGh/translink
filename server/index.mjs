import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { AsyncLocalStorage } from 'node:async_hooks';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AuthenticationError, staffAuthentication } from './auth.mjs';
import { AzureCliCredential } from '@azure/identity';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const config = JSON.parse(await readFile(new URL('../fabric/deployment.json', import.meta.url), 'utf8'));
const credential = new AzureCliCredential();
const fabricBase = 'https://api.fabric.microsoft.com/v1';
const workspacePath = `/workspaces/${config.workspaceId}`;
const attribution = 'fabriciq-ontology-cli';
const hosted = Boolean(process.env.WEBSITE_SITE_NAME) || process.env.HOSTED_MODE === 'true';
const port = Number(process.env.PORT || 8787);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid TCP port.');
const publicOrigin = hosted ? new URL(process.env.PUBLIC_ORIGIN || '') : undefined;
if (publicOrigin && (publicOrigin.protocol !== 'https:' || publicOrigin.pathname !== '/')) {
  throw new Error('PUBLIC_ORIGIN must be the hosted HTTPS origin.');
}
const staffConfig = {
  tenantId: process.env.ENTRA_TENANT_ID,
  clientId: process.env.ENTRA_CLIENT_ID,
  fabricAudience: process.env.FABRIC_TOKEN_AUDIENCE,
};
const authenticate = hosted ? staffAuthentication(staffConfig) : undefined;
const requestIdentity = new AsyncLocalStorage();
const staticRoot = resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const mimeTypes = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

async function token() {
  if (hosted) {
    const delegatedToken = requestIdentity.getStore();
    if (!delegatedToken) throw new AuthenticationError('Hosted Fabric calls require an authenticated staff request.');
    return delegatedToken;
  }
  const result = await credential.getToken('https://api.fabric.microsoft.com/.default');
  if (!result?.token) throw new Error('Azure CLI did not return a Fabric access token. Sign in with az login.');
  return result.token;
}

async function fabric(path, method = 'GET', body) {
  const response = await fetch(`${fabricBase}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${await token()}`, 'x-ms-fabric-skill': attribution,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Fabric ${response.status}: ${detail.slice(0, 1000)}`);
  }
  if (response.status === 202) {
    const id = response.headers.get('x-ms-operation-id');
    if (!id || !/^[\da-f-]{36}$/i.test(id)) throw new Error('Fabric returned an operation without a valid ID.');
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      const state = await fabric(`/operations/${id}`);
      if (state.status === 'Succeeded') return fabric(`/operations/${id}/result`);
      if (['Failed', 'Cancelled'].includes(state.status)) throw new Error(`Fabric operation ${state.status}: ${JSON.stringify(state.error)}`);
    }
    throw new Error('Fabric operation timed out; retry this read later.');
  }
  if (response.status === 204) return null;
  return response.json();
}

function requireItem(key) {
  const id = config[key];
  if (typeof id !== 'string' || !/^[\da-f-]{36}$/i.test(id)) throw new Error(`${key} is not deployed/configured. Complete the Fabric deployment first.`);
  return id;
}

async function ontology() {
  const id = requireItem('ontologyId');
  const envelope = await fabric(`${workspacePath}/items/${id}/getDefinition`, 'POST', {});
  const parts = envelope.definition?.parts;
  if (!Array.isArray(parts)) throw new Error('Fabric did not return ontology definition parts.');
  const decode = part => JSON.parse(Buffer.from(part.payload, 'base64').toString('utf8'));
  const entities = parts.filter(p => /^EntityTypes\/\d+\/definition.json$/.test(p.path)).map(decode);
  const relationships = parts.filter(p => /^RelationshipTypes\/\d+\/definition.json$/.test(p.path)).map(decode);
  const bindings = parts.filter(p => /\/DataBindings\//.test(p.path)).map(decode);
  const contextualizations = parts.filter(p => /\/Contextualizations\//.test(p.path)).map(decode);
  if (!entities.length || bindings.length !== entities.length || contextualizations.length !== relationships.length) {
    throw new Error('The live ontology has missing entity or relationship bindings.');
  }
  return { name: config.ontologyName, id, entities, relationships, bindings, contextualizations, verifiedAt: new Date().toISOString() };
}

async function agentSession(action) {
  const agentId = requireItem('dataAgentId');
  const accessToken = await token();
  const transport = new StreamableHTTPClientTransport(
    new URL(`${fabricBase}/mcp${workspacePath}/dataagents/${agentId}/agent`),
    { requestInit: { headers: { Authorization: `Bearer ${accessToken}`, 'x-ms-fabric-skill': attribution } } },
  );
  const client = new Client({ name: 'translink-planner-local', version: '0.1.0' });
  try {
    await client.connect(transport, { timeout: 60000 });
    const tools = await client.listTools();
    if (!tools.tools.length) throw new Error('The published Fabric agent advertised no query tools.');
    return await action(client, tools.tools);
  } finally {
    await client.close();
  }
}

async function publishedAgent() {
  const agentId = requireItem('dataAgentId');
  const ontologyId = requireItem('ontologyId');
  const envelope = await fabric(`${workspacePath}/dataAgents/${agentId}/getDefinition`, 'POST', {});
  const parts = envelope.definition?.parts;
  if (!Array.isArray(parts)) throw new Error('Fabric did not return the agent definition.');
  const contexts = parts.filter(part => /^Files\/Config\/published\/ontologies\/[^/]+\/ontology.json$/.test(part.path));
  const attached = contexts.map(part => JSON.parse(Buffer.from(part.payload, 'base64').toString('utf8')))
    .some(context => context.artifactId === ontologyId && context.workspaceId === config.workspaceId);
  if (!attached) throw new Error('The published agent is not attached to the configured Translink ontology. Attach and publish it in Fabric before querying.');
  return { agentId, ontologyId };
}

async function ask(question) {
  await publishedAgent();
  return agentSession(async (client, tools) => {
    if (tools.length !== 1) throw new Error('Unexpected Fabric tool inventory. Inspect the published agent before querying.');
    const tool = tools[0];
    const properties = tool.inputSchema.properties ?? {};
    const stringArguments = Object.entries(properties).filter(([, schema]) => schema && typeof schema === 'object' && schema.type === 'string');
    if (stringArguments.length !== 1) throw new Error('Unexpected Fabric query schema. Expected one text question argument.');
    const result = await client.callTool(
      { name: tool.name, arguments: { [stringArguments[0][0]]: question } },
      undefined, { timeout: 600000, maxTotalTimeout: 600000 },
    );
    if (result.isError) throw new Error(`Fabric agent tool failed: ${JSON.stringify(result.content).slice(0, 2000)}`);
    if (!Array.isArray(result.content)) throw new Error('Fabric agent returned no readable result.');
    const answer = result.content.filter(block => block.type === 'text' && typeof block.text === 'string').map(block => block.text).join('\n');
    if (!answer.trim()) throw new Error('Fabric agent returned an empty answer.');
    return {
      answer, evidence: result.structuredContent ?? result.content,
      workspaceId: config.workspaceId, agentId: config.dataAgentId,
      tool: tool.name, answeredAt: new Date().toISOString(),
    };
  });
}

async function readQuestion(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > 8192) throw new RangeError('Request is too large.');
  }
  const value = JSON.parse(body);
  if (!value || typeof value.question !== 'string' || !value.question.trim() || value.question.length > 2000) {
    throw new RangeError('Enter a question between 1 and 2000 characters.');
  }
  return value.question.trim();
}

async function handleRequest(request, response) {
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  const send = (status, data) => { response.writeHead(status); response.end(JSON.stringify(data)); };
  const allowedOrigins = hosted ? [publicOrigin.origin] : ['http://127.0.0.1:5173', 'http://localhost:5173'];
  if (request.headers.origin && !allowedOrigins.includes(request.headers.origin)) return send(403, { error: 'Only the configured planner UI may call this API.' });
  const allowedHosts = hosted ? [publicOrigin.host] : ['127.0.0.1:8787', '127.0.0.1:5173', 'localhost:5173'];
  if (!allowedHosts.includes(request.headers.host || '')) return send(403, { error: 'Invalid API host.' });
  try {
    if (request.url === '/health' && request.method === 'GET') return send(200, { status: 'ok' });
    if (request.url === '/api/config' && request.method === 'GET') {
      return send(200, { hosted, ...(hosted ? { clientId: staffConfig.clientId, tenantId: staffConfig.tenantId } : {}) });
    }
    if (hosted && !requestIdentity.getStore() && request.url?.startsWith('/api/')) {
      const delegatedToken = await authenticate(request);
      return await requestIdentity.run(delegatedToken, () => handleRequest(request, response));
    }
    if (request.url === '/api/fabric/ontology' && request.method === 'GET') return send(200, await ontology());
    if (request.url === '/api/fabric/status' && request.method === 'GET') {
      const liveOntology = await ontology();
      const published = await publishedAgent();
      const tools = await agentSession(async (_, inventory) => inventory.map(t => t.name));
      return send(200, { connected: true, ontologyGrounded: true, ontologyId: published.ontologyId, agentId: published.agentId, ontology: liveOntology.name, entityCount: liveOntology.entities.length, tools, identity: hosted ? 'Microsoft Entra signed-in staff user' : 'Local Azure CLI signed-in user', workspaceId: config.workspaceId });
    }
    if (request.url === '/api/agent' && request.method === 'POST') {
      if (!request.headers['content-type']?.startsWith('application/json')) return send(415, { error: 'Expected application/json.' });
      return send(200, await ask(await readQuestion(request)));
    }
    if (hosted && ['GET', 'HEAD'].includes(request.method) && !request.url?.startsWith('/api/')) {
      const path = decodeURIComponent(new URL(request.url, publicOrigin).pathname);
      const file = resolve(staticRoot, `.${path === '/' ? '/index.html' : path}`);
      if (!file.startsWith(`${staticRoot}${sep}`)) return send(403, { error: 'Invalid asset path.' });
      try {
        const content = await readFile(file);
        response.setHeader('Content-Type', mimeTypes[extname(file)] || 'application/octet-stream');
        response.writeHead(200);
        response.end(request.method === 'HEAD' ? undefined : content);
        return;
      } catch (error) {
        if (error.code !== 'ENOENT' && error.code !== 'EISDIR') throw error;
        return send(404, { error: 'Asset not found.' });
      }
    }
    return send(404, { error: 'Unknown API route.' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected Fabric integration error.';
    console.error(`[${new Date().toISOString()}] ${request.method} ${request.url}: ${message}`);
    return send(error instanceof AuthenticationError ? 401 : error instanceof RangeError || error instanceof SyntaxError ? 400 : 502, { error: message });
  }
}
const server = createServer(handleRequest);
server.requestTimeout = 660000;
server.listen(port, hosted ? '0.0.0.0' : '127.0.0.1', () => console.log(`Translink API listening on port ${port} (${hosted ? 'per-user Microsoft Entra authentication' : 'local Azure CLI identity only'})`));
