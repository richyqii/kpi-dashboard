const { test } = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const Core = require('../public/kpi-core');
const oldFile = 'data/KPI Checklist for Closing Year 2026.xlsx';
const newFile = 'data/2. 4 Main Services KPI Checklist 2025 & 2026-1.xlsx';
const read = file => XLSX.readFile(file, { cellStyles: true, sheetStubs: true });
const old = Core.validateWorkbook(read(oldFile), XLSX);
const next = Core.validateWorkbook(read(newFile), XLSX);
const sample = overrides => ({ service: 'Accounting', company: 'ACME SDN BHD', pic: 'ALICE', role: 'Main', month: '2026-01', completed: 0, delay: 1, waitApproval: 0, notApplicable: 0, ...overrides });

test('both supplied workbooks validate, and the live file is the selected initial baseline', () => {
  assert.deepEqual(old.errors, []); assert.deepEqual(next.errors, []);
  assert.equal(old.rows.length, 1482); assert.equal(next.rows.length, 1830);
  assert.equal(require('../data/baseline.json').fileName, newFile.slice(5));
  assert.equal(Core.compare(null, next.rows).changes.length, 0);
  assert.equal(Core.compare(null, next.rows).firstImport, true);
  const result = Core.compare(Core.compare(null, old.rows).rows, next.rows);
  assert.deepEqual(result.counts, { 'Status Changes': 265, 'Assignment Changes': 540, 'Monthly Updates': 0 });
  assert.equal(result.changedRecords, 799);
});
test('row order, cell addresses, whitespace and tick-versus-Closing never create false changes', () => {
  const initial = Core.compare(null, next.rows).rows;
  const reordered = next.rows.slice().reverse().map(row => ({ ...row, sourceCell: 'Z999', sourceSheet: 'renamed source' }));
  assert.equal(Core.compare(initial, reordered).changes.length, 0);
});
test('PIC and role moves retain stable task identity; status and monthly changes are separate', () => {
  const initial = Core.compare(null, [sample({})]).rows;
  const result = Core.compare(initial, [sample({ pic: 'BOB', role: 'Sub', delay: 0, completed: 1 }), sample({ pic: 'BOB', role: 'Sub', month: '2026-02' })]);
  assert.equal(result.rows[0].assignmentId, initial[0].assignmentId);
  assert.deepEqual(result.counts, { 'Status Changes': 1, 'Assignment Changes': 1, 'Monthly Updates': 1 });
  assert.equal(result.changes.find(change => change.category === 'Assignment Changes').old.pic, 'ALICE');
});
test('company changes use explicit stable IDs or an administrator match, never row numbers', () => {
  const initial = Core.compare(null, [sample({ explicitId: 'account-001' })]).rows;
  const renamed = Core.compare(initial, [sample({ explicitId: 'account-001', company: 'RENAMED SDN BHD' })]);
  assert.equal(renamed.counts['Assignment Changes'], 1);
  const legacy = Core.compare(null, [sample({})]).rows;
  const input = [sample({ company: 'RENAMED SDN BHD' })];
  const preview = Core.compare(legacy, input);
  assert.equal(preview.counts['Assignment Changes'], 2);
  const candidate = preview.mappingOptions[0];
  const matched = Core.compare(legacy, input, { [candidate.key]: candidate.options[0].key });
  assert.equal(matched.counts['Assignment Changes'], 1);
  assert.equal(matched.rows[0].assignmentId, legacy[0].assignmentId);
});
test('future blanks stay not due in Singapore, without manufacturing upload changes', () => {
  const row = sample({ month: '2026-10' });
  assert.equal(Core.effectiveStatus(row, '2026-10'), 'notDue');
  assert.equal(Core.effectiveStatus(row, '2026-09'), 'notDue');
  assert.equal(Core.effectiveStatus(row, '2026-11'), 'delay');
  assert.equal(Core.currentMonth(new Date('2026-10-31T16:00:00Z')), '2026-11');
  assert.equal(Core.compare([row], [row], {}, '2026-11').changes.length, 0);
});
test('missing sheets, invalid months, unknown status, missing company and duplicate tasks are rejected', () => {
  const missing = read(newFile); missing.SheetNames = missing.SheetNames.filter(name => name !== '4. SST');
  assert(Core.validateWorkbook(missing, XLSX).errors.some(error => error.includes('Missing SST')));
  const invalid = read(newFile); invalid.Sheets['1. ACC'].E6.v = 'not-a-month';
  assert(Core.validateWorkbook(invalid, XLSX).errors.some(error => error.includes('invalid month heading')));
  const status = read(newFile); status.Sheets['1. ACC'].E7.v = 'maybe';
  assert(Core.validateWorkbook(status, XLSX).errors.some(error => error.includes('Unrecognized task status')));
  const company = read(newFile); company.Sheets['1. ACC'].B7.v = '';
  assert(Core.validateWorkbook(company, XLSX).errors.some(error => error.includes('missing company')));
  assert(Core.validateRows([...next.rows, next.rows[0]]).errors.some(error => error.includes('duplicate task')));
  const conflicting = next.rows.map(row => ({ ...row, explicitId: 'same-id' }));
  assert.throws(() => Core.compare(null, conflicting), /conflicting/);
});
