import { readFile, writeFile } from 'node:fs/promises';
const config = JSON.parse(await readFile(new URL('../fabric/deployment.json', import.meta.url), 'utf8'));
const network = JSON.parse(await readFile(new URL('../public/data/network.json', import.meta.url), 'utf8'));
if (!config.lakehouseId || !config.workspaceId) throw new Error('Resolve the Fabric workspace and Lakehouse before preparing the notebook.');
const source = await readFile(new URL('../fabric/ingest-gtfs.py', import.meta.url), 'utf8');
const notebook = {
  nbformat: 4, nbformat_minor: 5,
  metadata: {
    kernelspec: { display_name: 'Synapse PySpark', language: 'python', name: 'synapse_pyspark' },
    language_info: { name: 'python' },
    dependencies: { lakehouse: {
      default_lakehouse: config.lakehouseId, default_lakehouse_name: config.lakehouseName,
      default_lakehouse_workspace_id: config.workspaceId,
    } },
  },
  cells: [{
    id: 'translink-ingest', cell_type: 'code', metadata: {}, execution_count: null, outputs: [],
    source: [
      `lakehouse_id = ${JSON.stringify(config.lakehouseId)}\n`,
      `selected_route_ids = ${JSON.stringify(network.routes.map(route => route.id))}\n`,
      ...source.split('\n').map(line => `${line}\n`),
    ],
  }],
};
const envelope = {
  displayName: config.notebookName, type: 'Notebook',
  description: 'Ingest and validate official GTFS data as managed Delta tables for the Translink ontology.',
  definition: { format: 'ipynb', parts: [{
    path: 'notebook-content.ipynb', payloadType: 'InlineBase64',
    payload: Buffer.from(JSON.stringify(notebook)).toString('base64'),
  }] },
};
await writeFile(new URL('../fabric/ingest-notebook.request.json', import.meta.url), JSON.stringify(envelope, null, 2));
console.log(`Prepared notebook for ${network.routes.length} routes and Lakehouse ${config.lakehouseName}.`);
