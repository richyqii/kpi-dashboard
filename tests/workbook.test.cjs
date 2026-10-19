const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const XLSX = require('xlsx');
const Kpi = require('../public/kpi-workbook');
const filename = path.join(__dirname, '../data/2. 4 Main Services KPI Checklist 2025 & 2026-1.xlsx');
const workbook = XLSX.readFile(filename, { cellStyles: true, sheetStubs: true, cellDates: false });
const rows = Kpi.rowsFromWorkbook(workbook, XLSX);

test('explicit marks override color; colored blanks are approval, plain blanks are delay', () => {
  const yellow = { patternType: 'solid', fgColor: { rgb: 'FFD966' } };
  for (const v of ['✔', '✓', 'Closing', 'closing']) assert.equal(Kpi.classifyCell({ v, s: yellow }), 'completed');
  for (const v of ['-', '-----', ' - - ']) assert.equal(Kpi.classifyCell({ v, s: yellow }), 'notApplicable');
  assert.equal(Kpi.classifyCell({ s: yellow }), 'waitApproval');
  assert.equal(Kpi.classifyCell({ s: { patternType: 'solid', fgColor: { theme: 7 } } }), 'waitApproval');
  assert.equal(Kpi.classifyCell({ s: { patternType: 'solid', fgColor: { indexed: 13 } } }), 'waitApproval');
  assert.equal(Kpi.classifyCell({ s: { patternType: 'solid', fgColor: { rgb: 'FFFFFFFF' } } }), 'delay');
  assert.equal(Kpi.classifyCell({ s: { patternType: 'none' } }), 'delay');
  assert.equal(Kpi.classifyCell(undefined), 'delay');
  assert.throws(() => Kpi.classifyCell({ v: 'YS' }), /Unrecognized/);
});

test('all numbered tasks are imported once, without signatures, legends or unassigned requests', () => {
  assert.equal(rows.length, 1830);
  for (const [service, count] of Object.entries({ Accounting: 696, Payroll: 528, 'E-Invoice': 342, SST: 264 })) {
    assert.equal(rows.filter(row => row.service === service).length, count);
  }
  assert.equal(new Set(rows.map(row => `${row.sourceSheet}!${row.sourceCell}`)).size, rows.length);
  assert(rows.every(row => Kpi.statusKeys.reduce((sum, key) => sum + row[key], 0) === 1));
  assert(rows.every(row => /^(2025|2026)-(0[1-9]|1[0-2])$/.test(row.month)));
  assert(rows.every(row => row.pic !== '-'));
});

test('source-cell spot checks cover closing, dashes, dates, reviewers and yellow fills', () => {
  const at = (sheet, cell) => rows.find(row => row.sourceSheet === sheet && row.sourceCell === cell);
  assert.equal(at('1. ACC', 'E31').completed, 1);
  assert.equal(at('1. ACC', 'E31').pic, 'LING YIN');
  assert.equal(at('1. ACC', 'E32').role, 'Sub');
  assert.equal(at('1. ACC', 'E32').pic, 'IZA');
  assert.equal(at('1. ACC', 'E7').month, '2025-01');
  assert.equal(at('1. ACC', 'AB7').month, '2026-12');
  assert.equal(at('1. ACC', 'AB7').delay, 1);
  assert.equal(at('2. PAYROLL', 'C19').notApplicable, 1);
  assert.equal(at('3. E-INV', 'E9').invoiceType, 'Self-bill');
  assert.equal(at('3. E-INV', 'E9').month, '2025-07');
  assert.equal(at('4. SST', 'U7').waitApproval, 1);
  assert.equal(at('4. SST', 'U7').month, '2026-07');
  assert.equal(at('4. SST', 'C11').notApplicable, 1);
  assert.equal(rows.filter(row => row.service === 'Accounting' && row.role === 'Sub').length, 216);
  assert.equal(rows.filter(row => row.service === 'Payroll' && /e-PCB/i.test(row.company)).length, 216);
});

test('status totals and generated assets reconcile with source records', () => {
  const counts = Object.fromEntries(Kpi.statusKeys.map(key => [key, rows.reduce((sum, row) => sum + row[key], 0)]));
  assert.deepEqual(counts, { completed: 692, delay: 611, waitApproval: 16, notApplicable: 511 });
  const summary = Kpi.summarize(rows);
  for (const key of Kpi.statusKeys) assert.equal(summary.reduce((sum, row) => sum + row[key === 'delay' ? 'blank' : key], 0), counts[key]);
  const bundled = vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/dashboard-company-data.js'), 'utf8') + '\nJSON.stringify(dashboardCompanyData)');
  assert.equal(bundled, JSON.stringify(rows));
  for (const name of ['index.html', 'dashboard-company-data.js', 'dashboard-data.js', 'kpi-workbook.js']) {
    assert.equal(fs.readFileSync(path.join(__dirname, '..', name), 'utf8'), fs.readFileSync(path.join(__dirname, '../public', name), 'utf8'));
  }
});
