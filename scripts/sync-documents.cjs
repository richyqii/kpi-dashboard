const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const BASE = 'https://kpi-dashboard.vin8228.workers.dev';
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function filesFor(version) {
  if (!/^(initial-baseline|[a-f0-9-]{36})$/.test(version.id)) throw Error('Invalid version ID');
  const name = String(version.fileName).normalize('NFKC').replace(/[^a-zA-Z0-9 ._()-]/g, '_').slice(-120).replace(/[. ]+$/g, '');
  return { snapshot: `${version.id}.json`, document: version.sha256 ? `${version.id}--${name || 'document.xlsx'}` : null };
}
function validateManifest(manifest) {
  if (manifest.schema !== 1 || !Array.isArray(manifest.versions)) throw Error('Invalid sync manifest');
  const ids = new Set();
  for (const version of manifest.versions) {
    filesFor(version);
    if (ids.has(version.id) || typeof version.fileName !== 'string' || (version.sha256 && (!/^[a-f0-9]{64}$/.test(version.sha256) || !Number.isInteger(version.byteLength) || version.byteLength < 1 || version.byteLength > 5000000))) throw Error('Invalid document metadata');
    ids.add(version.id);
  }
  if (manifest.currentId !== null && !ids.has(manifest.currentId)) throw Error('Baseline missing from manifest');
  return manifest;
}
async function syncDocuments({ root = path.resolve(__dirname, '..'), base = BASE, fetcher = fetch } = {}) {
  const directory = path.resolve(root, 'data', 'uploads');
  await fs.mkdir(directory, { recursive: true });
  // Never follow filesystem links when changing managed files.
  for (const target of [path.resolve(root, 'data'), directory]) if ((await fs.lstat(target)).isSymbolicLink()) throw Error('Sync directory must not be a symbolic link');
  async function local(name) {
    if (path.basename(name) !== name) throw Error('Invalid managed filename');
    const target = path.join(directory, name);
    try { if (!(await fs.lstat(target)).isFile()) throw Error('Managed path must be a regular file'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    return target;
  }
  async function read(name) {
    try { return await fs.readFile(await local(name)); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  async function request(route) {
    const response = await fetcher(base + route, { signal: AbortSignal.timeout(30000), cache: 'no-store' });
    if (!response.ok) throw Error(`Sync request failed (${response.status}): ${route}`);
    return response;
  }
  const manifest = validateManifest(await (await request('/api/sync-manifest')).json());
  const priorBytes = await read('manifest.json');
  const prior = priorBytes ? validateManifest(JSON.parse(priorBytes)) : { versions: [] };
  const wanted = new Set(['manifest.json']), writes = new Map();
  for (const version of manifest.versions) {
    const files = filesFor(version);
    wanted.add(files.snapshot);
    if (!(await read(files.snapshot))) {
      const snapshot = await (await request(`/api/versions/${version.id}/snapshot`)).json();
      if (snapshot.id !== version.id || snapshot.fileName !== version.fileName || !Array.isArray(snapshot.rows)) throw Error('Invalid saved snapshot');
      writes.set(files.snapshot, Buffer.from(JSON.stringify(snapshot, null, 2) + '\n'));
    }
    if (files.document) {
      wanted.add(files.document);
      const existing = await read(files.document);
      if (!existing || hash(existing) !== version.sha256) {
        const bytes = Buffer.from(await (await request(`/api/versions/${version.id}/document`)).arrayBuffer());
        if (bytes.length !== version.byteLength || hash(bytes) !== version.sha256) throw Error('Document checksum mismatch');
        writes.set(files.document, bytes);
      }
    }
  }
  const latest = validateManifest(await (await request('/api/sync-manifest')).json());
  if (JSON.stringify(latest) !== JSON.stringify(manifest)) throw Error('Version History changed during sync; retry on the next run');
  const deletions = [];
  for (const version of prior.versions) for (const name of Object.values(filesFor(version))) if (name && !wanted.has(name)) deletions.push(name);
  // Resolve and check every target before making changes. Delete only files listed
  // by the previous manifest; never touch baseline.json or manually added files.
  for (const name of [...writes.keys(), ...deletions, 'manifest.json']) await local(name);
  for (const [name, bytes] of writes) await fs.writeFile(await local(name), bytes);
  for (const name of deletions) await fs.unlink(await local(name)).catch(error => { if (error.code !== 'ENOENT') throw error; });
  const index = JSON.stringify(manifest, null, 2) + '\n';
  if (priorBytes?.toString() !== index) await fs.writeFile(await local('manifest.json'), index);
  return { saved: writes.size, removed: deletions.length, versions: manifest.versions.length };
}
module.exports = { syncDocuments, filesFor, validateManifest };
if (require.main === module) syncDocuments().then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error.message); process.exitCode = 1; });
