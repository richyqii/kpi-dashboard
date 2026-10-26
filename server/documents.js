const query = (env, sql, ...args) => env.DB.prepare(sql).bind(...args);
export async function storeDocument(env, id, bytes) {
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
  const statements = [query(env, 'INSERT INTO kpi_documents VALUES (?, ?, ?)', id, hash, bytes.byteLength)];
  // Keep each BLOB comfortably below D1's per-row size limit.
  for (let offset = 0; offset < bytes.byteLength; offset += 250000) {
    statements.push(query(env, 'INSERT INTO kpi_document_chunks VALUES (?, ?, ?)', id, offset / 250000, bytes.slice(offset, offset + 250000)));
  }
  await env.DB.batch(statements);
}
export async function documentRoute(request, env) {
  const path = new URL(request.url).pathname;
  const json = value => Response.json(value, { headers: { 'Cache-Control': 'no-store' } });
  if (request.method !== 'GET') return null;
  if (path === '/api/sync-manifest') {
    const [state, versions] = await env.DB.batch([
      query(env, 'SELECT current_id FROM kpi_state WHERE id = 1'),
      query(env, `SELECT v.id, v.filename AS fileName, v.created_at AS createdAt, d.sha256, d.byte_length AS byteLength
        FROM kpi_versions v LEFT JOIN kpi_documents d ON d.id = v.id ORDER BY v.id`)
    ]);
    return json({ schema: 1, currentId: state.results[0]?.current_id || null, versions: versions.results });
  }
  const match = path.match(/^\/api\/versions\/([^/]+)\/(document|snapshot)$/);
  if (!match) return null;
  const version = await query(env, 'SELECT * FROM kpi_versions WHERE id = ?', match[1]).first();
  if (!version) return Response.json({ error: 'Version not found.' }, { status: 404 });
  if (match[2] === 'snapshot') return json({ id: version.id, fileName: version.filename, createdAt: version.created_at, rows: JSON.parse(version.rows_json) });
  const document = await query(env, 'SELECT * FROM kpi_documents WHERE id = ?', version.id).first();
  if (!document) return Response.json({ error: 'The original Excel file was not retained for this older version.' }, { status: 404 });
  const chunks = await query(env, 'SELECT bytes FROM kpi_document_chunks WHERE document_id = ? ORDER BY chunk_index', version.id).all();
  const bytes = new Uint8Array(document.byte_length);
  let offset = 0;
  for (const chunk of chunks.results) { const part = new Uint8Array(chunk.bytes); bytes.set(part, offset); offset += part.length; }
  if (offset !== bytes.length) throw new Error('Incomplete document storage.');
  return new Response(bytes, { headers: { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(version.filename)}`, 'X-Content-SHA256': document.sha256 } });
}
export function removeUnusedDocuments(env) {
  return query(env, `DELETE FROM kpi_documents WHERE NOT EXISTS (SELECT 1 FROM kpi_versions WHERE id = kpi_documents.id)
    AND NOT EXISTS (SELECT 1 FROM kpi_drafts WHERE id = kpi_documents.id)`).run();
}
