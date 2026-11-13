# Translink App Service IaC

This deployment references the existing resource group `rsc` and existing Linux
B1 plan `asp-cwydrbyit`. It creates only `app-translink-dev-44c6`; the existing
resource group and plan are intentionally not created, retagged, resized, or
otherwise modified.

No Key Vault, secrets, supporting services, or RBAC role assignments are needed:
the application uses Entra authorization-code-with-PKCE and has no client
secret. The App Service managed identity is retained as a platform identity,
but receives no role assignment because this app has no Azure data-plane
dependency.

## Remaining Entra prerequisites

1. Register the web app `Translink Planner Web 44c6` in tenant
   `e043baf8-95d9-4854-af77-1d67feb403a5` as a SPA.
2. Set its redirect URI to the deployed App Service HTTPS origin, using the
   `defaultHostName` deployment output (for example,
   `https://<defaultHostName>/`), and provide that client ID as
   `entraClientId` at deployment time.
3. Configure the required delegated Fabric permission for the selected Fabric
   API and obtain tenant/admin consent if tenant policy requires it.
4. Ensure each staff user has the required Fabric workspace and data-agent
   permissions.

`PUBLIC_ORIGIN` is derived from the App Service `defaultHostName`; rerun/update
the app settings after registration only if the final redirect origin differs.
