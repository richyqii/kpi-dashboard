const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const XLSX = require('xlsx');
const { rowsFromWorkbook, statusKeys } = require('../public/kpi-workbook');
const { resetBaseline } = require('./api-helpers.cjs');
const file = path.join(__dirname, '../data/2. 4 Main Services KPI Checklist 2025 & 2026-1.xlsx');
const rows = rowsFromWorkbook(XLSX.readFile(file, { cellStyles: true, sheetStubs: true }), XLSX);

test.beforeEach(async ({ page }) => {
  await resetBaseline(page.request);
  await page.clock.setFixedTime(new Date('2027-02-01T00:00:00Z'));
  // Use the same pinned Excel reader without relying on CDN connectivity in tests.
  await page.route('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js', route =>
    route.fulfill({ path: require.resolve('xlsx/dist/xlsx.full.min.js'), contentType: 'text/javascript' }));
  await page.goto('/?v=20260611a');
  await expect(page.locator('#excelUpload')).toBeEnabled();
});

async function fullRange(page) {
  await page.locator('#fromDate').fill('2025-01');
  // The existing dashboard uses "To" as the review month, excluding that month.
  await page.locator('#toDate').fill('2027-01');
  await page.locator('#toDate').dispatchEvent('change');
}

test('all service, PIC, reviewer and invoice filters reconcile to workbook totals', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await fullRange(page);
  const groups = new Map(rows.map(row => [JSON.stringify([row.service, row.pic, row.role, row.invoiceType || '']), row]));
  const names = { 'YOONG SHI': 'Yoong Shi', 'JIA WEN': 'Jia Wen', 'LING YIN': 'Ling Yin', IZA: 'Iza' };
  const legendIds = ['donutCompleteLegend', 'donutDelayLegend', 'donutApprovalLegend', 'donutNaLegend'];
  const totalIds = ['chartCompletedTotal', 'chartDelayTotal', 'chartApprovalTotal', 'chartNaTotal'];
  for (const row of groups.values()) {
    await page.locator('#picTabs').selectOption({ label: names[row.pic] });
    await page.locator('#serviceTabs').selectOption({ label: row.service });
    if (row.service === 'Accounting') await page.locator('#roleTabs').selectOption({ label: `${row.role} Reviewer` });
    if (row.invoiceType) await page.locator('#invoiceTypeTabs').getByRole('button', { name: row.invoiceType, exact: true }).click();
    const expected = rows.filter(r => r.service === row.service && r.pic === row.pic && r.role === row.role && r.invoiceType === row.invoiceType);
    for (let i = 0; i < statusKeys.length; i++) {
      const count = expected.reduce((sum, r) => sum + r[statusKeys[i]], 0);
      await expect(page.locator('#' + legendIds[i])).toHaveText(String(count));
      await expect(page.locator('#' + totalIds[i])).toHaveText(String(count));
      await expect(page.locator('#' + ['completeShare', 'delayShare', 'approvalShare', 'naShare'][i])).toHaveText((expected.length ? count / expected.length * 100 : 0).toFixed(1) + '%');
    }
    await expect(page.locator('#donutAssignedLegend')).toHaveText(String(expected.length));
    await expect(page.locator('.gantt-row-label')).toHaveText(['Task Done', 'Delay Task', 'Wait for Approval', 'Not Applicable']);
  }
  expect(errors).toEqual([]);
});

test('four status filters, company selection, workbook upload and revert work', async ({ page }) => {
  await fullRange(page);
  await page.locator('#serviceTabs').selectOption({ label: 'SST' });
  for (const [focus, label] of [['complete', 'Task Done'], ['delay', 'Delay Task'], ['approval', 'Wait for Approval'], ['na', 'Not Applicable']]) {
    await page.locator(`[data-status="${focus}"]`).click();
    await expect(page.locator('.gantt-row-label')).toHaveText([label]);
  }
  await page.locator('#selectAllStatusButton').click();
  await expect(page.locator('.gantt-row-label')).toHaveCount(4);
  await page.locator('#companyBoxList').getByRole('button', { name: 'VALUED SYSTEM ADVISORY SDN BHD', exact: true }).click();
  await expect(page.locator('#chartApprovalTotal')).toHaveText('2');
  await expect(page.locator('#chartNaTotal')).toHaveText('0');
  await page.locator('#excelUpload').setInputFiles({ name: 'baseline-copy.xlsx', mimeType: 'application/octet-stream', buffer: fs.readFileSync(file) });
  await page.getByRole('button', { name: 'Validate File', exact: true }).click();
  await expect(page.locator('#workflowTitle')).toHaveText('No Changes Detected');
  await expect(page.locator('#donutApprovalLegend')).toHaveText('4');
  await expect(page.locator('#chartApprovalTotal')).toHaveText('2');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('#currentFileName')).toContainText(path.basename(file));
  await expect(page.locator('#donutApprovalLegend')).toHaveText('4');
});

test('month boundaries, empty reviewer selection, and mobile layout remain usable', async ({ page }) => {
  await page.locator('#serviceTabs').selectOption({ label: 'SST' });
  await page.locator('#fromDate').fill('2026-07');
  await page.locator('#toDate').fill('2026-08');
  await page.locator('#toDate').dispatchEvent('change');
  await expect(page.locator('#donutApprovalLegend')).toHaveText('2');
  await expect(page.locator('#chartApprovalTotal')).toHaveText('2');
  await page.locator('#fromDate').fill('2026-08');
  await page.locator('#fromDate').dispatchEvent('change');
  await expect(page.locator('#donutAssignedLegend')).toHaveText('0');
  await expect(page.locator('#donutRate')).toHaveText('0.0%');
  await fullRange(page);
  await page.locator('#serviceTabs').selectOption({ label: 'Accounting' });
  await page.locator('#roleTabs').selectOption({ label: 'Sub Reviewer' });
  await expect(page.locator('#companyKpi')).toHaveText('0');
  await page.locator('#roleTabs').selectOption({ label: 'Main Reviewer' });
  await page.locator('#serviceTabs').selectOption({ label: 'SST' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  fs.mkdirSync(path.join(__dirname, '../.tools'), { recursive: true });
  await page.screenshot({ path: '.tools/dashboard-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('[data-status="approval"]')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: '.tools/dashboard-mobile.png', fullPage: true });
});

test('service breakdown and company delays reconcile to saved workbook', async ({ page }) => {
  await fullRange(page);
  const scoped = rows.filter(row => row.role === 'Main' && (row.service !== 'E-Invoice' || row.invoiceType === 'Billed'));
  for (const [i, service] of ['Accounting', 'Payroll', 'E-Invoice', 'SST'].entries()) {
    const records = scoped.filter(row => row.service === service);
    const done = records.reduce((n, r) => n + r.completed, 0);
    const delay = records.reduce((n, r) => n + r.delay, 0);
    const approval = records.reduce((n, r) => n + r.waitApproval, 0);
    const rate = done + delay + approval ? (done / (done + delay + approval) * 100).toFixed(1) + '%' : '—';
    await expect(page.locator('.service-breakdown-rate').nth(i)).toHaveText(rate);
  }
  const companies = new Map();
  for (const row of scoped) if (row.delay) companies.set(row.company, (companies.get(row.company) || 0) + row.delay);
  const ranked = [...companies].sort((a,b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  await expect(page.locator('#companyDelaySummary tr')).toHaveCount(Math.min(5, ranked.length));
  await page.locator('#delayLimit').selectOption('all');
  await expect(page.locator('#companyDelaySummary tr')).toHaveCount(ranked.length);
  await expect(page.locator('#companyDelaySummary .delay-task-count')).toHaveText(ranked.map(row => String(row[1])));
  await page.locator('#breakdownMetric').selectOption('delay');
  await expect(page.locator('#serviceBreakdown .service-breakdown-row')).toHaveCount(4);
});
