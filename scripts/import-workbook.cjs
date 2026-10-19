const fs = require('node:fs');
const path = require('node:path');
const XLSX = require('xlsx');
const { rowsFromWorkbook, summarize, statusKeys } = require('../public/kpi-workbook.js');
const root = path.resolve(__dirname, '..');
const source = process.argv[2] || path.join(root, 'data/2. 4 Main Services KPI Checklist 2025 & 2026-1.xlsx');
const workbook = XLSX.readFile(source, { cellStyles: true, sheetStubs: true, cellDates: false });
const rows = rowsFromWorkbook(workbook, XLSX);
if (!rows.length) throw new Error('No KPI checklist records found.');
for (const [file, name, data] of [
  ['dashboard-company-data.js', 'dashboardCompanyData', rows],
  ['dashboard-data.js', 'dashboardData', summarize(rows)]
]) {
  const content = `const ${name} = ${JSON.stringify(data)};\n`;
  fs.writeFileSync(path.join(root, file), content);
  fs.writeFileSync(path.join(root, 'public', file), content);
}
console.log(JSON.stringify({ records: rows.length, statuses: Object.fromEntries(statusKeys.map(key => [key, rows.reduce((n, row) => n + row[key], 0)])) }, null, 2));
