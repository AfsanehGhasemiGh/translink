import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const base = 'http://127.0.0.1:5173';
const manifest = JSON.parse(await readFile(new URL('../fabric/source-validation.json', import.meta.url), 'utf8'));
const deployment = JSON.parse(await readFile(new URL('../fabric/deployment.json', import.meta.url), 'utf8'));
async function api(path, body) {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(600000),
  });
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  return result;
}

test('live ontology has all eight source bindings and seven relationships', async () => {
  const ontology = await api('/api/fabric/ontology');
  assert.equal(ontology.id, deployment.ontologyId);
  assert.equal(ontology.entities.length, 8);
  assert.equal(ontology.relationships.length, 7);
  assert.equal(ontology.bindings.length, 8);
  assert.equal(ontology.contextualizations.length, 7);
  const tables = ontology.bindings.map(binding => binding.dataBindingConfiguration.sourceTableProperties.sourceTableName).sort();
  assert.deepEqual(tables, Object.keys(manifest.counts).sort());
});

test('published agent references the deployed ontology and advertises a query tool', async () => {
  const status = await api('/api/fabric/status');
  assert.equal(status.connected, true);
  assert.equal(status.ontologyGrounded, true);
  assert.equal(status.ontologyId, deployment.ontologyId);
  assert.equal(status.agentId, deployment.dataAgentId);
  assert.equal(status.tools.length, 1);
});

test('agent explicitly declines unavailable live crowding and demand data', { timeout: 620000 }, async () => {
  const result = await api('/api/agent', {
    question: 'Does this dataset contain live passenger crowding, vehicle capacities or measured event passenger demand? State any missing data explicitly. Do not estimate those quantities.',
  });
  assert.match(result.answer, /no |not |unavailable|missing|doesn.t|does not/i);
  assert.match(result.answer, /crowding|demand|passenger/i);
  assert.equal(result.agentId, deployment.dataAgentId);
  console.log('Fabric guardrail answer:', result.answer);
});

test('local API rejects blank questions and untrusted browser origins', async () => {
  const blank = await fetch(`${base}/api/agent`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: '' }),
  });
  assert.equal(blank.status, 400);
  const crossOrigin = await fetch(`${base}/api/agent`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://example.com' },
    body: JSON.stringify({ question: 'Test' }),
  });
  assert.equal(crossOrigin.status, 403);
});
