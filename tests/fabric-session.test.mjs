import { test } from 'node:test';
import assert from 'node:assert/strict';
import { restoreFabricSession } from '../src/fabric-session.mjs';

test('reuses a current nonanonymous session without a refresh', async () => {
  const auth = {
    getSession: () => ({ isAuthenticated: true, isAnonymous: false }),
    hasRefreshToken: () => { throw new Error('Refresh should not be inspected.'); },
  };
  assert.equal(await restoreFabricSession(auth, true), true);
});
test('refreshes an expired standalone session silently', async () => {
  let refreshed = false;
  const auth = {
    getSession: () => ({ isAuthenticated: refreshed, isAnonymous: false }),
    hasRefreshToken: () => true,
    refreshSession: async () => { refreshed = true; },
  };
  assert.equal(await restoreFabricSession(auth, true), true);
});
test('never trusts persisted identity when the embedded handoff was not established', async () => {
  const auth = { getSession: () => { throw new Error('Stale identity must not be read.'); } };
  assert.equal(await restoreFabricSession(auth, false), false);
});
test('missing or anonymous sessions need sign-in; refresh failure is not hidden', async () => {
  const auth = { getSession: () => ({ isAuthenticated: true, isAnonymous: true }), hasRefreshToken: () => false };
  assert.equal(await restoreFabricSession(auth, true), false);
  const expired = {
    getSession: () => ({ isAuthenticated: false }),
    hasRefreshToken: () => true,
    refreshSession: async () => { throw new Error('Refresh revoked'); },
  };
  await assert.rejects(() => restoreFabricSession(expired, true), /Refresh revoked/);
});
