const fs = require('node:fs');
const path = require('node:path');
const origin = process.env.KPI_TEST_ORIGIN || 'http://127.0.0.1:4173';
async function post(request, url, data) { return request.post(url, { headers: { Origin: origin }, data }); }
async function resetBaseline(request) {
  const current = await (await request.get('/api/current')).json();
  if (current.version.id !== 'initial-baseline') {
    const response = await post(request, '/api/use-version', { versionId: 'initial-baseline', expectedVersionId: current.version.id });
    if (!response.ok()) throw Error('Test baseline reset failed: ' + response.status());
  }
}
async function upload(request, filename, bytes) {
  const current = await (await request.get('/api/current')).json();
  return request.post('/api/preview', { headers: { Origin: origin, 'X-File-Name': encodeURIComponent(path.basename(filename)), 'X-Baseline-Id': current.version?.id || '', 'Content-Type': 'application/octet-stream' }, data: bytes || fs.readFileSync(path.join(__dirname, '../data', filename)) });
}
module.exports = { origin, post, resetBaseline, upload };
