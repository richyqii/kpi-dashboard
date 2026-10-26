const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
fs.mkdirSync(path.join(root, '.tools'), { recursive: true });
const reset = 'DROP TABLE IF EXISTS kpi_document_chunks; DROP TABLE IF EXISTS kpi_documents; DROP TABLE IF EXISTS kpi_deadlines; DROP TABLE IF EXISTS kpi_drafts; DROP TABLE IF EXISTS kpi_state; DROP TABLE IF EXISTS kpi_versions; DROP TABLE IF EXISTS kpi_auth_attempts;\n' + fs.readdirSync(path.join(root, 'migrations')).filter(name => name.endsWith('.sql')).sort().map(name => fs.readFileSync(path.join(root, 'migrations', name), 'utf8')).join('\n');
fs.writeFileSync(path.join(root, '.tools/test-schema.sql'), reset);
for (const directory of ['.wrangler/workflow-tests', '.wrangler/first-import-tests']) execFileSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'd1', 'execute', 'DB', '--local', '--persist-to', directory, '--file', '.tools/test-schema.sql'], {
  cwd: root, stdio: 'inherit', env: { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_PATH: '.tools/wrangler-tests-setup.log' }
});
