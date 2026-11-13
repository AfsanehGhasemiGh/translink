import { UserDataFunctions, AudienceType, type RayfinContext } from '@microsoft/fabric-user-data-functions';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const udf = new UserDataFunctions();
const workspaceId = '68067d79-2c1d-4c80-89fe-42087c7890f5';
const ontologyId = '1a3f6ea0-52fc-458f-a34b-c1561cdc50cb';
const legacyId = '5010003c-9c95-4671-8809-1fee9d1ab2bf';
const base = 'https://api.fabric.microsoft.com/v1';

async function definition(token: string) {
  const headers = { Authorization: `Bearer ${token}`, 'x-ms-fabric-skill': 'ontology-cli', 'Content-Type': 'application/json' };
  let response = await fetch(`${base}/workspaces/${workspaceId}/items/${legacyId}/getDefinition`, {
    method: 'POST', headers, body: '{}', signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Fabric definition read failed (${response.status}): ${await response.text()}`);
  if (response.status === 202) {
    const operation = response.headers.get('x-ms-operation-id');
    if (!operation || !/^[\da-f-]{36}$/i.test(operation)) throw new Error('Fabric returned no valid operation ID.');
    let ready = false;
    for (let i = 0; i < 30; i++) {
      await new Promise(resolve => setTimeout(resolve, 1500));
      const poll = await fetch(`${base}/operations/${operation}`, { headers, signal: AbortSignal.timeout(15000) });
      if (!poll.ok) throw new Error(`Fabric operation read failed (${poll.status}).`);
      const state = await poll.json() as { status: string; error?: unknown };
      if (state.status === 'Succeeded') { ready = true; break; }
      if (['Failed', 'Cancelled'].includes(state.status)) throw new Error(`Fabric definition operation failed: ${JSON.stringify(state.error)}`);
    }
    if (!ready) throw new Error('Fabric definition read timed out.');
    response = await fetch(`${base}/operations/${operation}/result`, { headers, signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Fabric definition result failed (${response.status}).`);
  }
  const envelope = await response.json() as { definition: { parts: { path: string; payload: string }[] } };
  const parts = envelope.definition.parts;
  const decode = (p: { payload: string }) => JSON.parse(Buffer.from(p.payload, 'base64').toString('utf8'));
  return {
    name: 'TranslinkTransport (original data-agent bindings)', id: legacyId,
    entities: parts.filter(p => /^EntityTypes\/\d+\/definition.json$/.test(p.path)).map(decode),
    relationships: parts.filter(p => /^RelationshipTypes\/\d+\/definition.json$/.test(p.path)).map(decode),
    bindings: parts.filter(p => /\/DataBindings\//.test(p.path)).map(decode),
    verifiedAt: new Date().toISOString(),
  };
}

udf.func('planner', async (
  ctx: RayfinContext<Record<string, never>, AudienceType.Fabric>,
  operation: string,
  question: string,
): Promise<string> => {
  if (!['status', 'ontology', 'ask'].includes(operation)) throw new Error('Unsupported planner operation.');
  if (operation === 'ask' && (question.trim().length < 3 || question.length > 2000)) {
    throw new Error('Enter a question between 3 and 2000 characters.');
  }
  const token = ctx.Tokens.Fabric;
  if (operation === 'ontology') return JSON.stringify(await definition(token));
  const client = new Client({ name: 'translink-rayfin', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(
    new URL(`${base}/mcp/dataPlane/workspaces/${workspaceId}/items/${ontologyId}/ontologyEndpoint`),
    { requestInit: { headers: { Authorization: `Bearer ${token}`, 'x-ms-fabric-skill': 'ontology-cli' } } },
  );
  try {
    await client.connect(transport, { timeout: 30000 });
    const inventory = await client.listTools();
    if (!inventory.tools.some(tool => tool.name === 'ask_ontology')) throw new Error('The V2 ontology query tool is unavailable.');
    if (operation === 'status') {
      return JSON.stringify({ connected: true, entityCount: 8, ontology: 'TranslinkTransportV2', ontologyId, workspaceId, identity: 'Fabric app owner (Rayfin application authentication)' });
    }
    const result = await client.callTool({
      name: 'ask_ontology',
      arguments: { request: `${question.trim()}\nUse bound data. Static GTFS only: no live passenger demand, capacity or crowding. Respect service calendars/date exceptions; proximity is straight-line, not walking access. Distinguish scenario assumptions from observed facts. When a total and sample examples are requested, compute the total on the full deduplicated match before TOP/LIMIT; never label the sample count as the total.\nPresentation requirements: Give the exact result first, not a description of your process. Return Markdown in this order: ## Answer (a compact table or 1-3 short sentences, at most 100 words including essential limitations), ## Sources (one concise line naming actual bound entities/tables), ## Evidence (executed SQL or query results and necessary calculation/assumption details). Put all detailed query material under ## Evidence, even when the question requests SQL. No internal reasoning, discovery narration, planning steps or unsolicited follow-up offers. For hypothetical questions clearly label the result illustrative, not an actual dated timetable. Never invent source citations or executed queries.` },
    }, undefined, { timeout: 180000, maxTotalTimeout: 180000 });
    if (result.isError) throw new Error(`Ontology agent failed: ${JSON.stringify(result.content)}`);
    const answer = (result.content as { type: string; text?: string }[]).filter(c => c.type === 'text').map(c => c.text).join('\n');
    if (!answer.trim()) throw new Error('Ontology returned an empty response.');
    return JSON.stringify({ answer, evidence: result.structuredContent ?? result.content, tool: 'ask_ontology', answeredAt: new Date().toISOString(), ontologyId, workspaceId });
  } finally {
    await client.close();
  }
}, []);
