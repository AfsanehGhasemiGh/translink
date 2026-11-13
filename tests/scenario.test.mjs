import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateScenario } from '../src/scenario.mjs';

test('doubling frequency halves expected waiting time', () => {
  const result = calculateScenario(20, 10, 0);
  assert.equal(result.baselineWait, 10);
  assert.equal(result.proposedWait, 5);
  assert.equal(result.waitChange, -5);
  assert.equal(result.proposedServices, 6);
});
test('shift exceeding transfer window flags a missed connection', () => {
  assert.equal(calculateScenario(15, 15, 9, 8).missedConnection, true);
  assert.equal(calculateScenario(15, 15, 8, 8).missedConnection, false);
  assert.equal(calculateScenario(15, 15, 0, 8).remainingTransfer, 8);
});
test('rejects invalid input rather than inventing results', () => {
  for (const value of [0, -1, 61, NaN, Infinity]) {
    assert.throws(() => calculateScenario(value, 10, 0), RangeError);
  }
  assert.throws(() => calculateScenario(10, 10, 31), RangeError);
});
