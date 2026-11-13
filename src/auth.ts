import { InteractionRequiredAuthError, PublicClientApplication } from '@azure/msal-browser';

type AuthConfig = { hosted: boolean; clientId?: string; tenantId?: string };
let client: PublicClientApplication | undefined;
let initialization: Promise<void> | undefined;
const scopes = ['https://api.fabric.microsoft.com/.default'];

async function setup() {
  const response = await fetch('/api/config');
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('The local or hosted API is unavailable. Start the API server or check hosting health.');
  }
  const config = await response.json() as AuthConfig;
  if (!config.hosted) return;
  if (!config.clientId || !config.tenantId) throw new Error('Hosted staff sign-in is not configured.');
  client = new PublicClientApplication({
    auth: {
      clientId: config.clientId,
      authority: `https://login.microsoftonline.com/${config.tenantId}`,
      redirectUri: window.location.origin,
    },
    cache: { cacheLocation: 'memoryStorage' },
  });
  await client.initialize();
  const result = await client.handleRedirectPromise();
  const account = result?.account ?? client.getAllAccounts()[0];
  if (account) client.setActiveAccount(account);
}

export async function authenticationHeaders(): Promise<Record<string, string>> {
  await (initialization ??= setup().catch(error => {
    initialization = undefined;
    throw error;
  }));
  if (!client) return {};
  const account = client.getActiveAccount();
  if (!account) throw new Error('Staff sign-in is required. Select Sign in to continue.');
  try {
    const result = await client.acquireTokenSilent({ scopes, account });
    return { Authorization: `Bearer ${result.accessToken}` };
  } catch (error) {
    if (error instanceof InteractionRequiredAuthError) {
      throw new Error('Staff sign-in or consent is required. Select Sign in to continue.');
    }
    throw error;
  }
}

export async function signIn() {
  await (initialization ??= setup());
  if (!client) throw new Error('This local demo uses Azure CLI authentication; use az login.');
  await client.loginRedirect({ scopes });
}
