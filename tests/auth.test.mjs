import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AuthenticationError, validateStaffClaims, staffAuthentication } from '../server/auth.mjs';

const clientId = '12345678-1234-1234-1234-123456789012';
const tenantId = '87654321-4321-4321-4321-210987654321';
test('requires a delegated staff identity from the configured tenant and client', () => {
  assert.doesNotThrow(() => validateStaffClaims({ tid: tenantId, azp: clientId, oid: 'staff', scp: 'Item.Read.All' }, clientId, tenantId));
  assert.doesNotThrow(() => validateStaffClaims({ tid: tenantId, appid: clientId, oid: 'staff', scp: 'Item.Read.All' }, clientId, tenantId));
  for (const payload of [
    { tid: 'other', azp: clientId, oid: 'staff', scp: 'Item.Read.All' },
    { tid: tenantId, azp: 'other', oid: 'staff', scp: 'Item.Read.All' },
    { tid: tenantId, azp: clientId, oid: 'app', roles: ['Item.Read.All'] },
    { tid: tenantId, azp: clientId, scp: 'Item.Read.All' },
  ]) assert.throws(() => validateStaffClaims(payload, clientId, tenantId), AuthenticationError);
});
test('hosted authentication fails closed when configuration or token is missing', async () => {
  assert.throws(() => staffAuthentication({}), /requires/);
  const authenticate = staffAuthentication({ tenantId, clientId, fabricAudience: 'https://api.fabric.microsoft.com' });
  await assert.rejects(() => authenticate({ headers: {} }), AuthenticationError);
  await assert.rejects(() => authenticate({ headers: { authorization: 'Bearer not-a-signed-token' } }), AuthenticationError);
});
