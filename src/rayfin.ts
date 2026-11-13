import { RayfinClient, resolveRayfinConfig } from '@microsoft/rayfin-client';
import { initEmbeddedAuth, ensureSignedInWithFabric } from '@microsoft/rayfin-auth-provider-fabric';
import { parsePlannerResponse } from './planner-response.mjs';
import { restoreFabricSession } from './fabric-session.mjs';

type PlannerSchema = {
  planner: { input: { operation: string; question: string }; output: string };
};
let cached: Promise<RayfinClient<Record<string, never>, PlannerSchema>> | undefined;
let activeClient: RayfinClient<Record<string, never>, PlannerSchema> | undefined;
export const isRayfin = () => Boolean(import.meta.env.VITE_RAYFIN_API_URL);
export const isRayfinSignedIn = () => {
  const session = activeClient?.auth.getSession();
  return Boolean(session?.isAuthenticated && !session.isAnonymous);
};

async function client() {
  return cached ??= (async () => {
    const resolved = await resolveRayfinConfig({
      apiUrl: import.meta.env.VITE_RAYFIN_API_URL,
      publishableKey: import.meta.env.VITE_RAYFIN_PUBLISHABLE_KEY,
      workspaceId: import.meta.env.VITE_FABRIC_WORKSPACE_ID,
      itemId: import.meta.env.VITE_FABRIC_ITEM_ID,
      portalUrl: import.meta.env.VITE_FABRIC_PORTAL_URL,
    });
    if (!resolved.baseUrl || !resolved.publishableKey) throw new Error('Rayfin deployment configuration is missing.');
    const instance = new RayfinClient<Record<string, never>, PlannerSchema>({
      baseUrl: resolved.baseUrl, publishableKey: resolved.publishableKey,
      runtimeConfig: resolved.runtimeConfig, authStorage: true,
    });
    const runtime = instance.runtimeConfig;
    if (!runtime?.workspaceId || !runtime.itemId || !runtime.portalUrl) throw new Error('Rayfin Fabric item configuration is missing.');
    const embeddedSession = await initEmbeddedAuth(instance.auth, {
      workspaceId: runtime.workspaceId, projectId: runtime.itemId,
      fabricPortalUrl: runtime.portalUrl, returnOrigin: window.location.origin,
    });
    if (window.parent !== window && !embeddedSession) {
      throw new Error('Fabric SSO could not establish the current embedded user. Reopen the app from Fabric or reconnect.');
    }
    await restoreFabricSession(instance.auth, window.parent === window || Boolean(embeddedSession));
    activeClient = instance;
    return instance;
  })().catch(error => { cached = undefined; throw error; });
}

export async function watchRayfinSession(listener: (signedIn: boolean) => void) {
  const instance = await client();
  return instance.auth.onSessionChange(session => listener(Boolean(session?.isAuthenticated && !session.isAnonymous)));
}

export async function rayfinSignIn() {
  const instance = await client();
  const runtime = instance.runtimeConfig!;
  await ensureSignedInWithFabric(instance.auth, {
    workspaceId: runtime.workspaceId!, projectId: runtime.itemId!,
    fabricPortalUrl: runtime.portalUrl!, returnOrigin: window.location.origin,
  });
}

export async function rayfinApi<T>(url: string, options?: RequestInit): Promise<T> {
  const instance = await client();
  if (!await restoreFabricSession(instance.auth, true)) throw new Error('Your Fabric session requires sign-in. Select Continue with Fabric.');
  const operation = url === '/api/fabric/status' ? 'status' : url === '/api/fabric/ontology' ? 'ontology' : url === '/api/agent' ? 'ask' : '';
  if (!operation) throw new Error('Unknown planner route.');
  const question = operation === 'ask' ? (JSON.parse(String(options?.body)) as { question: string }).question : '';
  const output = await instance.functions.planner.invoke({ operation, question }, { timeoutMs: 230000 });
  return parsePlannerResponse(output, operation) as T;
}
