import { mkdir, writeFile } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';
import { parse } from 'csv-parse/sync';

const source = 'https://gtfsrt.api.translink.com.au/GTFS/SEQ_GTFS.zip';
console.log(`Downloading official SEQ GTFS: ${source}`);
const response = await fetch(source, { signal: AbortSignal.timeout(180000) });
if (!response.ok) throw new Error(`GTFS download failed: ${response.status}`);
const archive = unzipSync(new Uint8Array(await response.arrayBuffer()), {
  filter: ({ name }) => ['routes.txt', 'trips.txt', 'shapes.txt', 'stops.txt', 'feed_info.txt', 'calendar.txt'].includes(name),
});
function rows(name) {
  if (!archive[name]) throw new Error(`Required GTFS file missing: ${name}`);
  return parse(strFromU8(archive[name]), { columns: true, skip_empty_lines: true, bom: true });
}
const allRoutes = rows('routes.txt');
const trips = rows('trips.txt');
const stops = rows('stops.txt');
const wantedBus = new Set(['61', '66', '60', '65', '385', '444', '199', '196', '333', '340']);
const selectedRoutes = allRoutes.filter(r => ['2', '1'].includes(r.route_type) || (r.route_type === '3' && wantedBus.has(r.route_short_name)));
const routeIds = new Set(selectedRoutes.map(r => r.route_id));
const routeShapes = new Map();
for (const trip of trips) {
  if (!routeIds.has(trip.route_id) || !trip.shape_id) continue;
  const key = `${trip.route_id}:${trip.direction_id}`;
  if (!routeShapes.has(key)) routeShapes.set(key, { routeId: trip.route_id, shapeId: trip.shape_id });
}
const shapeIds = new Set([...routeShapes.values()].map(s => s.shapeId));
const shapes = new Map();
for (const row of rows('shapes.txt')) {
  if (!shapeIds.has(row.shape_id)) continue;
  if (!shapes.has(row.shape_id)) shapes.set(row.shape_id, []);
  shapes.get(row.shape_id).push([Number(row.shape_pt_sequence), Number(row.shape_pt_lon), Number(row.shape_pt_lat)]);
}
const bounds = [152.93, -27.54, 153.12, -27.40];
const inside = ([lon, lat]) => lon >= bounds[0] && lon <= bounds[2] && lat >= bounds[1] && lat <= bounds[3];
const routeLookup = new Map(selectedRoutes.map(r => [r.route_id, r]));
const features = [];
for (const [key, { routeId, shapeId }] of routeShapes) {
  const route = routeLookup.get(routeId);
  const points = (shapes.get(shapeId) ?? []).sort((a, b) => a[0] - b[0]).map(p => p.slice(1));
  if (points.length < 2 || !points.some(inside)) continue;
  features.push({
    type: 'Feature',
    properties: {
      id: routeId, name: route.route_short_name || route.route_long_name,
      description: route.route_long_name, mode: route.route_type === '3' ? 'bus' : 'rail', direction: key.split(':').at(-1),
    },
    geometry: { type: 'LineString', coordinates: points },
  });
}
if (!features.length) throw new Error('No matching Brisbane route shapes found in GTFS.');
const localStops = stops.filter(s => inside([Number(s.stop_lon), Number(s.stop_lat)]));
const stopFeatures = localStops.map(s => ({
  type: 'Feature',
  properties: { id: s.stop_id, name: s.stop_name, parent: s.parent_station || '', station: s.location_type === '1' || /station/i.test(s.stop_name) },
  geometry: { type: 'Point', coordinates: [Number(s.stop_lon), Number(s.stop_lat)] },
}));
const uniqueRoutes = [...new Map(features.map(f => [f.properties.id, f.properties])).values()];
const calendar = archive['calendar.txt'] ? rows('calendar.txt') : [];
const info = archive['feed_info.txt'] ? rows('feed_info.txt')[0] : null;
const dates = calendar.flatMap(c => [c.start_date, c.end_date]).filter(Boolean).sort();
const output = {
  provenance: {
    source, catalogue: 'https://www.data.qld.gov.au/dataset/general-transit-feed-specification-gtfs-translink',
    importedAt: new Date().toISOString(), license: 'CC BY 4.0; attribution: Translink, Queensland Department of Transport and Main Roads',
    feedStart: info?.feed_start_date || dates[0] || null, feedEnd: info?.feed_end_date || dates.at(-1) || null,
    scope: 'Selected major bus routes and rail shapes intersecting inner Brisbane; not the complete Translink network. One representative shape per route and direction, not every variant. Stops are geographic context, not inferred route memberships.',
  },
  routes: uniqueRoutes,
  lines: { type: 'FeatureCollection', features },
  stops: { type: 'FeatureCollection', features: stopFeatures },
};
await mkdir(new URL('../public/data/', import.meta.url), { recursive: true });
await writeFile(new URL('../public/data/network.json', import.meta.url), JSON.stringify(output));
console.log(`Saved ${uniqueRoutes.length} routes, ${features.length} shapes and ${stopFeatures.length} stops.`);
