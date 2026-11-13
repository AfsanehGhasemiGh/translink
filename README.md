# Translink Community Impact Studio

A business demonstration for public transport planners: a pitched 3D Brisbane map, official Translink route shapes and stops, Suncorp Stadium focus, editable frequency/transfer scenarios, a real Fabric ontology and a published Fabric data agent.

## Fabric-hosted app

**[Open TranslinkPlannerApp](https://wide-grove-1455796ee4-westus.webapp.fabricapps.net/)** — Fabric sign-in and app permission required.

[Manage the Fabric app](https://app.fabric.microsoft.com/groups/68067d79-2c1d-4c80-89fe-42087c7890f5/appbackends/12e35b97-3730-418a-866a-043e201959e4)

This is a real Rayfin **AppBackend** item in the Translink workspace, with protected static hosting and a Fabric-hosted planner function. No Azure App Service was provisioned. Rayfin is configured in [rayfin.yml](rayfin/rayfin.yml); deployment commands are `npx rayfin login`, `npx rayfin up`, and `npx rayfin up status --json`.

The hosted chat invokes **TranslinkTransportV2** through `ask_ontology`, using platform-provided Fabric tokens server-side. Rayfin Functions use the **app owner identity**, not each visitor's external Fabric permissions; the user explicitly approved this model for the public Translink demo data. App sign-in and invocation authorization remain enforced by Fabric.

The deployed app automatically restores Fabric SSO, refreshes an existing standalone session when possible, and verifies the backend on startup. When connected, the extra sign-in/retry controls are hidden and **Ask Fabric** is enabled. Select **Use Q1**, then **Ask Fabric**. **Copy Q1–Q4** copies the prompt. A first sign-in, expired/revoked session or tenant MFA policy can still require **Continue with Fabric**; authentication is never bypassed. See [DEMO.md](DEMO.md) for the talk track and limitations.

The Entra security group **Translink Demo Users** has verified **Viewer** access to the Translink workspace for read-only inspection of its data and ontologies. The existing demo account is a verified member. Rayfin documents Run and interact as the default for workspace members; verify effective app **Read and execute** permission during sign-in. No workspace editing, tenant administrator role or app ownership is granted.

Membership is administered **outside this application**, by an administrator or a separate onboarding app. The Translink app has no group self-join UI or directory-membership write capability. Group membership does not bypass Entra registration/MFA policies or licence requirements. Demo-user end-to-end access is not yet verified because its security-registration onboarding remains unresolved.

The **[HTML presenter guide](https://wide-grove-1455796ee4-westus.webapp.fabricapps.net/talk-track.html)** includes the planner-focused talk track, source datasets and transformations, architecture flows, identity boundaries, copyable Q1–Q4 prompts and accuracy limitations. The revised story covers candidate stadium buses, Milton closure exposure, extra evening frequency and a delayed interchange. Technical route counts remain baseline checks rather than the opening story. Open **Presenter guide** from the app header or print the guide to PDF.

Hosted answers request a concise **Answer** followed by **Sources**; detailed SQL and assumptions under **Evidence** are collapsed separately. The UI renders sanitized Markdown tables/bullets and scrolls to the answer. It preserves the returned text and raw payload rather than substituting expected values.

On 13 November 2026, browser tests on the deployed URL passed Fabric sign-in, connection check, Q1 (8 bus / 56 rail), Q2 (30 links, nearest stops 814/815/817), Q3 (10-to-5-minute illustrative wait; 3-to-6 services/hour), Q4 (hypothetical connection missed by 2 minutes), and Copy Q1. Source/query evidence came from the actual V2 ontology tool response. Eight focused unit tests and the frontend build passed. The SDK-decoded JSON response bug that disabled Ask Fabric was fixed.

## Run locally

Requires Node.js 22. Run these commands in this folder:

```powershell
npm install
npm run dev
```

Open http://127.0.0.1:5173. The map uses OpenFreeMap/OpenStreetMap tiles and needs internet access. Map buildings appear when zoomed into areas with building footprints. No map API key is needed.

For the Fabric agent, sign in with Azure CLI as an authorized user, then start the backend in a second terminal:

```powershell
az login
npm run api
```

In the UI, select **Check connection**, then enter a free-text question under **Ask the Fabric planning agent**. Tokens stay in the loopback-only backend, never in the browser or source files. The backend verifies the live ontology, its bindings, and the published agent's actual ontology reference before showing connected status. Agent questions use the published Fabric MCP endpoint, not predefined answers.

In local mode this is a **single-user demo**: Fabric requests use the Azure CLI signed-in user. Do not expose local mode publicly.

The abandoned Azure App Service path retains experimental per-user Entra authentication code and Bicep files. It was not provisioned and is **not** the current hosting runtime. Fabric Rayfin uses its own brokered sign-in and protected hosting.

Hosting requires `HOSTED_MODE=true` (automatically enforced on App Service), `PUBLIC_ORIGIN` (HTTPS), `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `FABRIC_TOKEN_AUDIENCE`, and the platform `PORT`. `npm start` serves built assets and API together. `/health` is a non-sensitive process health probe; `/api/config` publishes only the public sign-in configuration. These changes are preparation, not evidence that hosting has been provisioned.

The official network snapshot is included under `public\data\network.json`. To refresh it:

```powershell
npm run data:refresh
```

The import downloads the official SEQ GTFS ZIP, selects major bus corridors and rail shapes intersecting inner Brisbane, and retains stop locations within the study bounds. It selects one representative shape per route and direction, not every variant. Feed dates, source, import timestamp and licence are stored in the snapshot. No stop-to-route relationship is inferred from proximity.

## Five-minute business walkthrough

1. Explore the map, toggle bus and rail layers, search for Milton or Roma Street, and select a service.
2. Select **Explore event access** to focus on Suncorp Stadium.
3. Open **Scenario lab**. Compare a 20-minute baseline headway with a 10-minute proposed headway: illustrative expected wait falls from 10 to 5 minutes.
4. Change arrival shift to 10 minutes with an 8-minute assumed transfer window: the hypothetical connection is missed by 2 minutes.
5. Select **Check connection** and ask: "How many distinct route IDs are in the dataset, grouped by bus and rail?"
6. Ask: "For Suncorp Stadium, count all venue-to-stop link records and show the three closest stop records with their names and distance_metres. Clarify the distance method."
7. Select **Connected knowledge** or **Open V2 ontology graph in Fabric** to open **TranslinkTransportV2** in Fabric's native graph experience and use its built-in Ontology Agent (Fabric sign-in and permissions required). Use **Inspect data-agent source bindings** for the original ontology's local live-definition dialog.

### Ontology version compatibility

The graph links now target the saved **TranslinkTransportV2** ontology, with 8 entity types and 7 relationships. Its built-in Ontology Agent successfully queried Suncorp Stadium from `TranslinkNetwork.dbo.venues`. Its MCP endpoint advertises `ask_ontology`; the real entity metadata was saved in [v2-entities.json](fabric/v2-entities.json).

The older **TranslinkPlanner data agent** remains attached to the original V1 **TranslinkTransport** ontology, which still works for that separate agent. The **hosted Rayfin chat** instead invokes **TranslinkTransportV2** directly. `graphOntologyId` selects the V2 native graph, while `ontologyId` retains the original binding inspector. Do not delete the original while that inspector and separate published agent depend on it. Migration state is recorded in [v2-migration.json](fabric/v2-migration.json). The legacy `prepare-fabric-ontology.mjs` script cannot create V2.

## Deployed Fabric backend

[Translink workspace](https://app.fabric.microsoft.com/groups/68067d79-2c1d-4c80-89fe-42087c7890f5/list) uses the existing capacitywestus F16 capacity. No new capacity was purchased or resized.

- Managed Lakehouse: **TranslinkNetwork**
- Ingestion notebook: **Translink_Ingest_GTFS**
- Ontology: **TranslinkTransport** (8 entity types, 7 relationship types, 8 static entity bindings and 7 relationship contextualizations)
- Published data agent: **TranslinkPlanner**, with the ontology attached and preview runtime enabled

The verified ingestion contains 64 route records (8 bus, 56 rail service-pattern records), 23,161 trips, 860 served stops/parent stations, 595,587 scheduled stop calls, 29 service calendars, 24 date overrides, 1 venue and 30 approximate proximity links. These are feed-wide counts, not daily departures. The map's separate 3,573-stop snapshot is geographic context; Fabric includes stops served by the selected routes and their parent stations.

The ingestion notebook uses [ingest-gtfs.py](fabric/ingest-gtfs.py). Source schemas and counts are recorded in [source-validation.json](fabric/source-validation.json). Resource IDs are in [deployment.json](fabric/deployment.json); ontology IDs are persisted in [ontology-ids.json](fabric/ontology-ids.json). The local-only `fabric/agent-applied.json` readback of the published agent is excluded from Git, along with environment files, deployment-session notes and credential caches. Deployment IDs in the source identify the demo environment; they grant no access, and another deployment must replace them with its own discovered resources.

To prepare a notebook or ontology envelope after changing the source/configuration:

```powershell
node scripts\prepare-fabric-notebook.mjs
node scripts\prepare-fabric-ontology.mjs
```

These commands only prepare payloads; they do not deploy, refresh or publish. Source changes require rerunning the Fabric notebook, refreshing the ontology/context as appropriate, republishing the agent when its configuration changes, and rerunning live tests. Ontology changes replace definition parts: fetch current state and review the complete change set before applying.

The data, ontologies, **Rayfin web UI and planner function are deployed in Fabric**. The original standalone Node proxy remains available only for legacy local development and is not used by the deployed Rayfin app.

## Boundaries

- Independent concept demo, not an official Translink application.
- Official geography, but not a full-network or live operational service.
- Headways and transfer windows are user assumptions. The comparison assumes uniform arrivals and evenly spaced services. It is not a journey planner or a validated transport simulation.
- The agent can query ingested scheduled stop times. No live vehicles, demand, capacity, population impacts, event operations or verified walking links are available.
- Guided planning stories remain predefined explanations. The separate **Ask Fabric** form returns generated, source-grounded answers from the published agent.
- Fabric IQ ontology and agent integration use preview capabilities. Generated answers can be incorrect; inspect evidence. Service-date questions must apply calendars, date exceptions and GTFS times beyond 24:00.
- Venue links are approximate great-circle distances within 1,200 metres, not pedestrian routes or evidence of event service.
- Route geometry does not change for headway or shift scenarios; these change the numerical comparison only.
- Local server binds to loopback, not the public network.

## Validation

```powershell
npm run build
npm test
```

With both local servers running, verify the live ontology, published agent attachment, missing-data response and API input/origin checks:

```powershell
npm run test:fabric
```

Live tests require Fabric permissions and consume agent compute. Browser validation additionally tested route counts (8 bus and 56 rail), 595,587 stop calls, and a three-table venue/stop query yielding 30 links with explicit distance limitations.

Validation completed on 11 November 2026: production build, 3 scenario unit tests and 4 live Fabric tests passed. The browser additionally reverified the live ontology panel and a fresh agent route-count query through the same-origin UI proxy.

## Attribution

Transport geometry: [Translink / Queensland Department of Transport and Main Roads GTFS](https://www.data.qld.gov.au/dataset/general-transit-feed-specification-gtfs-translink), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The data has been filtered and transformed for this demonstration.

Basemap: OpenFreeMap, OpenMapTiles and OpenStreetMap contributors; attribution is shown on the map.
