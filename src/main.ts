import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import type { FeatureCollection, LineString, Point } from 'geojson';
import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import { calculateScenario } from './scenario.mjs';
import deployment from '../fabric/deployment.json';
import { authenticationHeaders, signIn } from './auth';
import { isRayfin, isRayfinSignedIn, rayfinApi, rayfinSignIn, watchRayfinSession } from './rayfin';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { splitPlannerAnswer } from './planner-response.mjs';

type Route = { id: string; name: string; description: string; mode: 'bus' | 'rail' };
type Network = {
  provenance: { importedAt: string; source: string; catalogue: string; license: string; scope: string; feedStart: string | null; feedEnd: string | null };
  routes: Route[];
  lines: FeatureCollection<LineString, Route>;
  stops: FeatureCollection<Point, { id: string; name: string; parent: string; station: boolean }>;
};
const app = document.querySelector<HTMLDivElement>('#app')!;
maplibregl.setWorkerUrl(workerUrl);
const escape = (text: string) => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const stadium: [number, number] = [153.0095, -27.4648];
const ontologyUrl = `https://app.fabric.microsoft.com/groups/${deployment.workspaceId}/ontologies/${deployment.graphOntologyId}?experience=fabric-developer`;
let network: Network;
let selected: Route | undefined;
let map: maplibregl.Map | undefined;
let activeTab = 'explore';
let appliedScenario: ReturnType<typeof calculateScenario> | undefined;
const visibleModes = new Set(['bus', 'rail']);
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

app.innerHTML = `
  <header class="topbar">
    <a class="brand" href="/" aria-label="Community Impact Studio home"><span class="brand-symbol">t<span>↗</span></span><span>translink<span class="brand-sub">COMMUNITY IMPACT STUDIO</span></span></a>
    <nav aria-label="Main views"><button class="nav-tab active" data-tab="explore">Network explorer</button><button class="nav-tab" data-tab="scenario">Scenario lab</button><a class="nav-tab" href="${ontologyUrl}" target="_blank" rel="noopener noreferrer">Connected knowledge ↗</a></nav>
    <div class="top-actions"><a class="inline-button" href="/talk-track.html" target="_blank" rel="noopener noreferrer">Presenter guide ↗</a><span class="demo-badge"><span class="status-dot"></span> BUSINESS DEMO</span><button id="theme" class="icon-button" aria-label="Toggle colour theme">◐</button></div>
  </header>
  <div class="workspace">
    <aside class="sidebar">
      <div class="eyebrow">PLACE-BASED PLANNING</div>
      <h1>A connected city.<br><span>Better possibilities.</span></h1>
      <p class="intro">Explore the network. Test a change.<br>Understand the community impact.</p>
      <label class="search-label" for="search">FIND A SERVICE OR PLACE</label>
      <div class="search-wrap"><span aria-hidden="true">⌕</span><input id="search" placeholder="Route, station or stop…" autocomplete="off"></div>
      <div id="search-results" class="search-results" hidden></div>
      <section class="focus-card">
        <div class="section-top"><span class="eyebrow">FEATURED PLANNING AREA</span><span class="pill">BRISBANE</span></div>
        <h2>Suncorp Stadium</h2><p>Milton · Lang Park precinct</p>
        <button id="focus-stadium" class="text-button">Explore event access <span>↗</span></button>
      </section>
      <div class="section-heading"><h2>Network layers</h2><span class="subtle">GTFS snapshot</span></div>
      <label class="layer-row"><span class="layer-icon rail">━</span><span><strong>Rail network</strong><small>Representative service paths</small></span><input type="checkbox" id="rail-toggle" checked aria-label="Show rail network"></label>
      <label class="layer-row"><span class="layer-icon bus">┄</span><span><strong>Major bus routes</strong><small>Selected inner-Brisbane corridors</small></span><input type="checkbox" id="bus-toggle" checked aria-label="Show major bus routes"></label>
      <label class="layer-row"><span class="layer-icon stop">⊙</span><span><strong>Stops & stations</strong><small>Zoom in to explore local stops</small></span><input type="checkbox" id="stops-toggle" checked aria-label="Show stops and stations"></label>
      <div class="section-heading"><h2>Selected service</h2><span class="subtle" id="route-count">Loading…</span></div>
      <select id="route-select" aria-label="Selected service"><option>Loading official data…</option></select>
      <div id="route-detail" class="route-detail"></div>
      <div class="sidebar-bottom"><span class="status-dot"></span><span>Public data. Transparent assumptions.<br><button class="inline-button" id="sources">View sources & demo boundaries ↗</button></span></div>
    </aside>
    <main class="map-area" aria-label="Transport planning map">
      <div id="map" aria-label="Interactive Brisbane transport network map"></div>
      <div class="map-title"><span class="eyebrow">SOUTH EAST QUEENSLAND</span><h2>Brisbane, connected.</h2><span class="map-subtitle">A new perspective on public transport planning</span></div>
      <div class="map-toolbar"><button id="reset-view" title="Reset map to Brisbane">⌖ <span>Brisbane</span></button><button id="view-toggle" aria-pressed="true">3D view</button></div>
      <div id="map-status" role="status" class="map-status">Loading public transport network…</div>
      <div class="map-legend"><span><i class="rail-key"></i>Rail</span><span><i class="bus-key"></i>Bus</span><span><i class="venue-key"></i>Event venue</span><span class="subtle">Selected routes · not full network</span></div>
      <section id="impact-strip" class="impact-strip" aria-label="Network overview">
        <div><span class="metric-label">PLANNING LENS</span><strong>Event accessibility</strong><small>Suncorp Stadium precinct</small></div>
        <div><span class="metric-label">MAPPED SERVICES</span><strong id="metric-routes">—</strong><small>Selected GTFS routes</small></div>
        <div><span class="metric-label">STOPS IN STUDY AREA</span><strong id="metric-stops">—</strong><small>Includes platforms & parent stations</small></div>
        <button id="open-scenario" class="primary-button">Explore a scenario <span>↗</span></button>
      </section>
    </main>
    <aside class="insights">
      <div class="section-top"><span class="eyebrow">PLANNER WORKSPACE</span><span class="insight-icon">✧</span></div>
      <h2>From network<br>to neighbourhood.</h2>
      <p class="intro">Explore the questions behind better transport decisions.</p>
      <div class="fabric-connection"><span id="fabric-status" role="status">${isRayfin() ? 'Connecting with Fabric SSO…' : 'Fabric connection not yet verified'}</span><button id="fabric-retry" class="inline-button" ${isRayfin() ? 'hidden' : ''}>Retry connection</button><button id="staff-signin" class="inline-button" ${isRayfin() ? 'hidden' : ''}>Continue with Fabric</button></div>
      <div class="segmented" role="group" aria-label="Planner panel"><button id="questions-tab" class="active">Questions</button><button id="scenario-tab">What if?</button></div>
      <section id="questions-panel">
        <form id="agent-form" class="agent-form">
          <label for="agent-question" class="mini-label">ASK THE FABRIC PLANNING AGENT</label>
          <textarea id="agent-question" maxlength="2000" rows="3" placeholder="Which routes serve Milton station?" required></textarea>
          <button id="agent-submit" class="primary-button full" type="submit" disabled>Ask Fabric <span>↗</span></button>
          <p class="fineprint">${isRayfin() ? 'Fabric sign-in required. Hosted queries use the Fabric app owner’s access to this public demo dataset.' : 'Local queries use the Azure CLI signed-in user.'} No passenger or crowding forecast.</p>
        </form>
        <div id="agent-response" class="agent-response" aria-live="polite" hidden></div>
        <div class="mini-label">COPY OR LOAD A DEMO QUESTION</div>
        <div id="demo-questions"></div>
        <p id="copy-status" class="fineprint" role="status"></p>
        <div class="mini-label">GUIDED PLANNING STORIES</div>
        <button class="question" data-question="event"><span>01</span>How is Suncorp Stadium connected to the network?<b>↗</b></button>
        <button class="question" data-question="frequency"><span>02</span>What if we run more frequent evening buses?<b>↗</b></button>
        <button class="question" data-question="transfer"><span>03</span>What happens if a train arrives 10 minutes later?<b>↗</b></button>
        <div id="answer" class="answer" aria-live="polite"><span class="eyebrow">A PLACE TO BEGIN</span><h3>One change. Many connections.</h3><p>Select a question to follow a planning story, or choose a route on the map.</p><span class="small-tag">Guided demo · not a live AI assistant</span></div>
      </section>
      <section id="scenario-panel" hidden>
        <div class="scenario-note">ILLUSTRATIVE MODEL · NOT AN OPERATIONAL FORECAST</div>
        <h3 id="scenario-service">Selected service</h3>
        <label class="field-label" for="baseline">Baseline headway <output id="baseline-value">20 min</output></label>
        <input id="baseline" type="range" min="2" max="60" value="20" step="1">
        <label class="field-label" for="proposed">Proposed headway <output id="proposed-value">10 min</output></label>
        <input id="proposed" type="range" min="2" max="60" value="10" step="1">
        <label class="field-label" for="shift">Arrival shift (later) <output id="shift-value">0 min</output></label>
        <input id="shift" type="range" min="0" max="30" value="0" step="1">
        <label class="field-label" for="transfer">Assumed transfer window <output id="transfer-value">8 min</output></label>
        <input id="transfer" type="range" min="0" max="30" value="8" step="1">
        <button id="apply-scenario" class="primary-button full">Compare scenario <span>↗</span></button>
        <div id="scenario-results" aria-live="polite"></div>
        <p class="fineprint">Headways and transfer window are editable assumptions, not extracted timetables. Wait = half the headway for random arrivals and evenly spaced services. Shift tests one hypothetical connection only. No passenger demand, capacity or walking-time model.</p>
      </section>
      <div class="knowledge-card"><span class="eyebrow">CONNECTED KNOWLEDGE</span><h3>See the relationships<br>behind the map.</h3><p>Open the V2 ontology graph and its built-in agent in Microsoft Fabric. Fabric sign-in and access are required.</p><a id="open-ontology" class="text-button" href="${ontologyUrl}" target="_blank" rel="noopener noreferrer">Open V2 ontology graph in Fabric <span>↗</span></a><button id="inspect-ontology" class="text-button">Inspect data-agent source bindings <span>↗</span></button><span class="small-tag">Graph: TranslinkTransportV2. The published data agent still uses the original TranslinkTransport ontology pending its separate cutover.</span><span class="small-tag" id="ontology-state">Connection requires verification</span></div>
    </aside>
  </div>
  <dialog id="detail-dialog"><button id="close-dialog" class="dialog-close" aria-label="Close dialog">×</button><div id="dialog-content"></div></dialog>
`;

function showDialog(content: string) {
  $('dialog-content').innerHTML = content;
  $('detail-dialog') instanceof HTMLDialogElement && ($('detail-dialog') as HTMLDialogElement).showModal();
}
$('close-dialog').onclick = () => ($('detail-dialog') as HTMLDialogElement).close();
$('detail-dialog').addEventListener('click', event => { if (event.target === $('detail-dialog')) ($('detail-dialog') as HTMLDialogElement).close(); });
$('theme').onclick = () => {
  document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
};

function scenarioPanel(show: boolean) {
  $('questions-panel').hidden = show;
  $('scenario-panel').hidden = !show;
  $('questions-tab').classList.toggle('active', !show);
  $('scenario-tab').classList.toggle('active', show);
  activeTab = show ? 'scenario' : 'explore';
  document.querySelectorAll<HTMLButtonElement>('.nav-tab').forEach(button => button.classList.toggle('active', button.dataset.tab === activeTab));
}
$('questions-tab').onclick = () => scenarioPanel(false);
$('scenario-tab').onclick = () => scenarioPanel(true);
$('open-scenario').onclick = () => scenarioPanel(true);
document.querySelectorAll<HTMLButtonElement>('.nav-tab').forEach(button => {
  button.onclick = () => scenarioPanel(button.dataset.tab === 'scenario');
});
const sourceText = () => `<span class="eyebrow">DATA & TRANSPARENCY</span><h2>Real geography. Explicit assumptions.</h2>
  <h3>Official Translink network snapshot</h3><p>Route shapes and stop locations come from the <a href="${network.provenance.catalogue}" target="_blank" rel="noreferrer">Queensland Government GTFS catalogue</a>.</p>
  <p>Imported ${new Date(network.provenance.importedAt).toLocaleString('en-AU')}. Feed coverage: ${escape(network.provenance.feedStart || 'not supplied')} – ${escape(network.provenance.feedEnd || 'not supplied')}.</p>
  <p>${escape(network.provenance.scope)}</p><p>${escape(network.provenance.license)}. <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">Licence</a>.</p>
  <h3>What this demo does not claim</h3><ul><li>No live vehicle positions or journey-routing engine. The Fabric agent can query ingested schedules, subject to calendar validity and exceptions.</li><li>No measured crowding, passenger demand or population impact.</li><li>Frequency comparisons use your assumptions, not an operational timetable.</li><li>Fabric connection status is verified separately. Agent responses are generated from its configured sources and can be incorrect; inspect the returned evidence.</li><li>Venue links are approximate straight-line proximity, not verified pedestrian access or event services.</li><li>Basemap and building footprints are external OpenFreeMap/OpenStreetMap data. Internet is required for the basemap; the map transport snapshot is stored locally and is refreshed separately from Fabric.</li></ul>`;
$('sources').onclick = () => network && showDialog(sourceText());

type LiveOntology = {
  name: string; id: string; verifiedAt: string;
  entities: { id: string; name: string; properties: { id: string; name: string; valueType: string }[] }[];
  relationships: { name: string; source: { entityTypeId: string }; target: { entityTypeId: string } }[];
  bindings: { dataBindingConfiguration: { sourceTableProperties: { sourceSchema: string; sourceTableName: string } } }[];
};
async function api<T>(url: string, options?: RequestInit): Promise<T> {
  if (isRayfin()) return rayfinApi<T>(url, options);
  const headers = new Headers(options?.headers);
  for (const [name, value] of Object.entries(await authenticationHeaders())) headers.set(name, value);
  const response = await fetch(url, { ...options, headers, signal: AbortSignal.timeout(650000) });
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) throw new Error('Local Fabric API is unavailable. Start npm run api and retry.');
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : `Fabric request failed (${response.status}).`);
  return data as T;
}
async function ontology() {
  showDialog('<span class="eyebrow">FABRIC IQ · LIVE DEFINITION</span><h2>Reading the ontology…</h2><p>Fetching entity definitions and managed-table bindings from Fabric.</p>');
  try {
    const live = await api<LiveOntology>('/api/fabric/ontology');
    const names = new Map(live.entities.map(entity => [String(entity.id), entity.name]));
    $('dialog-content').innerHTML = `<span class="eyebrow">FABRIC IQ · VERIFIED LIVE DEFINITION</span><h2>${escape(live.name)}</h2>
      <p>Read directly from Fabric at ${escape(new Date(live.verifiedAt).toLocaleString('en-AU'))}. ${live.entities.length} entity types and ${live.relationships.length} relationship types.</p>
      <h3>Entity definitions</h3><div class="entity-grid">${live.entities.map(entity => `<div><strong>${escape(entity.name)}</strong><small>${entity.properties.map(property => `${escape(property.name)}: ${escape(property.valueType)}`).join('<br>')}</small></div>`).join('')}</div>
      <h3>Relationships</h3>${live.relationships.map(relation => `<div class="ontology-flow"><div>${escape(names.get(String(relation.source.entityTypeId)) || 'Unknown')}</div><b>${escape(relation.name)} →</b><div>${escape(names.get(String(relation.target.entityTypeId)) || 'Unknown')}</div></div>`).join('')}
      <h3>Actual source bindings</h3><ul>${live.bindings.map(binding => `<li>${escape(binding.dataBindingConfiguration.sourceTableProperties.sourceSchema)}.${escape(binding.dataBindingConfiguration.sourceTableProperties.sourceTableName)}</li>`).join('')}</ul>
      <p class="fineprint">This verifies deployed definitions and bindings, not the freshness of every row. Venue links represent approximate straight-line proximity only. Scenario controls remain an illustrative local calculation.</p>`;
  } catch (error) {
    console.error('Live ontology read failed:', error);
    $('dialog-content').replaceChildren();
    const heading = document.createElement('h2');
    heading.textContent = 'Fabric ontology unavailable';
    const detail = document.createElement('p');
    detail.textContent = error instanceof Error ? error.message : 'Unable to read the live ontology.';
    $('dialog-content').append(heading, detail);
  }
}
$('inspect-ontology').onclick = ontology;
let fabricReady = false;
let agentBusy = false;
let connectionCheck: Promise<void> | undefined;
function checkFabric(): Promise<void> {
  return connectionCheck ??= runConnectionCheck().finally(() => { connectionCheck = undefined; });
}
async function runConnectionCheck() {
  $<HTMLButtonElement>('fabric-retry').disabled = true;
  $<HTMLButtonElement>('agent-submit').disabled = true;
  $('fabric-status').textContent = 'Connecting to the Fabric ontology…';
  try {
    const status = await api<{ connected: boolean; entityCount: number }>('/api/fabric/status');
    if (!status.connected) throw new Error('Fabric did not confirm a connection.');
    fabricReady = true;
    $('fabric-status').textContent = `Fabric connected · ${status.entityCount} entity types`;
    $('ontology-state').textContent = 'Live Fabric definition · connection verified';
  } catch (error) {
    fabricReady = false;
    console.error('Fabric connection check failed:', error);
    $('fabric-status').textContent = `Not connected: ${error instanceof Error ? error.message : 'Verification failed.'}`;
    $('ontology-state').textContent = 'Fabric connection not verified';
  } finally {
    $<HTMLButtonElement>('fabric-retry').disabled = false;
    $('fabric-retry').hidden = fabricReady;
    $('staff-signin').hidden = fabricReady || (isRayfin() && isRayfinSignedIn());
    $<HTMLButtonElement>('agent-submit').disabled = !fabricReady || agentBusy;
  }
}
$('fabric-retry').onclick = checkFabric;
const demoQuestions = [
  { id: 'Q1', title: 'Which buses could support a stadium event?', expected: 'Candidate bus routes from actual stop calls; nearby does not mean walkable or confirmed event service.', question: 'Which bus routes in our selected network have scheduled calls at stops within 1,200 metres straight-line of Suncorp Stadium? Show distinct route numbers and public route names, using Venue, VenueStopLink, StopCall, Trip and Route. These are candidates for event planning, not confirmed event services or walking access. Cite the source; put query details in Evidence.' },
  { id: 'Q2', title: 'What if Milton station closes?', expected: 'Total affected rail service patterns, counted before limiting to five examples; no passenger-impact forecast.', question: 'If Milton station is unavailable, which selected rail service patterns would be affected? Use actual scheduled calls at Milton station platforms. Compute the total distinct rail route IDs over ALL matching routes BEFORE limiting displayed examples; do not count just the top five. Show that total and up to five public route-name examples. This is a hypothetical closure across the feed, not a dated disruption forecast. Do not invent replacement routes or passenger impacts. Cite sources; put query details in Evidence.' },
  { id: 'Q3', title: 'Would extra evening buses reduce waiting?', expected: 'Illustrative wait 10 → 5 minutes; 3 → 6 services/hour. Not actual dated schedules or fleet feasibility.', question: 'For planning extra route 385 buses after a Suncorp Stadium event, assume the headway changes from 20 minutes to 10 minutes. How would expected waiting time and services per hour change? Assume uniform passenger arrivals and evenly spaced services. Clearly label the result hypothetical, not the actual event timetable, demand or fleet feasibility. Put calculations in Evidence.' },
  { id: 'Q4', title: 'Would a late train break a bus connection?', expected: 'With an 8-minute margin and 10-minute delay, hypothetical connection missed by 2 minutes.', question: 'At Roma Street, assume a connecting bus departs 8 minutes after the planned train arrival, with zero transfer walking time and no holding. If the train arrives 10 minutes late, is that hypothetical connection still possible? Give the remaining margin and state what dated timetable and minimum-transfer information is needed to assess a real connection. Put calculations in Evidence.' },
];
for (const demo of demoQuestions) {
  const card = document.createElement('section');
  card.className = 'demo-question';
  const title = document.createElement('h3');
  title.textContent = `${demo.id} · ${demo.title}`;
  const question = document.createElement('p');
  question.textContent = demo.question;
  const expected = document.createElement('small');
  expected.textContent = `Expected: ${demo.expected}`;
  const actions = document.createElement('div');
  const load = document.createElement('button');
  load.className = 'text-button';
  load.textContent = `Use ${demo.id}`;
  load.onclick = () => {
    $<HTMLTextAreaElement>('agent-question').value = demo.question;
    $<HTMLTextAreaElement>('agent-question').focus();
    $('copy-status').textContent = `${demo.id} loaded. ${fabricReady ? 'Select Ask Fabric.' : 'Wait for Fabric SSO, or use Continue with Fabric if prompted.'}`;
  };
  const copy = document.createElement('button');
  copy.className = 'text-button';
  copy.textContent = `Copy ${demo.id}`;
  copy.onclick = async () => {
    try {
      await navigator.clipboard.writeText(demo.question);
      $('copy-status').textContent = `${demo.id} copied. Paste it into the agent or use it in Fabric.`;
    } catch (error) {
      console.error('Question copy failed:', error);
      $('copy-status').textContent = `Clipboard unavailable. Select the question text to copy manually, or choose Use ${demo.id}.`;
    }
  };
  actions.append(load, copy);
  card.append(title, question, expected, actions);
  $('demo-questions').append(card);
}
$('staff-signin').onclick = async () => {
  $<HTMLButtonElement>('staff-signin').disabled = true;
  try {
    if (isRayfin()) { await rayfinSignIn(); await checkFabric(); }
    else await signIn();
  } catch (error) {
    console.error('Staff sign-in failed:', error);
    $('fabric-status').textContent = error instanceof Error ? error.message : 'Staff sign-in failed.';
    $('staff-signin').hidden = false;
  } finally {
    $<HTMLButtonElement>('staff-signin').disabled = false;
  }
};
if (isRayfin()) {
  void (async () => {
    try {
      const unsubscribe = await watchRayfinSession(signedIn => {
        if (signedIn) {
          void checkFabric();
        } else {
          fabricReady = false;
          $('fabric-status').textContent = 'Your Fabric session ended. Continue with Fabric to reconnect.';
          $('staff-signin').hidden = false;
          $('fabric-retry').hidden = false;
          $<HTMLButtonElement>('agent-submit').disabled = true;
        }
      });
      window.addEventListener('pagehide', event => { if (!event.persisted) unsubscribe(); }, { once: true });
    } catch (error) {
      console.error('Fabric SSO initialization failed:', error);
    }
    await checkFabric();
  })();
}
$('agent-form').onsubmit = async event => {
  event.preventDefault();
  if (!fabricReady || agentBusy) return;
  const question = $<HTMLTextAreaElement>('agent-question').value.trim();
  if (!question) return;
  agentBusy = true;
  const result = $('agent-response');
  result.hidden = false;
  result.textContent = 'Fabric is querying the transport sources. This can take a minute…';
  result.scrollIntoView({ behavior: 'smooth', block: 'start' });
  $<HTMLButtonElement>('agent-submit').disabled = true;
  try {
    const response = await api<{ answer: string; evidence: unknown; tool: string; answeredAt: string }>('/api/agent', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question }),
    });
    result.replaceChildren();
    const label = document.createElement('span');
    label.className = 'eyebrow';
    label.textContent = 'ANSWER · LIVE FABRIC DATA';
    const answer = document.createElement('div');
    answer.className = 'agent-answer';
    const sections = splitPlannerAnswer(response.answer);
    const renderMarkdown = (markdown: string) => DOMPurify.sanitize(marked.parse(markdown, { async: false }), {
      ALLOWED_TAGS: ['p', 'strong', 'em', 'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'pre', 'code', 'blockquote', 'a', 'br', 'hr'],
      ALLOWED_ATTR: ['href', 'title'],
    });
    answer.innerHTML = renderMarkdown(sections.answer);
    result.append(label, answer);
    if (sections.evidence) {
      const queryDetails = document.createElement('details');
      queryDetails.className = 'query-details';
      const querySummary = document.createElement('summary');
      querySummary.textContent = 'Source query & calculation details';
      const queryContent = document.createElement('div');
      queryContent.className = 'agent-answer';
      queryContent.innerHTML = renderMarkdown(sections.evidence);
      queryDetails.append(querySummary, queryContent);
      result.append(queryDetails);
    }
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = 'Inspect returned evidence (raw)';
    const evidence = document.createElement('pre');
    evidence.textContent = JSON.stringify({ tool: response.tool, answeredAt: response.answeredAt, evidence: response.evidence }, null, 2);
    details.append(summary, evidence);
    result.append(details);
    result.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    console.error('Fabric agent request failed:', error);
    result.textContent = `Agent request failed: ${error instanceof Error ? error.message : 'Unknown error.'}`;
    result.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } finally {
    agentBusy = false;
    $<HTMLButtonElement>('agent-submit').disabled = !fabricReady;
  }
};
function focusStadium() {
  map?.flyTo({ center: stadium, zoom: 14.3, pitch: 58, bearing: -25, duration: 1300 });
}
$('focus-stadium').onclick = focusStadium;
$('reset-view').onclick = () => map?.flyTo({ center: [153.020, -27.466], zoom: 12.8, pitch: 52, bearing: -22 });
$('view-toggle').onclick = () => {
  if (!map) return;
  const is3d = map.getPitch() < 10;
  map.easeTo({ pitch: is3d ? 52 : 0, bearing: is3d ? -22 : 0 });
  $('view-toggle').setAttribute('aria-pressed', String(is3d));
  $('view-toggle').textContent = is3d ? '3D view' : '2D view';
};

function updateFilters() {
  if (!map?.getLayer('network-lines')) return;
  const filter: maplibregl.FilterSpecification = ['in', ['get', 'mode'], ['literal', [...visibleModes]]];
  map.setFilter('network-lines', filter);
  map.setFilter('selected-line', ['all', filter, ['==', ['get', 'id'], selected?.id || '']]);
}
for (const mode of ['rail', 'bus']) {
  $<HTMLInputElement>(`${mode}-toggle`).onchange = event => {
    (event.target as HTMLInputElement).checked ? visibleModes.add(mode) : visibleModes.delete(mode);
    updateFilters();
  };
}
$<HTMLInputElement>('stops-toggle').onchange = event => {
  if (map?.getLayer('stops')) map.setLayoutProperty('stops', 'visibility', (event.target as HTMLInputElement).checked ? 'visible' : 'none');
};
function selectRoute(id: string, fly = true) {
  selected = network.routes.find(route => route.id === id);
  if (!selected) return;
  $<HTMLSelectElement>('route-select').value = id;
  $('route-detail').innerHTML = `<span class="route-badge ${selected.mode}">${escape(selected.name)}</span><p>${escape(selected.description)}<small>${selected.mode === 'rail' ? 'Rail' : 'Bus'} · representative GTFS path</small></p>`;
  $('scenario-service').textContent = `${selected.mode === 'rail' ? 'Rail' : 'Bus'} ${selected.name}`;
  if (appliedScenario) {
    appliedScenario = undefined;
    $('scenario-results').innerHTML = '<p class="fineprint">Service changed. Compare again to apply the assumptions to this service.</p>';
  }
  updateFilters();
  if (fly && map) {
    const points = network.lines.features.filter(f => f.properties.id === id).flatMap(f => f.geometry.coordinates).filter(p => p[0] > 152.93 && p[0] < 153.12 && p[1] > -27.54 && p[1] < -27.40);
    if (points.length) {
      const bounds = new maplibregl.LngLatBounds();
      points.forEach(p => bounds.extend([p[0], p[1]]));
      map.fitBounds(bounds, { padding: 90, maxZoom: 14.5, duration: 1000 });
    }
  }
}
$<HTMLSelectElement>('route-select').onchange = event => selectRoute((event.target as HTMLSelectElement).value);
const sliderNames = ['baseline', 'proposed', 'shift', 'transfer'];
sliderNames.forEach(id => {
  $<HTMLInputElement>(id).oninput = () => {
    $(id + '-value').textContent = `${$<HTMLInputElement>(id).value} min`;
    if (appliedScenario) {
      $('scenario-results').innerHTML = '<p class="fineprint">Assumptions changed. Select Compare scenario to update results.</p>';
      appliedScenario = undefined;
    }
  };
});
$('apply-scenario').onclick = () => {
  const [baseline, proposed, shift, transfer] = sliderNames.map(id => Number($<HTMLInputElement>(id).value));
  try {
    const result = calculateScenario(baseline, proposed, shift, transfer);
    appliedScenario = result;
    $('scenario-results').innerHTML = `<div class="comparison"><span class="eyebrow">ILLUSTRATIVE COMPARISON</span><div class="wait-comparison"><div><small>Baseline wait</small><strong>${result.baselineWait.toFixed(1)}<em> min</em></strong></div><span>→</span><div><small>Proposed wait</small><strong>${result.proposedWait.toFixed(1)}<em> min</em></strong></div></div>
      <p class="${result.waitChange <= 0 ? 'positive' : 'warning'}">${Math.abs(result.waitChange).toFixed(1)} min ${result.waitChange <= 0 ? 'less' : 'more'} expected waiting</p>
      <div class="result-row"><span>Services / hour</span><b>${result.baselineServices.toFixed(1)} → ${result.proposedServices.toFixed(1)}</b></div>
      <div class="transfer-result ${result.missedConnection ? 'warning' : 'positive'}">${result.missedConnection ? `Hypothetical connection missed by ${Math.abs(result.remainingTransfer)} min` : `${result.remainingTransfer} min hypothetical transfer margin`}</div></div>`;
  } catch (error) {
    $('scenario-results').textContent = error instanceof Error ? error.message : 'Scenario failed. Review the inputs.';
  }
};

const answers: Record<string, { heading: string; text: string }> = {
  event: { heading: 'Start with the stadium precinct.', text: 'The map highlights Suncorp Stadium and official nearby stop and rail geometry. Inspect Milton and Roma Street and the surrounding bus corridors. Proximity is context only: verified walking links and event timetables are needed to establish usable event journeys.' },
  frequency: { heading: 'More frequency. Less waiting?', text: 'Try a baseline headway of 20 minutes and a proposed headway of 10 minutes. Under uniform arrivals, expected wait drops from 10 to 5 minutes. This tests a planning assumption, not passenger demand or fleet feasibility.' },
  transfer: { heading: 'A small shift can break a connection.', text: 'Test a 10-minute arrival shift against an assumed 8-minute transfer window. The hypothetical connection is missed by 2 minutes. Real impacts require linked trips, walking time, service calendars and actual timetables.' },
};
document.querySelectorAll<HTMLButtonElement>('[data-question]').forEach(button => {
  button.onclick = () => {
    const key = button.dataset.question!;
    const answer = answers[key];
    $('answer').innerHTML = `<span class="eyebrow">PLANNING STORY</span><h3>${answer.heading}</h3><p>${answer.text}</p><span class="small-tag">Guided demo · explicit assumptions</span>`;
    if (key === 'event') focusStadium();
    else {
      if (key === 'transfer') {
        $<HTMLInputElement>('shift').value = '10';
        $('shift-value').textContent = '10 min';
      }
      scenarioPanel(true);
      $('scenario-results').innerHTML = `<p class="fineprint">${answer.text}</p>`;
      appliedScenario = undefined;
    }
  };
});

function search() {
  const query = $<HTMLInputElement>('search').value.toLowerCase().trim();
  const results = $('search-results');
  results.hidden = query.length < 2;
  if (query.length < 2 || !network) return;
  results.replaceChildren();
  const add = (title: string, subtitle: string, action: () => void) => {
    const button = document.createElement('button');
    const strong = document.createElement('strong');
    strong.textContent = title;
    const small = document.createElement('small');
    small.textContent = subtitle;
    button.append(strong, small);
    button.onclick = () => { action(); results.hidden = true; };
    results.append(button);
  };
  if ('suncorp stadium'.includes(query)) add('Suncorp Stadium', 'Venue · Milton', focusStadium);
  network.routes.filter(r => `${r.name} ${r.description}`.toLowerCase().includes(query)).slice(0, 4).forEach(r => add(r.name, r.description, () => selectRoute(r.id)));
  network.stops.features.filter(s => s.properties.name.toLowerCase().includes(query)).slice(0, 5).forEach(stop => add(stop.properties.name, 'GTFS stop / station', () => {
    const point = stop.geometry.coordinates;
    map?.flyTo({ center: [point[0], point[1]], zoom: 16 });
    if (map) new maplibregl.Popup().setLngLat([point[0], point[1]]).setText(stop.properties.name).addTo(map);
  }));
  if (!results.childElementCount) results.textContent = 'No match in this selected network snapshot.';
}
$<HTMLInputElement>('search').oninput = search;

async function initialize() {
  try {
    const response = await fetch('/data/network.json');
    if (!response.ok) throw new Error(`Network data unavailable (${response.status}). Run npm run data:refresh.`);
    network = await response.json() as Network;
    if (!network.routes?.length || network.lines?.type !== 'FeatureCollection' || network.stops?.type !== 'FeatureCollection') throw new Error('Invalid network snapshot. Refresh GTFS data.');
    network.routes.sort((a, b) => a.mode.localeCompare(b.mode) || a.name.localeCompare(b.name, undefined, { numeric: true }));
    $('route-select').innerHTML = network.routes.map(r => `<option value="${escape(r.id)}">${r.mode === 'rail' ? 'Rail' : 'Bus'} ${escape(r.name)} · ${escape(r.description)}</option>`).join('');
    $('route-count').textContent = `${network.routes.length} routes`;
    $('metric-routes').textContent = String(network.routes.length);
    $('metric-stops').textContent = network.stops.features.length.toLocaleString();
    selectRoute(network.routes.find(r => r.name === '61')?.id || network.routes[0].id, false);
    map = new maplibregl.Map({
      container: 'map', style: 'https://tiles.openfreemap.org/styles/positron',
      center: [153.020, -27.466], zoom: 12.8, pitch: 52, bearing: -22,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
    map.on('error', event => {
      console.error('Map resource error:', event.error);
      $('map-status').hidden = false;
      $('map-status').textContent = 'Some map resources could not load. Check internet access; local route data is still available.';
    });
    map.on('load', () => {
      if (!map) return;
      if (map.getSource('openmaptiles')) {
        map.addLayer({
          id: 'planning-buildings', type: 'fill-extrusion', source: 'openmaptiles', 'source-layer': 'building', minzoom: 13,
          paint: {
            'fill-extrusion-color': getComputedStyle(document.documentElement).getPropertyValue('--cp-border').trim(),
            'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 6],
            'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
            'fill-extrusion-opacity': 0.65,
          },
        });
      }
      const css = getComputedStyle(document.documentElement);
      const railColor = css.getPropertyValue('--cp-accent').trim();
      const busColor = css.getPropertyValue('--cp-success').trim();
      map.addSource('network', { type: 'geojson', data: network.lines });
      map.addLayer({
        id: 'network-lines', type: 'line', source: 'network',
        paint: { 'line-color': ['match', ['get', 'mode'], 'rail', railColor, busColor], 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.5, 16, 5], 'line-opacity': 0.65 },
      });
      map.addLayer({
        id: 'selected-line', type: 'line', source: 'network', filter: ['==', ['get', 'id'], selected?.id || ''],
        paint: { 'line-color': css.getPropertyValue('--cp-warning').trim(), 'line-width': 6, 'line-opacity': 0.95 },
      });
      map.addSource('stops', { type: 'geojson', data: network.stops });
      map.addLayer({
        id: 'stops', type: 'circle', source: 'stops', minzoom: 13,
        paint: { 'circle-radius': ['case', ['get', 'station'], 5, 2.8], 'circle-color': css.getPropertyValue('--cp-surface').trim(), 'circle-stroke-color': railColor, 'circle-stroke-width': 1.2 },
      });
      updateFilters();
      map.setLayoutProperty('stops', 'visibility', $<HTMLInputElement>('stops-toggle').checked ? 'visible' : 'none');
      const venue = document.createElement('button');
      venue.className = 'stadium-marker';
      venue.innerHTML = '<span>◎</span><strong>Suncorp Stadium</strong><small>EVENT PLANNING FOCUS</small>';
      venue.setAttribute('aria-label', 'Focus on Suncorp Stadium');
      venue.onclick = focusStadium;
      new maplibregl.Marker({ element: venue, anchor: 'bottom' }).setLngLat(stadium).addTo(map);
      map.on('click', 'network-lines', event => {
        const id = event.features?.[0]?.properties?.id;
        if (typeof id === 'string') selectRoute(id, false);
      });
      map.on('click', 'stops', event => {
        const feature = event.features?.[0];
        if (!feature || feature.geometry.type !== 'Point' || !map) return;
        const p = feature.geometry.coordinates;
        new maplibregl.Popup().setLngLat([p[0], p[1]]).setText(String(feature.properties.name)).addTo(map);
      });
      for (const layer of ['network-lines', 'stops']) {
        map.on('mouseenter', layer, () => { if (map) map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', layer, () => { if (map) map.getCanvas().style.cursor = ''; });
      }
      $('map-status').hidden = true;
    });
  } catch (error) {
    console.error('Demo initialization failed:', error);
    $('map-status').textContent = error instanceof Error ? error.message : 'Unable to load the planning demo.';
    $('route-count').textContent = 'Data unavailable';
    $('route-select').innerHTML = '<option>Network data unavailable</option>';
  }
}
void initialize();
