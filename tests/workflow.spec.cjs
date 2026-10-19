const { test, expect } = require('@playwright/test');
const path = require('node:path');
const XLSX = require('xlsx');
const { resetBaseline, upload, post } = require('./api-helpers.cjs');
const oldFile = 'KPI Checklist for Closing Year 2026.xlsx';
const currentFile = '2. 4 Main Services KPI Checklist 2025 & 2026-1.xlsx';

test('removing a saved file requires confirmation and preserves the current baseline', async ({ page }) => {
  const preview = await (await upload(page.request, oldFile)).json();
  await post(page.request, '/api/commit', { draftId: preview.id, approved: true });
  await resetBaseline(page.request);
  await page.reload();
  await page.locator('#versionHistory').click();
  const entry = page.locator('.workflow-version').first();
  await entry.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.locator('#workflowTitle')).toHaveText('Confirm Remove');
  await expect(page.locator('#workflowBody')).toContainText(oldFile);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect((await page.request.get('/api/versions/' + preview.id)).ok()).toBe(true);
  await entry.getByRole('button', { name: 'Remove', exact: true }).click();
  await page.route('**/api/versions/' + preview.id, route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Storage unavailable.' }) }));
  await page.getByRole('button', { name: 'Delete Document', exact: true }).click();
  await expect(page.locator('#workflowError')).toContainText('Storage unavailable');
  await page.unroute('**/api/versions/' + preview.id);
  await page.getByRole('button', { name: 'Delete Document', exact: true }).click();
  await expect(page.locator('#workflowMessage')).toContainText('Document removed successfully');
  expect((await page.request.get('/api/versions/' + preview.id)).status()).toBe(404);
  expect((await (await page.request.get('/api/current')).json()).version.id).toBe('initial-baseline');
  await expect(page.locator('.workflow-version').last().getByRole('button', { name: 'Remove', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.reload();
  expect((await (await page.request.get('/api/versions')).json()).versions.some(v => v.id === preview.id)).toBe(false);
});

test('deletion rejects missing confirmation, cross-site requests and newly selected baselines', async ({ page }) => {
  const preview = await (await upload(page.request, oldFile)).json();
  await post(page.request, '/api/commit', { draftId: preview.id, approved: true });
  await resetBaseline(page.request);
  const remove = (id, confirmed = true, origin = 'http://127.0.0.1:4173') => page.request.delete('/api/versions/' + id, { headers: { Origin: origin }, data: { confirmed } });
  expect((await remove(preview.id, false)).status()).toBe(400);
  expect((await remove(preview.id, true, 'https://elsewhere.example')).status()).toBe(403);
  await post(page.request, '/api/use-version', { versionId: preview.id, expectedVersionId: 'initial-baseline' });
  expect((await remove(preview.id)).status()).toBe(409);
  expect((await (await page.request.get('/api/current')).json()).version.id).toBe(preview.id);
  await resetBaseline(page.request);
  expect((await remove(preview.id)).ok()).toBe(true);
  expect((await remove(preview.id)).ok()).toBe(true);
  expect((await post(page.request, '/api/use-version', { versionId: preview.id, expectedVersionId: 'initial-baseline' })).status()).toBe(404);
});

test.beforeEach(async ({ page }) => {
  await resetBaseline(page.request);
  const history = await (await page.request.get('/api/versions')).json();
  for (const version of history.versions.filter(version => version.id !== history.currentId)) {
    await page.request.delete('/api/versions/' + version.id, { headers: { Origin: 'http://127.0.0.1:4173' }, data: { confirmed: true } });
  }
  await page.goto('/');
  await expect(page.locator('#excelUpload')).toBeEnabled();
});

test('history is available before baseline finishes loading and repeated clicks share a request', async ({ page }) => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/api/current', async route => { await gate; await route.continue().catch(() => {}); });
  let releaseHistory;
  const historyGate = new Promise(resolve => { releaseHistory = resolve; });
  let requests = 0;
  await page.route('**/api/versions', async route => { requests++; await historyGate; await route.continue(); });
  await page.reload();
  await expect(page.locator('#excelUpload')).toBeDisabled();
  await page.locator('#versionHistory').click();
  await expect(page.locator('#uploadWorkflow')).toBeVisible();
  await page.locator('#versionHistory').evaluate(button => { button.click(); button.click(); });
  await expect.poll(() => requests).toBe(1);
  releaseHistory();
  await expect(page.locator('.workflow-version').first()).toBeVisible();
  release();
  await expect(page.locator('#excelUpload')).toBeEnabled();
  expect(requests).toBe(1);
});

test('history opens immediately while requests are pending and ignores closed requests', async ({ page }) => {
  const data = await (await page.request.get('/api/versions')).json();
  let releaseHistory;
  const historyGate = new Promise(resolve => { releaseHistory = resolve; });
  let historyFinished;
  const historyDone = new Promise(resolve => { historyFinished = resolve; });
  await page.route('**/api/versions', async route => { await historyGate; await route.fulfill({ json: data }); historyFinished(); });
  await page.locator('#versionHistory').click();
  await expect(page.locator('#workflowTitle')).toHaveText('Version History');
  await expect(page.locator('#workflowMessage')).toHaveText('Loading saved versions…');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  releaseHistory();
  await historyDone;
  await expect(page.locator('#uploadWorkflow')).not.toBeVisible();
  await page.unroute('**/api/versions');
  await page.locator('#versionHistory').click();
  await expect(page.locator('.workflow-version').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'View Changes', exact: true })).toHaveCount(0);
});

test('history failures offer retry', async ({ page }) => {
  await page.route('**/api/versions', route => route.fulfill({ status: 503, json: { error: 'Storage unavailable.' } }));
  await page.locator('#versionHistory').click();
  await expect(page.locator('#workflowError')).toContainText('Storage unavailable');
  await page.unroute('**/api/versions');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.locator('.workflow-version').first()).toBeVisible();
  await expect(page.locator('#workflowError')).not.toBeVisible();
});

test('four stages preserve baseline until approval, then persist across reload and another viewer', async ({ page, browser }) => {
  const before = await (await page.request.get('/api/current')).json();
  await page.locator('#excelUpload').setInputFiles(path.join(__dirname, '../data', oldFile));
  await expect(page.locator('#workflowTitle')).toHaveText('Confirm Upload');
  await expect(page.locator('#currentFileName')).toContainText(currentFile);
  const comparison = await (await upload(page.request, oldFile)).json();
  await page.getByRole('button', { name: 'Validate File', exact: true }).click();
  await expect(page.locator('#workflowTitle')).toHaveText('KPI Changes Detected');
  await expect(page.locator('.change-total strong')).toHaveText(String(comparison.changedRecords));
  await expect(page.locator('.change-card')).toHaveCount(Object.values(comparison.counts).filter(count => count > 0).length);
  for (const [category, count] of Object.entries(comparison.counts)) {
    const card = page.locator('.change-card').filter({ has: page.getByRole('heading', { name: new RegExp(category) }) });
    if (count) await expect(card.locator('h4 span')).toHaveText(String(count));
    else await expect(card).toHaveCount(0);
  }
  await expect(page.locator('#changeSearch')).not.toBeVisible();
  await page.locator('#changeDetails > summary').click();
  await expect(page.locator('#changeGroup option')).toHaveText(['All groups', ...['Status Changes', 'Assignment Changes', 'Monthly Updates'].filter(category => comparison.counts[category] > 0)]);
  await expect(page.locator('#changeRows')).toContainText('Status Changes');
  await expect(page.locator('#changeRows')).toContainText('Assignment Changes');
  await page.locator('#changeSearch').fill('YOONG SHI');
  expect(await page.locator('#changeCount').textContent()).toMatch(/^[1-9]\d* of/);
  expect((await (await page.request.get('/api/current')).json()).version.id).toBe(before.version.id);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect((await (await page.request.get('/api/current')).json()).version.id).toBe(before.version.id);
  await page.locator('#excelUpload').setInputFiles(path.join(__dirname, '../data', oldFile));
  await page.getByRole('button', { name: 'Validate File', exact: true }).click();
  await page.getByRole('button', { name: 'Update Successful', exact: true }).click();
  await expect(page.locator('#workflowTitle')).toHaveText('Update Successful');
  await expect(page.locator('#workflowSteps li')).toHaveCount(4);
  await expect(page.locator('#workflowSteps li.current')).toHaveText('4. Update Successful');
  await expect(page.locator('#currentFileName')).toContainText(oldFile);
  await page.getByRole('button', { name: 'View Changes', exact: true }).click();
  await expect(page.locator('#workflowTitle')).toHaveText('View Changes');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.reload();
  await expect(page.locator('#currentFileName')).toContainText(oldFile);
  const viewer = await browser.newPage();
  await viewer.goto('http://127.0.0.1:4173');
  await expect(viewer.locator('#currentFileName')).toContainText(oldFile);
  await expect(viewer.locator('#excelUpload')).toBeEnabled();
  await viewer.close();
  // Upload the newer file against the saved older file, exercising both directions.
  await page.locator('#excelUpload').setInputFiles(path.join(__dirname, '../data', currentFile));
  await page.getByRole('button', { name: 'Use Uploaded File', exact: true }).click();
  await page.getByRole('button', { name: 'Update Successful', exact: true }).click();
  await expect(page.locator('#workflowTitle')).toHaveText('Update Successful');
  await expect(page.locator('#currentFileName')).toContainText(currentFile);
});

test('same filename uses newly uploaded contents, keeps the saved version and supports cancel', async ({ page }) => {
  const before = await (await page.request.get('/api/versions')).json();
  const replacement = { name: currentFile, mimeType: 'application/octet-stream', buffer: require('node:fs').readFileSync(path.join(__dirname, '../data', oldFile)) };
  await page.locator('#excelUpload').setInputFiles(replacement);
  await expect(page.locator('#workflowMessage')).toHaveText('Do you want to use the newly uploaded file?');
  await expect(page.locator('#workflowSteps li.current')).toHaveText('1. Confirm Upload');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect((await (await page.request.get('/api/current')).json()).version.id).toBe(before.currentId);
  await page.locator('#excelUpload').setInputFiles(replacement);
  await page.getByRole('button', { name: 'Use Uploaded File', exact: true }).click();
  await expect(page.locator('#workflowTitle')).toHaveText('KPI Changes Detected');
  expect((await (await page.request.get('/api/current')).json()).rows).toHaveLength(1830);
  await page.getByRole('button', { name: 'Update Successful', exact: true }).click();
  await expect(page.locator('#workflowTitle')).toHaveText('Update Successful');
  const current = await (await page.request.get('/api/current')).json();
  expect(current.rows).toHaveLength(1482);
  expect(current.version.fileName).toBe(currentFile);
  expect(current.version.id).not.toBe(before.currentId);
  const history = await (await page.request.get('/api/versions')).json();
  expect(history.versions.length).toBe(before.versions.length + 1);
  expect(history.versions.some(v => v.id === before.currentId)).toBe(true);
});

test('same historical filename validates uploaded bytes instead of restoring saved data', async ({ page }) => {
  const preview = await (await upload(page.request, oldFile)).json();
  await post(page.request, '/api/commit', { draftId: preview.id, approved: true });
  await resetBaseline(page.request);
  await page.reload();
  await expect(page.locator('#excelUpload')).toBeEnabled();
  await page.locator('#excelUpload').setInputFiles({ name: oldFile, mimeType: 'application/octet-stream', buffer: Buffer.from('not a workbook') });
  await expect(page.locator('#workflowMessage')).toHaveText('Do you want to use the newly uploaded file?');
  await page.getByRole('button', { name: 'Use Uploaded File', exact: true }).click();
  await expect(page.locator('#workflowTitle')).toHaveText('Validation Failed');
  expect((await (await page.request.get('/api/current')).json()).version.id).toBe('initial-baseline');
});

test('no-change uploads, confirmation cancel and validation errors never create a new version', async ({ page }) => {
  const before = await (await page.request.get('/api/versions')).json();
  await page.locator('#excelUpload').setInputFiles(path.join(__dirname, '../data', currentFile));
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.locator('#excelUpload').setInputFiles({ name: 'baseline-copy.xlsx', mimeType: 'application/octet-stream', buffer: require('node:fs').readFileSync(path.join(__dirname, '../data', currentFile)) });
  await page.getByRole('button', { name: 'Validate File', exact: true }).click();
  await expect(page.locator('#workflowTitle')).toHaveText('No Changes Detected');
  await expect(page.getByRole('button', { name: 'Update Successful' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.locator('#excelUpload').setInputFiles({ name: 'broken.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.from('not an excel workbook') });
  await page.getByRole('button', { name: 'Validate File', exact: true }).click();
  await expect(page.locator('#workflowTitle')).toHaveText('Validation Failed');
  await expect(page.locator('#workflowError')).toBeVisible();
  const after = await (await page.request.get('/api/versions')).json();
  expect(after.versions.length).toBe(before.versions.length);
  expect(after.currentId).toBe(before.currentId);
});

test('Use This Version selects the saved baseline and retains all versions', async ({ page }) => {
  const chartIds = ['donutCompleteLegend', 'donutDelayLegend', 'donutApprovalLegend', 'donutNaLegend', 'chartCompletedTotal', 'chartDelayTotal', 'chartApprovalTotal', 'chartNaTotal'];
  const chartValues = await Promise.all(chartIds.map(id => page.locator('#' + id).textContent()));
  const preview = await (await upload(page.request, oldFile)).json();
  expect((await post(page.request, '/api/commit', { draftId: preview.id, approved: true })).ok()).toBe(true);
  await page.reload();
  await expect(page.locator('#currentFileName')).toContainText(oldFile);
  await page.locator('#versionHistory').click();
  // The oldest entry is the original seeded baseline.
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/api/rollback-preview', async route => { await gate; await route.continue(); });
  await page.locator('.workflow-version').last().getByRole('button', { name: 'Use This Version' }).click();
  await expect(page.locator('#workflowTitle')).toHaveText('Validating Document');
  release();
  await expect(page.locator('#workflowTitle')).toHaveText('KPI Changes Detected');
  expect((await (await page.request.get('/api/current')).json()).version.id).toBe(preview.id);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect((await (await page.request.get('/api/current')).json()).version.id).toBe(preview.id);
  await page.locator('#versionHistory').click();
  await page.locator('.workflow-version').last().getByRole('button', { name: 'Use This Version' }).click();
  await page.getByRole('button', { name: 'Update Successful', exact: true }).click();
  await expect(page.locator('#workflowTitle')).toHaveText('Update Successful');
  await expect(page.locator('#currentFileName')).toContainText(currentFile);
  const data = await (await page.request.get('/api/versions')).json();
  expect(data.currentId).toBe('initial-baseline');
  expect((await (await page.request.get('/api/current')).json()).rows).toHaveLength(1830);
  expect(data.versions.some(version => version.id === preview.id)).toBe(true);
  for (let i = 0; i < chartIds.length; i++) await expect(page.locator('#' + chartIds[i])).toHaveText(chartValues[i]);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.reload();
  await expect(page.locator('#currentFileName')).toContainText(currentFile);
  expect((await post(page.request, '/api/use-version', { versionId: preview.id, expectedVersionId: 'stale-version' })).status()).toBe(409);
  expect((await post(page.request, '/api/use-version', { versionId: 'missing', expectedVersionId: data.currentId })).status()).toBe(404);
  expect((await (await page.request.get('/api/current')).json()).version.id).toBe('initial-baseline');
  await page.screenshot({ path: '.tools/workflow-success.png', fullPage: true });
});

test('API allows shared access and blocks missing approval, cross-site requests and stale reviews', async ({ page, playwright }) => {
  const outsider = await playwright.request.newContext({ baseURL: 'http://127.0.0.1:4173' });
  expect((await outsider.get('/api/versions')).ok()).toBe(true);
  expect((await page.request.post('/api/commit', { headers: { Origin: 'https://another-site.example' }, data: {} })).status()).toBe(403);
  const first = await (await upload(page.request, oldFile)).json();
  const stale = await (await upload(page.request, oldFile)).json();
  expect((await post(page.request, '/api/commit', { draftId: first.id })).status()).toBe(400);
  const approved = await post(page.request, '/api/commit', { draftId: first.id, approved: true });
  expect(approved.ok()).toBe(true);
  expect((await post(page.request, '/api/commit', { draftId: stale.id, approved: true })).status()).toBe(409);
  const retry = await (await post(page.request, '/api/commit', { draftId: first.id, approved: true })).json();
  expect(retry.version.id).toBe(first.id);
  await outsider.dispose();
});

test('upload and history are available without sign-in', async ({ page }) => {
  await expect(page.locator('#adminLogin')).toHaveCount(0);
  await expect(page.locator('#excelUpload')).toBeEnabled();
  await page.locator('#versionHistory').click();
  await expect(page.locator('#workflowTitle')).toHaveText('Version History');
});

test('first import creates a baseline without a fabricated change report', async ({ page }) => {
  await page.goto('http://127.0.0.1:4174');
  await expect(page.locator('#currentFileName')).toHaveText('Current file: No baseline yet');
  await expect(page.locator('#excelUpload')).toBeEnabled();
  await page.locator('#excelUpload').setInputFiles(path.join(__dirname, '../data', currentFile));
  await page.getByRole('button', { name: 'Validate File', exact: true }).click();
  await expect(page.locator('#workflowMessage')).toHaveText('Ready to create the initial baseline.');
  await expect(page.locator('#changeRows')).toHaveCount(0);
  await page.getByRole('button', { name: 'Update Successful', exact: true }).click();
  await expect(page.locator('#workflowTitle')).toHaveText('Update Successful');
  await expect(page.locator('#currentFileName')).toContainText(currentFile);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.reload();
  await expect(page.locator('#currentFileName')).toContainText(currentFile);
});

test('validation loading is visible; cancellation and a save failure leave the baseline unchanged', async ({ page }) => {
  const before = await (await page.request.get('/api/current')).json();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/api/preview', async route => { await gate; await route.continue().catch(() => {}); });
  await page.locator('#excelUpload').setInputFiles(path.join(__dirname, '../data', oldFile));
  await page.getByRole('button', { name: 'Validate File', exact: true }).click();
  await expect(page.locator('#workflowTitle')).toHaveText('Validating Document');
  await expect(page.locator('#workflowMessage')).toContainText('Checking KPI worksheets');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  release();
  await page.unroute('**/api/preview');
  expect((await (await page.request.get('/api/current')).json()).version.id).toBe(before.version.id);
  await page.locator('#excelUpload').setInputFiles(path.join(__dirname, '../data', oldFile));
  await page.getByRole('button', { name: 'Validate File', exact: true }).click();
  await page.route('**/api/commit', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Storage temporarily unavailable.' }) }));
  await page.getByRole('button', { name: 'Update Successful', exact: true }).click();
  await expect(page.locator('#workflowError')).toContainText('Storage temporarily unavailable');
  expect((await (await page.request.get('/api/current')).json()).version.id).toBe(before.version.id);
  await page.unroute('**/api/commit');
  await page.getByRole('button', { name: 'Update Successful', exact: true }).click();
  await expect(page.locator('#workflowTitle')).toHaveText('Update Successful');
});

test('future-month blanks are shown as not due and excluded from delay totals', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-19T00:00:00Z'));
  await page.locator('#fromDate').fill('2026-10');
  await page.locator('#toDate').fill('2027-01');
  await page.locator('#toDate').dispatchEvent('change');
  await expect(page.locator('#donutDelayLegend')).toHaveText('0');
  await expect(page.locator('#chartDelayTotal')).toHaveText('0');
  await expect(page.locator('#pendingTaskNote')).toContainText('9 blank tasks are not due yet');
  await expect(page.locator('.gantt-row-label')).toContainText(['Not due yet']);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#excelUpload').setInputFiles(path.join(__dirname, '../data', oldFile));
  await page.getByRole('button', { name: 'Validate File', exact: true }).click();
  await expect(page.locator('#workflowTitle')).toHaveText('KPI Changes Detected');
  expect(await page.locator('#uploadWorkflow').evaluate(el => el.getBoundingClientRect().right <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.tools/workflow-mobile.png', fullPage: true });
});

test('company matching recalculates the preview before allowing approval', async ({ page }) => {
  const workbook = XLSX.readFile(path.join(__dirname, '../data', currentFile), { cellStyles: true, sheetStubs: true });
  workbook.Sheets['1. ACC'].B7.v = 'RENAMED ADVISOR SDN BHD';
  delete workbook.Sheets['1. ACC'].B7.w;
  await page.locator('#excelUpload').setInputFiles({ name: 'renamed-company.xlsx', mimeType: 'application/octet-stream', buffer: XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) });
  await page.getByRole('button', { name: 'Validate File', exact: true }).click();
  await expect(page.locator('#workflowTitle')).toHaveText('KPI Changes Detected');
  await page.locator('#changeDetails > summary').click();
  await page.locator('.workflow-mappings summary').click();
  const mapping = page.locator('.workflow-mapping').filter({ hasText: 'RENAMED ADVISOR SDN BHD' });
  await mapping.locator('select').selectOption({ label: 'VALUED SYSTEM ADVISOR SDN BHD · YOONG SHI · Main' });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/api/match', async route => { await gate; await route.continue(); });
  await page.getByRole('button', { name: 'Recalculate matches' }).click();
  await expect(page.getByRole('button', { name: 'Update Successful' })).toBeDisabled();
  release();
  await expect(page.getByRole('button', { name: 'Update Successful' })).toBeEnabled();
  await page.locator('#changeDetails > summary').click();
  await page.locator('#changeSearch').fill('RENAMED ADVISOR');
  await expect(page.locator('#changeRows')).toContainText('Previously: VALUED SYSTEM ADVISOR SDN BHD');
  await expect(page.locator('#changeRows')).toContainText('Reassigned task');
  await page.getByRole('button', { name: 'Update Successful', exact: true }).click();
  await expect(page.locator('#workflowTitle')).toHaveText('Update Successful');
});
