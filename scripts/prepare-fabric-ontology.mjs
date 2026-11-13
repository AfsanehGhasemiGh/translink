import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
const base = new URL('../fabric/', import.meta.url);
const config = JSON.parse(await readFile(new URL('deployment.json', base), 'utf8'));
const validation = JSON.parse(await readFile(new URL('source-validation.json', base), 'utf8'));
const definitions = [
  ['Route', 'routes', 'route_id', 'route_short_name'],
  ['Trip', 'trips', 'trip_id', 'trip_id'],
  ['Stop', 'stops', 'stop_id', 'stop_name'],
  ['StopCall', 'stop_calls', 'stop_call_id', 'stop_call_id'],
  ['Service', 'services', 'service_id', 'service_id'],
  ['ServiceException', 'service_exceptions', 'exception_id', 'exception_id'],
  ['Venue', 'venues', 'venue_id', 'venue_name'],
  ['VenueStopLink', 'venue_stop_links', 'link_id', 'link_id'],
];
const relationships = [
  ['HasTrip', 'Route', 'Trip', 'trips', 'route_id', 'trip_id'],
  ['HasCall', 'Trip', 'StopCall', 'stop_calls', 'trip_id', 'stop_call_id'],
  ['CallsAt', 'StopCall', 'Stop', 'stop_calls', 'stop_call_id', 'stop_id'],
  ['SchedulesTrip', 'Service', 'Trip', 'trips', 'service_id', 'trip_id'],
  ['HasException', 'Service', 'ServiceException', 'service_exceptions', 'service_id', 'exception_id'],
  ['HasNearbyLink', 'Venue', 'VenueStopLink', 'venue_stop_links', 'venue_id', 'link_id'],
  ['RefersToStop', 'VenueStopLink', 'Stop', 'venue_stop_links', 'link_id', 'stop_id'],
];
let ids;
try {
  ids = JSON.parse(await readFile(new URL('ontology-ids.json', base), 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  ids = { entities: {}, relationships: {} };
}
const newId = () => String(1000000000000000n + BigInt(`0x${randomBytes(6).toString('hex')}`));
const parts = [];
function part(path, value) {
  parts.push({ path, payload: Buffer.from(JSON.stringify(value)).toString('base64'), payloadType: 'InlineBase64' });
}
const source = table => ({
  sourceType: 'LakehouseTable', workspaceId: config.workspaceId, itemId: config.lakehouseId,
  sourceSchema: 'dbo', sourceTableName: table,
});
const valueTypes = { string: 'String', bigint: 'BigInt', double: 'Double' };
part('.platform', { metadata: { type: 'Ontology', displayName: config.ontologyName } });
part('definition.json', {});
const propertyTypes = new Map();
for (const [name, table, key, display] of definitions) {
  const schema = validation.schemas[table];
  if (!schema?.length || !schema.some(column => column.name === key)) throw new Error(`Missing verified schema/key for ${table}.`);
  const entity = ids.entities[name] ??= { id: newId(), binding: randomUUID(), properties: {} };
  const properties = schema.map(column => {
    const type = valueTypes[column.type];
    if (!type) throw new Error(`Unsupported source type ${column.type}`);
    if (propertyTypes.has(column.name) && propertyTypes.get(column.name) !== type) throw new Error(`Conflicting property type: ${column.name}`);
    propertyTypes.set(column.name, type);
    return { id: entity.properties[column.name] ??= newId(), name: column.name, valueType: type };
  });
  part(`EntityTypes/${entity.id}/definition.json`, {
    id: entity.id, name, namespace: 'usertypes', namespaceType: 'Custom', visibility: 'Visible',
    entityIdParts: [entity.properties[key]], displayNamePropertyId: entity.properties[display],
    properties, timeseriesProperties: [],
  });
  part(`EntityTypes/${entity.id}/DataBindings/${entity.binding}.json`, {
    id: entity.binding, dataBindingConfiguration: {
      dataBindingType: 'NonTimeSeries', sourceTableProperties: source(table),
      propertyBindings: schema.map(column => ({ sourceColumnName: column.name, targetPropertyId: entity.properties[column.name] })),
    },
  });
}
for (const [name, from, to, table, fromColumn, toColumn] of relationships) {
  const schema = validation.schemas[table];
  if (![fromColumn, toColumn].every(column => schema.some(field => field.name === column))) throw new Error(`Unverified relationship table columns for ${name}`);
  const relation = ids.relationships[name] ??= { id: newId(), contextualization: randomUUID() };
  part(`RelationshipTypes/${relation.id}/definition.json`, {
    id: relation.id, name, namespace: 'usertypes', namespaceType: 'Custom',
    source: { entityTypeId: ids.entities[from].id }, target: { entityTypeId: ids.entities[to].id },
  });
  part(`RelationshipTypes/${relation.id}/Contextualizations/${relation.contextualization}.json`, {
    id: relation.contextualization, dataBindingTable: source(table),
    sourceKeyRefBindings: [{ sourceColumnName: fromColumn, targetPropertyId: ids.entities[from].properties[fromColumn] }],
    targetKeyRefBindings: [{ sourceColumnName: toColumn, targetPropertyId: ids.entities[to].properties[toColumn] }],
  });
}
await writeFile(new URL('ontology-ids.json', base), JSON.stringify(ids, null, 2));
await writeFile(new URL('ontology.request.json', base), JSON.stringify({
  displayName: config.ontologyName, type: 'Ontology',
  description: 'GTFS-backed transport entities and relationships. Venue proximity is straight-line only; not validated walking access. Schedule questions must apply service calendars and exceptions.',
  definition: { parts },
}, null, 2));
console.log(`Workspace: ${config.workspaceName}; Ontology: ${config.ontologyName}\n8 entities; 7 relationships; 8 static managed-table bindings; no time series.`);
for (const [name, table, key] of definitions) console.log(`${name.padEnd(18)} key=${key.padEnd(15)} dbo.${table.padEnd(20)} rows=${validation.counts[table]}`);
for (const [name, from, to, table] of relationships) console.log(`${from} -[${name}]-> ${to} via dbo.${table}`);
console.log('\nAll new definition parts:');
for (const p of parts) console.log(`+ ${p.path}`);
