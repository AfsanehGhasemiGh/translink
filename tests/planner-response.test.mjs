import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePlannerResponse, splitPlannerAnswer } from '../src/planner-response.mjs';

test('accepts SDK-decoded status objects and legacy JSON strings', () => {
  const status = { connected: true, entityCount: 8 };
  assert.deepEqual(parsePlannerResponse(status, 'status'), status);
  assert.deepEqual(parsePlannerResponse(JSON.stringify(status), 'status'), status);
});
test('keeps answer evidence from SDK-decoded responses', () => {
  const answer = { answer: '8 bus routes', evidence: [{ source: 'routes' }] };
  assert.equal(parsePlannerResponse(answer, 'ask'), answer);
});
test('invalid or success-shaped empty responses fail explicitly', () => {
  for (const output of [null, [], 'null', false]) {
    assert.throws(() => parsePlannerResponse(output, 'status'));
  }
  assert.throws(() => parsePlannerResponse({ connected: false, entityCount: 8 }, 'status'));
  assert.throws(() => parsePlannerResponse({ answer: '' }, 'ask'));
});
test('separates exact answer and citations from optional query details without truncating them', () => {
  const text = '## Answer\nBus: **8**. Rail: **56**.\n## Sources\n`dbo.routes`\n## Evidence\n```sql\nSELECT mode FROM dbo.routes;\n```';
  const result = splitPlannerAnswer(text);
  assert.equal(result.answer, '## Answer\nBus: **8**. Rail: **56**.\n## Sources\n`dbo.routes`');
  assert.equal(result.evidence, '## Evidence\n```sql\nSELECT mode FROM dbo.routes;\n```');
});
test('retains unstructured answers and does not split headings inside a code fence', () => {
  const text = '## Answer\nExample\n~~~text\n## Evidence\n~~~\nSource: routes';
  assert.deepEqual(splitPlannerAnswer(text), { answer: text, evidence: '' });
});
