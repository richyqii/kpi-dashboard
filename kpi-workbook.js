/* Shared by browser uploads and the bundled-data importer. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.KpiWorkbook = api;
})(typeof globalThis === "object" ? globalThis : this, function () {
  const text = value => String(value == null ? "" : value).trim().replace(/\s+/g, " ");
  const statusKeys = ["completed", "delay", "waitApproval", "notApplicable"];

  function hasColor(cell) {
    const fill = cell && cell.s && (cell.s.fill || cell.s);
    if (!fill || !fill.patternType || fill.patternType === "none") return false;
    const color = fill.fgColor;
    if (!color || color.auto) return false;
    if (color.rgb) return color.rgb.slice(-6).toUpperCase() !== "FFFFFF";
    if (color.indexed != null) return ![9, 64, 65].includes(color.indexed);
    if (color.theme != null) return !(color.theme === 0 && !color.tint);
    return false;
  }

  function classifyCell(cell) {
    const value = text(cell && cell.v);
    // Explicit marks take precedence over a cell's background color.
    if (/^[✔✓☑](?:\uFE0F)?$/.test(value) || /^closing$/i.test(value)) return "completed";
    if (/^[-–—\s]+$/.test(value)) return "notApplicable";
    if (hasColor(cell)) return "waitApproval";
    if (!value) return "delay";
    throw new Error(`Unrecognized task status: ${value}`);
  }

  function headerMonth(cell, XLSX) {
    if (!cell) return null;
    if (typeof cell.v === "number" && cell.v > 40000 && cell.v < 80000) {
      const date = XLSX.SSF.parse_date_code(cell.v);
      return `${date.y}-${String(date.m).padStart(2, "0")}`;
    }
    // Formatted month labels also avoid timezone changes to Excel date cells.
    const label = text(typeof cell.v === "string" ? cell.v : cell.w || cell.v);
    const match = label.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[- ](\d{2}|\d{4})$/i);
    if (!match) return null;
    const month = "jan feb mar apr may jun jul aug sep oct nov dec".split(" ").indexOf(match[1].toLowerCase()) + 1;
    return `${match[2].length === 2 ? "20" : ""}${match[2]}-${String(month).padStart(2, "0")}`;
  }

  function rowsFromWorkbook(workbook, XLSX) {
    const rows = [];
    for (const sheetName of workbook.SheetNames) {
      const service = /\bACC\b|ACCOUNTING/i.test(sheetName) ? "Accounting"
        : /PAYROLL/i.test(sheetName) ? "Payroll"
        : /E[- ]?INV/i.test(sheetName) ? "E-Invoice"
        : /\bSST\b/i.test(sheetName) ? "SST" : null;
      if (!service) continue;
      const sheet = workbook.Sheets[sheetName];
      if (!sheet["!ref"]) continue;
      const range = XLSX.utils.decode_range(sheet["!ref"]);
      let pic = "", months = [];
      const cellAt = (r, c) => sheet[XLSX.utils.encode_cell({ r, c })];
      const valueAt = (r, c) => text(cellAt(r, c)?.v);
      for (let r = range.s.r; r <= range.e.r; r++) {
        if (valueAt(r, 0).toUpperCase() === "PIC") {
          pic = valueAt(r, 1).toUpperCase();
          months = [];
          continue;
        }
        const header = [];
        for (let c = 2; c <= range.e.c; c++) {
          const month = headerMonth(cellAt(r, c), XLSX);
          if (month) header.push({ c, month });
        }
        if (header.length) { months = header; continue; }
        // A numbered company row is a task; the following signature row is not.
        if (!pic || pic === "-" || !months.length || !/^\d+$/.test(valueAt(r, 0)) || !valueAt(r, 1)) continue;
        const rawCompany = valueAt(r, 1);
        const invoiceType = /self[- ]bill/i.test(rawCompany) ? "Self-bill" : "Billed";
        const company = service === "E-Invoice" ? text(rawCompany.replace(/self[- ]billed?/i, "")) : rawCompany;
        const reviewers = service === "Accounting"
          ? [{ role: "Main", pic: valueAt(r, 3).toUpperCase() || pic, r }]
          : [{ role: "Main", pic, r }];
        const subReviewer = valueAt(r + 1, 3).toUpperCase();
        if (service === "Accounting" && subReviewer && !valueAt(r + 1, 0)) {
          reviewers.push({ role: "Sub", pic: subReviewer, r: r + 1 });
        }
        for (const reviewer of reviewers) {
          for (const { c, month } of months) {
            const sourceCell = XLSX.utils.encode_cell({ r: reviewer.r, c });
            let status;
            try { status = classifyCell(cellAt(reviewer.r, c)); }
            catch (error) { throw new Error(`${sheetName}!${sourceCell}: ${error.message}`); }
            const row = { service, pic: reviewer.pic, role: reviewer.role, company, month,
              completed: 0, delay: 0, waitApproval: 0, notApplicable: 0,
              sourceSheet: sheetName, sourceCell };
            if (service === "E-Invoice") row.invoiceType = invoiceType;
            row[status] = 1;
            rows.push(row);
          }
        }
      }
    }
    return rows;
  }

  function summarize(rows) {
    const groups = new Map();
    for (const row of rows) {
      const key = JSON.stringify([row.service, row.pic, row.role, row.invoiceType, row.month]);
      if (!groups.has(key)) {
        const group = { service: row.service, pic: row.pic, role: row.role, month: row.month,
          completed: 0, blank: 0, hyphen: 0, waitApproval: 0, notApplicable: 0, companies: new Set() };
        if (row.invoiceType) group.invoiceType = row.invoiceType;
        groups.set(key, group);
      }
      const group = groups.get(key);
      for (const key of statusKeys) group[key === "delay" ? "blank" : key] += row[key] || 0;
      group.companies.add(row.company);
    }
    return [...groups.values()].map(row => ({ ...row, companies: row.companies.size }));
  }
  return { classifyCell, hasColor, headerMonth, rowsFromWorkbook, summarize, statusKeys };
});
