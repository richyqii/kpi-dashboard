import * as XLSX from 'xlsx/xlsx.mjs';
import Core from '../public/kpi-core.js';
import baseline from '../data/baseline.json';
import { storeDocument, documentRoute, removeUnusedDocuments } from './documents.js';

const encoder = new TextEncoder();
const fail = (status, message, details) => { throw Object.assign(new Error(message), { status, details }); };
const json = (body, status = 200, headers = {}) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
const id = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const query = (env, sql, ...args) => env.DB.prepare(sql).bind(...args);
const metadata = row => row && ({ id: row.id, parentId: row.parent_id, fileName: row.filename, createdAt: row.created_at, kind: row.kind, restoredFrom: row.restored_from, summary: JSON.parse(row.summary_json) });
const summary = result => ({ counts: result.counts, changedRecords: result.changedRecords, records: result.rows.length, firstImport: result.firstImport });
function sizeCheck(value) { if (encoder.encode(JSON.stringify(value)).length > 1800000) fail(422, 'The workbook produces too much version data. Use a smaller workbook (up to 6,000 monthly tasks).'); }
async function bootstrap(env) {
  if (env.EMPTY_BASELINE === 'true') return;
  if ((await query(env, 'SELECT current_id FROM kpi_state WHERE id = 1').first())?.current_id) return;
  const result = Core.compare(null, baseline.rows);
  await env.DB.batch([
    query(env, `INSERT OR IGNORE INTO kpi_versions (id, parent_id, filename, created_at, kind, rows_json, changes_json, summary_json)
      SELECT ?, NULL, ?, ?, 'baseline', ?, '[]', ? WHERE NOT EXISTS (SELECT 1 FROM kpi_versions)`, 'initial-baseline', baseline.fileName, baseline.createdAt, JSON.stringify(result.rows), JSON.stringify(summary(result))),
    query(env, `UPDATE kpi_state SET current_id = 'initial-baseline' WHERE id = 1 AND current_id IS NULL AND EXISTS (SELECT 1 FROM kpi_versions WHERE id = 'initial-baseline')`)
  ]);
}
async function current(env) {
  return query(env, 'SELECT v.* FROM kpi_state s LEFT JOIN kpi_versions v ON s.current_id = v.id WHERE s.id = 1').first();
}
async function readBody(request, limit = 10000) {
  const content = await request.text();
  if (content.length > limit) fail(413, 'Request is too large.');
  try { return JSON.parse(content); } catch { fail(400, 'Invalid request.'); }
}
async function draftResult(env, draft) {
  if (!draft || draft.expires_at < Date.now()) fail(410, 'This review has expired. Upload the file again.');
  const active = await current(env);
  if ((active?.id || null) !== draft.base_id) fail(409, 'The saved baseline changed while you were reviewing. Upload again to compare with the latest version.');
  return active;
}
async function saveDraft(env, active, fileName, input, kind = 'upload', restoredFrom = null) {
  const result = Core.compare(active?.id ? JSON.parse(active.rows_json) : null, input);
  const removedCompanies = result.companyChanges?.removed || [];
  const warnings = [];
  if (removedCompanies.length) warnings.push(`Warning: ${removedCompanies.length} company record${removedCompanies.length === 1 ? '' : 's'} (${removedCompanies.slice(0, 5).map(item => `${item.service}: ${item.company}`).join('; ')}${removedCompanies.length > 5 ? '; …' : ''}) no longer exist in the uploaded document. Approving will delete these saved records.`);
  const draft = { id: id(), baseId: active?.id || null, fileName, createdAt: now(), expiresAt: Date.now() + 3600000, kind, restoredFrom };
  sizeCheck({ input, result });
  await query(env, 'DELETE FROM kpi_drafts WHERE expires_at < ?', Date.now()).run();
  await removeUnusedDocuments(env);
  await query(env, 'INSERT INTO kpi_drafts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', draft.id, draft.baseId, fileName, draft.createdAt, draft.expiresAt, kind, restoredFrom, JSON.stringify(input), JSON.stringify(result)).run();
  return { ...draft, ...result, warnings: [...warnings, ...(result.warnings || [])], rows: undefined };
}
export async function api(request, env) {
  const url = new URL(request.url), route = url.pathname;
  try {
    if (!env.DB) fail(503, 'Shared storage is not configured. Saved data cannot be changed.');
    if (!['GET', 'POST', 'DELETE'].includes(request.method)) fail(405, 'Method not allowed.');
    if (request.method !== 'GET' && request.headers.get('Origin') !== url.origin) fail(403, 'This request must come from the dashboard.');
    await bootstrap(env);
    const documentResponse = await documentRoute(request, env);
    if (documentResponse) return documentResponse;
    const deadlineRows = await query(env, 'SELECT month, deadline FROM kpi_deadlines').all();
    const deadlines = Object.fromEntries(deadlineRows.results.map(row => [row.month, row.deadline]));
    Core.setDeadlines(deadlines);
    if (route === '/api/deadlines' && request.method === 'POST') {
      const body = await readBody(request);
      const months = body.months || [body.month];
      if (!Array.isArray(months) || !months.length || months.length > 120 || months.some(month => typeof month !== 'string' || !/^20\d\d-(0[1-9]|1[0-2])$/.test(month)) || !/^20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(body.deadline || '') || new Date(body.deadline + 'T00:00:00Z').toISOString().slice(0,10) !== body.deadline) fail(422, 'Choose a valid reporting month and deadline date.');
      await env.DB.batch([...new Set(months)].map(month => query(env, 'INSERT INTO kpi_deadlines (month, deadline, updated_at) VALUES (?, ?, ?) ON CONFLICT(month) DO UPDATE SET deadline=excluded.deadline, updated_at=excluded.updated_at', month, body.deadline, now())));
      return json({ deadlines: { ...deadlines, ...Object.fromEntries(months.map(month => [month, body.deadline])) } });
    }
    if (route === '/api/current' && request.method === 'GET') {
      const active = await current(env);
      return json({ deadlines, version: active?.id ? metadata(active) : null, rows: active?.id ? JSON.parse(active.rows_json) : [] });
    }
    if (route === '/api/versions' && request.method === 'GET') {
      const [records, state] = await env.DB.batch([
        query(env, 'SELECT id, parent_id, filename, created_at, kind, restored_from, summary_json FROM kpi_versions ORDER BY rowid DESC'),
        query(env, 'SELECT current_id FROM kpi_state WHERE id = 1')
      ]);
      return json({ versions: records.results.map(metadata), currentId: state.results[0]?.current_id || null });
    }
    if (route.startsWith('/api/versions/') && request.method === 'GET') {
      const version = await query(env, 'SELECT id, parent_id, filename, created_at, kind, restored_from, summary_json, changes_json FROM kpi_versions WHERE id = ?', route.slice('/api/versions/'.length)).first();
      if (!version) fail(404, 'Version not found.');
      return json({ version: metadata(version), changes: JSON.parse(version.changes_json) });
    }
    if (route.startsWith('/api/versions/') && request.method === 'DELETE') {
      const body = await readBody(request);
      if (body.confirmed !== true) fail(400, 'Confirm removal before deleting this version.');
      const versionId = route.slice('/api/versions/'.length);
      // Check the active pointer in the same statement so a concurrent selection
      // cannot delete the dataset currently displayed by the dashboard.
      const result = await query(env, 'DELETE FROM kpi_versions WHERE id = ? AND id IS NOT (SELECT current_id FROM kpi_state WHERE id = 1)', versionId).run();
      if (!result.meta.changes && (await current(env))?.id === versionId) fail(409, 'This file is the current baseline. Use another version before removing it.');
      await query(env, 'DELETE FROM kpi_drafts WHERE id = ?', versionId).run();
      await removeUnusedDocuments(env);
      return json({ removed: true, versionId });
    }
    if (route === '/api/preview' && request.method === 'POST') {
      const active = await current(env);
      if ((request.headers.get('X-Baseline-Id') || '') !== (active?.id || '')) fail(409, 'The baseline changed. Refresh the dashboard and validate this file again.');
      const fileName = decodeURIComponent(request.headers.get('X-File-Name') || '');
      if (!/\.xlsx?$/i.test(fileName) || fileName.length > 250) fail(422, 'Select an Excel .xlsx or .xls file.');
      if (Number(request.headers.get('Content-Length') || 0) > 5000000) fail(413, 'Excel files must be smaller than 5 MB.');
      const bytes = await request.arrayBuffer();
      if (bytes.byteLength > 5000000 || !bytes.byteLength) fail(413, 'Select a nonempty Excel file smaller than 5 MB.');
      let workbook;
      try { workbook = XLSX.read(bytes, { type: 'array', cellStyles: true, sheetStubs: true, cellDates: false }); }
      catch { fail(422, 'The Excel file could not be read. Check that it is not damaged or password protected.'); }
      const result = Core.validateWorkbook(workbook, XLSX, active?.id ? JSON.parse(active.rows_json) : []);
      if (result.errors.length) fail(422, 'Document validation failed. The saved baseline is unchanged.', result.errors);
      const draft = await saveDraft(env, active, fileName, result.rows);
      try { await storeDocument(env, draft.id, bytes); }
      catch (error) { await query(env, 'DELETE FROM kpi_drafts WHERE id = ?', draft.id).run(); throw error; }
      return json({ ...draft, warnings: result.warnings });
    }
    if (route === '/api/use-version' && request.method === 'POST') {
      const body = await readBody(request);
      if (typeof body.versionId !== 'string' || typeof body.expectedVersionId !== 'string') fail(400, 'Select a version and provide the current baseline.');
      const target = await query(env, 'SELECT * FROM kpi_versions WHERE id = ?', body.versionId).first();
      if (!target) fail(404, 'Version not found.');
      const result = await query(env, 'UPDATE kpi_state SET current_id = ? WHERE id = 1 AND current_id IS ? AND EXISTS (SELECT 1 FROM kpi_versions WHERE id = ?)', target.id, body.expectedVersionId, target.id).run();
      if (!result.meta.changes && (await current(env))?.id !== target.id) fail(409, 'The baseline changed. Reopen Version History and select the file again.');
      return json({ version: metadata(target), rows: JSON.parse(target.rows_json) });
    }
    if (route === '/api/rollback-preview' && request.method === 'POST') {
      const body = await readBody(request);
      const active = await current(env);
      if (body.expectedVersionId !== (active?.id || null)) fail(409, 'The baseline changed. Reopen Version History and try again.');
      const target = await query(env, 'SELECT * FROM kpi_versions WHERE id = ?', String(body.versionId)).first();
      if (!target) fail(404, 'Version not found.');
      const validated = Core.validateRows(JSON.parse(target.rows_json));
      if (validated.errors.length) fail(422, 'Saved document validation failed. The baseline is unchanged.', validated.errors);
      return json({ ...await saveDraft(env, active, target.filename, validated.rows, 'selection', target.id), mappingOptions: [] });
    }
    if (route === '/api/match' && request.method === 'POST') {
      const body = await readBody(request, 100000);
      const draft = await query(env, 'SELECT * FROM kpi_drafts WHERE id = ?', String(body.draftId)).first();
      const active = await draftResult(env, draft);
      let result;
      try { result = Core.compare(active?.id ? JSON.parse(active.rows_json) : null, JSON.parse(draft.input_json), body.mappings || {}); }
      catch (error) { fail(422, error.message); }
      sizeCheck({ input: JSON.parse(draft.input_json), result });
      await query(env, 'UPDATE kpi_drafts SET result_json = ? WHERE id = ?', JSON.stringify(result), draft.id).run();
      return json({ id: draft.id, baseId: draft.base_id, fileName: draft.filename, kind: draft.kind, ...result, rows: undefined });
    }
    if (route.startsWith('/api/drafts/') && request.method === 'DELETE') {
      await query(env, 'DELETE FROM kpi_drafts WHERE id = ?', route.slice('/api/drafts/'.length)).run();
      await removeUnusedDocuments(env);
      return json({ cancelled: true });
    }
    if (route === '/api/commit' && request.method === 'POST') {
      const body = await readBody(request);
      if (body.approved !== true) fail(400, 'Explicit approval is required.');
      const committed = await query(env, 'SELECT * FROM kpi_versions WHERE id = ?', String(body.draftId)).first();
      if (committed) return json({ version: metadata(committed), rows: JSON.parse(committed.rows_json), changes: JSON.parse(committed.changes_json) });
      const draft = await query(env, 'SELECT * FROM kpi_drafts WHERE id = ?', String(body.draftId)).first();
      if (draft?.kind === 'selection') {
        if (draft.expires_at < Date.now()) fail(410, 'This review has expired. Select the version again.');
        const target = await query(env, 'SELECT * FROM kpi_versions WHERE id = ?', draft.restored_from).first();
        if (!target) fail(404, 'The selected version was removed. Reopen Version History.');
        const switched = await query(env, 'UPDATE kpi_state SET current_id = ? WHERE id = 1 AND current_id IS ? AND EXISTS (SELECT 1 FROM kpi_versions WHERE id = ?)', target.id, draft.base_id, target.id).run();
        if (!switched.meta.changes && (await current(env))?.id !== target.id) fail(409, 'The baseline changed while you were reviewing. Select the version again.');
        const result = JSON.parse(draft.result_json);
        return json({ version: { ...metadata(target), summary: summary(result) }, rows: JSON.parse(target.rows_json), changes: result.changes, companyChanges: result.companyChanges });
      }
      await draftResult(env, draft);
      const result = JSON.parse(draft.result_json);
      if (!result.firstImport && !result.changes.length && body.useUploadedFile !== true) return json({ noChanges: true, version: metadata(await current(env)) });
      const versionId = draft.id, created = now();
      sizeCheck({ rows: result.rows, changes: result.changes });
      // D1 batch is transactional. The conditional INSERT and pointer update form
      // a compare-and-swap: a stale review cannot overwrite a newer approval.
      const statements = [
        query(env, `INSERT INTO kpi_versions (id, parent_id, filename, created_at, kind, restored_from, rows_json, changes_json, summary_json)
          SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE (SELECT current_id FROM kpi_state WHERE id = 1) IS ?`, versionId, draft.base_id, draft.filename, created, result.firstImport ? 'baseline' : draft.kind, draft.restored_from, JSON.stringify(result.rows), JSON.stringify(result.changes), JSON.stringify(summary(result)), draft.base_id),
        query(env, 'UPDATE kpi_state SET current_id = ? WHERE id = 1 AND current_id IS ? AND EXISTS (SELECT 1 FROM kpi_versions WHERE id = ?)', versionId, draft.base_id, versionId),
        query(env, 'DELETE FROM kpi_drafts WHERE id = ?', draft.id)
      ];
      const results = await env.DB.batch(statements);
      if (!results[0].meta.changes) fail(409, 'Someone else updated the baseline. Validate the file again.');
      return json({ version: metadata(await query(env, 'SELECT * FROM kpi_versions WHERE id = ?', versionId).first()), rows: result.rows, changes: result.changes });
    }
    fail(404, 'API route not found.');
  } catch (error) {
    if (!error.status) console.error('KPI API failure:', route, error.message);
    return json({ error: error.status ? error.message : 'The operation could not be completed. Please retry or refresh to check the current saved version.', details: error.details }, error.status || 500);
  }
}
