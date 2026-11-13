import { createRemoteJWKSet, jwtVerify } from 'jose';

export class AuthenticationError extends Error {}

export function validateStaffClaims(payload, clientId, tenantId) {
  if (payload.tid !== tenantId || (payload.azp ?? payload.appid) !== clientId) {
    throw new AuthenticationError('Sign in through the authorized Translink staff application.');
  }
  if (typeof payload.scp !== 'string' || !payload.scp.trim() || typeof payload.oid !== 'string') {
    throw new AuthenticationError('A delegated staff user token is required.');
  }
}

export function staffAuthentication({ tenantId, clientId, fabricAudience }) {
  if (![tenantId, clientId, fabricAudience].every(value => typeof value === 'string' && value.trim())) {
    throw new Error('Hosted mode requires ENTRA_TENANT_ID, ENTRA_CLIENT_ID and FABRIC_TOKEN_AUDIENCE.');
  }
  if (!/^[\da-f-]{36}$/i.test(tenantId) || !/^[\da-f-]{36}$/i.test(clientId)) {
    throw new Error('Hosted Entra tenant and client IDs must be GUIDs.');
  }
  const keys = createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`));
  return async request => {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new AuthenticationError('Staff sign-in is required.');
    const accessToken = header.slice(7);
    try {
      const { payload } = await jwtVerify(accessToken, keys, {
        audience: fabricAudience,
        issuer: [
          `https://login.microsoftonline.com/${tenantId}/v2.0`,
          `https://sts.windows.net/${tenantId}/`,
        ],
        algorithms: ['RS256'],
      });
      validateStaffClaims(payload, clientId, tenantId);
      return accessToken;
    } catch (error) {
      console.error('Staff token verification failed:', error instanceof Error ? error.message : 'Unknown token error');
      throw new AuthenticationError('Your staff session is invalid or expired. Sign in again.');
    }
  };
}
