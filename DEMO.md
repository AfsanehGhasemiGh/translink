# Translink planner demo

**[Open the Fabric app](https://wide-grove-1455796ee4-westus.webapp.fabricapps.net/)** · **[HTML presenter guide: talk track, sources and architecture](https://wide-grove-1455796ee4-westus.webapp.fabricapps.net/talk-track.html)**

The app header includes **Presenter guide**. Its HTML source is [public/talk-track.html](public/talk-track.html), with copyable prompts and print/PDF support.

## Five-minute story

“I am planning access to a Suncorp Stadium event. Which bus corridors are candidates? What would a Milton station closure affect? Could extra evening services reduce waiting, and would a delayed train break an interchange connection? We can explore those decisions using the transport ontology, while separating facts from planning assumptions.”

1. Show the Brisbane map and Suncorp Stadium focus.
2. Open the app through Fabric or its protected URL. Fabric SSO and the backend check run automatically; wait for confirmed status and an enabled **Ask Fabric**. If prompted, use **Continue with Fabric** for an expired/missing session. Connected users do not need a separate backend sign-in.
3. Select **Use Q1** and submit. Lead with the short answer and its source citation. Keep SQL and raw evidence collapsed unless the audience requests them.
4. Select **Use Q2** for a station-closure exposure question.
5. Use **Q3/Q4** or the scenario sliders to compare hypothetical choices.
6. Open the ontology graph to explain why places, stops, trips and routes share one planning context.

## Q1 — Which buses could support a stadium event?

> Which bus routes in our selected network have scheduled calls at stops within 1,200 metres straight-line of Suncorp Stadium? Show distinct route numbers and public route names, using Venue, VenueStopLink, StopCall, Trip and Route. These are candidates for event planning, not confirmed event services or walking access. Cite the source; put query details in Evidence.

Expected shape: a deduplicated candidate bus-route list with public names, source citation and proximity limitation.

Talk track: “This narrows the corridors worth investigating. Actual stop calls establish route membership. We still need a date-specific event timetable and validated walking links before claiming useful event journeys.”

## Q2 — What if Milton station closes?

> If Milton station is unavailable, which selected rail service patterns would be affected? Use actual scheduled calls at Milton station platforms. Compute the total distinct rail route IDs over ALL matching routes BEFORE limiting displayed examples; do not count just the top five. Show that total and up to five public route-name examples. This is a hypothetical closure across the feed, not a dated disruption forecast. Do not invent replacement routes or passenger impacts. Cite sources; put query details in Evidence.

Expected shape: a distinct rail service-pattern total computed before limiting to five examples. No passenger-impact or replacement-route forecast.

Talk track: “This identifies services exposed to a closure, not predicted cancellations. A real response needs a service date, closure details and a validated replacement-service plan.”

## Q3 — Would extra evening buses reduce waiting?

> For planning extra route 385 buses after a Suncorp Stadium event, assume the headway changes from 20 minutes to 10 minutes. How would expected waiting time and services per hour change? Assume uniform passenger arrivals and evenly spaced services. Clearly label the result hypothetical, not the actual event timetable, demand or fleet feasibility. Put calculations in Evidence.

Expected: illustrative waiting **10 → 5 minutes**, services/hour **3 → 6**.

Talk track: “We are testing explicit assumptions, not reading an actual event headway. The model says less waiting under even spacing; it does not establish fleet availability, crowding or passenger demand.”

## Q4 — Would a late train break a bus connection?

> At Roma Street, assume a connecting bus departs 8 minutes after the planned train arrival, with zero transfer walking time and no holding. If the train arrives 10 minutes late, is that hypothetical connection still possible? Give the remaining margin and state what dated timetable and minimum-transfer information is needed to assess a real connection. Put calculations in Evidence.

Expected: **8 − 10 = −2 minutes**; the hypothetical connection is missed by **2 minutes**.

Talk track: “This highlights an interchange risk, not an actual missed journey. We need linked trips, the travel date, calendar exceptions, pedestrian-transfer times and any holding rules.”

## Live What if? screen — reproduce the screenshot

### One-minute spoken script

1. **Open route 61 → What if?:** “Let's look at getting people home after a stadium event. These are assumptions we can change—not the current timetable.”
2. **Set 20 → 10-minute headway:** “What if we run buses every ten minutes instead of every twenty?”
3. **Set delay 9, window 8, then Compare:** “Average waiting drops from ten minutes to five. But a train arriving nine minutes late misses an eight-minute connection window by one minute.”
4. **Set window 12, then Compare:** “What if we allow twelve minutes between the train and bus? With the same delay, three minutes remain.”
5. **Close:** “More frequent buses can reduce waiting; a larger connection window gives more room for delays. Before making a real change, we'd check the dated timetable, walking time and available buses and drivers.”

Keep the caveat short: “We are comparing options, not predicting an actual journey.” Waiting assumes evenly spaced buses and uniform arrivals; the transfer margin excludes walking and holding.

### Backup values and checks

Select route **61**, open **What if?**, and enter:

| Input | Value |
|---|---:|
| Baseline headway | 20 minutes |
| Proposed headway | 10 minutes |
| Arrival shift | 9 minutes |
| Transfer window | 8 minutes |

Select **Compare scenario**. Expected waiting is **10 → 5 minutes**, services/hour **3 → 6**, and the hypothetical connection is missed by **1 minute** because **8 − 9 = −1**.

Say: “Doubling frequency halves expected waiting under uniform arrivals and evenly spaced services. But the nine-minute delay exceeds our eight-minute transfer window. Frequency and interchange reliability are separate planning questions.”

Change arrival shift to **10 minutes**: missed by **2 minutes**, matching Q4. Then change transfer window to **12 minutes**: **2 minutes** remain. This is only a hypothetical margin, not proof of a walkable transfer.

The selected route provides context; none of these input values is extracted from its actual schedule. The sliders run local arithmetic, not a Fabric simulation, and do not apply a service date. A real event plan also needs dated active trips, actual stop times, walking/accessibility rules, holding policy, fleet/driver availability and demand.

## Where data comes from

- [Official Translink SEQ GTFS](https://www.data.qld.gov.au/dataset/general-transit-feed-specification-gtfs-translink), imported 10 November 2026, CC BY 4.0, attributed to Translink / Queensland Department of Transport and Main Roads.
- The notebook stages the ZIP in Lakehouse Files, validates keys/joins and creates managed Delta tables in **TranslinkNetwork**.
- **TranslinkTransportV2** binds Route, Trip, Stop, StopCall, Service, ServiceException, Venue and VenueStopLink to those tables.
- The stadium point is a manually supplied approximate demo reference. Venue links are computed straight-line distances within 1,200 metres, not official event services or walking routes.
- Map geometry is a separate filtered GTFS snapshot; basemap/buildings use OpenFreeMap/OpenStreetMap.
- Neither population/Brisbane City Plan data nor live demand, crowding or vehicle capacity has been ingested.

## Architecture and evidence

Fabric protected hosting → Rayfin authenticated client → hosted `planner` function → V2 `ask_ontology` → bound Lakehouse data → short Markdown answer with a source citation.

Detailed SQL/calculations are under **Source query & calculation details**. The exact returned payload stays available under **Inspect returned evidence (raw)**; answers are formatted, not rewritten or populated from the expected-result cards.

External queries use Rayfin's app-owner identity, explicitly approved for this public-data demo. App sign-in authorizes invocation; it is not per-visitor row-level security on external Fabric data. Resource tokens remain server-side.

## Validation and limitations

Earlier technical baseline checks passed in the hosted UI: 8 bus/56 rail route IDs, 30 stadium proximity links, expected nearest stops, and illustrative frequency/connection arithmetic. These remain useful checks, but are not the business opening story.

The revised Q1/Q2 require additional service-call/station filtering; do not claim baseline counts prove them. Inspect the returned queries and compare with source records. AI responses may be incorrect or stale.

What-if arithmetic is **not date-specific**. Dated planning must apply the service calendar, weekday and exceptions, plus GTFS local times beyond 24:00. No validated routing or demand model exists in this demo.
