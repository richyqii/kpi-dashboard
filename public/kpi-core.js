/* Validation, identity reconciliation and diffs shared by Worker and browser. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./kpi-workbook.js'));
  else root.KpiCore = factory(root.KpiWorkbook);
})(typeof globalThis === 'object' ? globalThis : this, function (Kpi) {
  const services = ['Accounting', 'Payroll', 'E-Invoice', 'SST'];
  const clean = value => String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ');
  const normalized = value => clean(value).toUpperCase();
  const label = { completed: 'PIC Completed', delay: 'Delayed', waitApproval: 'Empty / Pending', notApplicable: 'Boss Completed', notDue: 'Not Yet Due' };
  const serviceName = name => /\bACC\b|ACCOUNTING/i.test(name) ? 'Accounting' : /PAYROLL/i.test(name) ? 'Payroll' : /E[- ]?INV/i.test(name) ? 'E-Invoice' : /\bSST\b/i.test(name) ? 'SST' : null;
  const monthNow = (date = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit' }).formatToParts(date).reduce((out, part) => ({ ...out, [part.type]: part.value }), {});
  function currentMonth(date) { const parts = monthNow(date); return `${parts.year}-${parts.month}`; }
  const rawStatus = row => row.waitApproval === 1 ? 'delay' : Kpi.statusKeys.find(key => row[key] === 1);
  let deadlines = {};
  function setDeadlines(value) { deadlines = { ...value }; }
  function currentDate(date = new Date()) { return new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Singapore', year:'numeric',month:'2-digit',day:'2-digit'}).format(date); }
  function effectiveStatus(row, asOf = currentDate()) {
    const status = rawStatus(row);
    if (status !== 'delay') return status;
    // A dashboard month selection is a reporting cutoff, inclusive of To.
    if (/^20\d\d-(0[1-9]|1[0-2])$/.test(asOf)) return row.month <= asOf ? 'delay' : 'notDue';
    const deadline = deadlines[row.month];
    return deadline && asOf > deadline ? 'delay' : 'notDue';
  }
  const statusLabel = (row, asOf) => row ? label[effectiveStatus(row, asOf)] : '—';
  const taskName = row => row.task || (row.service === 'E-Invoice' ? `${row.invoiceType || 'Billed'} E-Invoice` : row.service === 'Payroll' && /e[- ]?pcb/i.test(row.company) ? 'Payroll / e-PCB' : `${row.service} review`);
  const identityKey = row => JSON.stringify([row.service, normalized(row.company), taskName(row), row.role, normalized(row.pic)]);

  function validateRows(input) {
    const errors = [], seen = new Set();
    if (!Array.isArray(input) || !input.length) return { rows: [], errors: ['No monthly KPI tasks were found.'] };
    if (input.length > 6000) return { rows: [], errors: ['This workbook exceeds the 6,000 monthly task limit.'] };
    const rows = input.map(source => {
      const row = { ...source, company: clean(source.company), pic: normalized(source.pic) };
      const where = `${row.sourceSheet || row.service || 'Record'}!${row.sourceCell || row.month || '?'}`;
      if (!services.includes(row.service)) errors.push(`${where}: invalid service.`);
      if (!row.pic || row.pic.length > 100 || !/\p{L}/u.test(row.pic)) errors.push(`${where}: PIC must be a name.`);
      if (!row.company || row.company.length > 250 || row.company === '-') errors.push(`${where}: company is required (250 characters maximum).`);
      if (!['Main', 'Sub'].includes(row.role) || (row.service !== 'Accounting' && row.role !== 'Main')) errors.push(`${where}: invalid reviewer role.`);
      if (!/^20\d\d-(0[1-9]|1[0-2])$/.test(row.month)) errors.push(`${where}: invalid reporting month.`);
      if (row.service === 'E-Invoice' && !['Billed', 'Self-bill'].includes(row.invoiceType)) errors.push(`${where}: invalid E-Invoice type.`);
      if (!Kpi.statusKeys.every(key => [0, 1].includes(row[key])) || Kpi.statusKeys.reduce((n, key) => n + row[key], 0) !== 1) errors.push(`${where}: exactly one valid KPI status is required.`);
      row.task = taskName(row);
      const key = `${identityKey(row)}|${row.month}`;
      if (seen.has(key)) errors.push(`${where}: duplicate task for this PIC, company, service, role and month.`);
      seen.add(key);
      if (row.explicitId && clean(row.explicitId).length > 150) errors.push(`${where}: Task ID is too long.`);
      return row;
    });
    for (const service of services) if (!rows.some(row => row.service === service)) errors.push(`${service}: no usable monthly tasks found.`);
    return { rows, errors: [...new Set(errors)].slice(0, 100) };
  }

  function validateWorkbook(workbook, XLSX, baselineRows = []) {
    const errors = [], warnings = [], matrix = new Map();
    for (const name of workbook.SheetNames) {
      const service = serviceName(name);
      if (service) {
        if (matrix.has(service)) errors.push(`${service}: duplicate service worksheets.`);
        matrix.set(service, name);
      }
    }
    let rows = [];
    if (matrix.size) {
      for (const service of services) if (!matrix.has(service)) errors.push(`Missing ${service} worksheet.`);
      for (const [service, name] of matrix) {
        const sheet = workbook.Sheets[name];
        if (!sheet['!ref']) { errors.push(`${name}: empty worksheet.`); continue; }
        const range = XLSX.utils.decode_range(sheet['!ref']);
        if (range.e.r > 2000 || range.e.c > 120) { errors.push(`${name}: worksheet is too large.`); continue; }
        if (/SUMMARY/i.test(name)) continue;
        const value = (r, c) => sheet[XLSX.utils.encode_cell({ r, c })]?.v;
        let pic = '', months = [], idColumn = -1;
        for (let r = range.s.r; r <= range.e.r; r++) {
          if (normalized(value(r, 0)) === 'PIC') { pic = clean(value(r, 1)); months = []; idColumn = -1; }
          const header = [];
          for (let c = 2; c <= range.e.c; c++) {
            const cell = sheet[XLSX.utils.encode_cell({ r, c })];
            if (/^(TASK|RECORD) ID$/i.test(clean(cell?.v))) idColumn = c;
            const month = Kpi.headerMonth(cell, XLSX);
            if (month) header.push(month);
          }
          if (header.length) {
            months = header;
            if (new Set(header).size !== header.length) errors.push(`${name}, row ${r + 1}: duplicate month headings.`);
            for (let c = 2; c <= range.e.c; c++) {
              const cell = sheet[XLSX.utils.encode_cell({ r, c })];
              if (/m{2,}.*y|y.*m{2,}/i.test(cell?.z || '') && !Kpi.headerMonth(cell, XLSX)) errors.push(`${name}, row ${r + 1}: missing or invalid month heading in ${XLSX.utils.encode_col(c)}.`);
            }
          }
          if (!/^\d+$/.test(clean(value(r, 0)))) continue;
          if (pic === '-' && service === 'E-Invoice' && normalized(value(r, 3)) === 'NO') { warnings.push('Unassigned E-Invoice requests marked NO are excluded.'); continue; }
          if (!pic || pic === '-') errors.push(`${name}, row ${r + 1}: missing PIC assignment.`);
          if (!clean(value(r, 1))) errors.push(`${name}, row ${r + 1}: missing company.`);
          if (!months.length) errors.push(`${name}, row ${r + 1}: missing or invalid monthly headings.`);
          // Check every date-formatted header, including accidentally edited text values.
          if (idColumn >= 0 && !clean(value(r, idColumn))) warnings.push(`${name}: some tasks have no Task ID; company/task matching will be used.`);
        }
      }
      if (!errors.length) {
        try { rows = Kpi.rowsFromWorkbook(workbook, XLSX, baselineRows); }
        catch (error) { errors.push(error.message); }
      }
      // Optional stable IDs on matrix rows; main/sub reviewers need distinct IDs.
      for (const row of rows) {
        const sheet = workbook.Sheets[row.sourceSheet];
        const address = XLSX.utils.decode_cell(row.sourceCell);
        const range = XLSX.utils.decode_range(sheet['!ref']);
        for (let r = address.r - 1; r >= 0; r--) {
          if (normalized(sheet[`A${r + 1}`]?.v) === 'PIC') break;
          for (let c = 2; c <= range.e.c; c++) if (/^(TASK|RECORD) ID$/i.test(clean(sheet[XLSX.utils.encode_cell({ r, c })]?.v))) {
            const id = clean(sheet[XLSX.utils.encode_cell({ r: address.r, c })]?.v);
            if (id) row.explicitId = id;
          }
        }
      }
    } else {
      // Continue supporting the existing normalized Clean_Data format.
      const name = workbook.SheetNames.find(name => /^clean[_ ]data$/i.test(name));
      if (!name) errors.push('Missing Accounting, Payroll, E-Invoice and SST worksheets (or a complete Clean_Data sheet).');
      else {
        const sheet = workbook.Sheets[name];
        const records = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: true });
        const headers = XLSX.utils.sheet_to_json(sheet, { header: 1 })[0] || [];
        for (const field of ['Service', 'PIC', 'Company', 'Reviewer Type', 'Month', 'Raw Status']) if (!headers.includes(field)) errors.push(`Clean_Data: missing ${field} column.`);
        records.forEach((record, index) => {
          const service = services.find(service => normalized(service) === normalized(record.Service));
          const role = clean(record['Reviewer Type']);
          const invoiceType = /self/i.test(`${record['Invoice Type']} ${record.Company}`) ? 'Self-bill' : 'Billed';
          const cell = sheet[XLSX.utils.encode_cell({ r: index + 1, c: headers.indexOf('Raw Status') })];
          let status;
          try {
            status = Kpi.classifyCell(cell);

          } catch (error) { errors.push(`Clean_Data, row ${index + 2}: ${error.message}`); return; }
          const month = /^20\d\d-(0[1-9]|1[0-2])$/.test(clean(record.Month)) ? clean(record.Month) : Kpi.headerMonth({ v: record.Month }, XLSX);
          const row = { service, pic: clean(record.Reviewer || record.PIC), company: clean(record.Company).replace(/\s+self[- ]billed?$/i, ''), role: /^sub$/i.test(role) ? 'Sub' : /^main$/i.test(role) ? 'Main' : role, month,
            completed: 0, delay: 0, waitApproval: 0, notApplicable: 0, sourceSheet: name, sourceCell: `A${index + 2}` };
          if (service === 'E-Invoice') row.invoiceType = invoiceType;
          if (record['Task ID'] || record['Record ID']) row.explicitId = clean(record['Task ID'] || record['Record ID']);
          row[status] = 1;
          rows.push(row);
        });
      }
    }
    const result = validateRows(rows);
    if (!result.errors.length) { try { assignments(result.rows); } catch (error) { errors.push(error.message); } }
    return { rows: result.rows, errors: [...errors, ...result.errors].slice(0, 100), warnings: [...new Set(warnings)], services: [...matrix.keys()] };
  }

  function assignments(rows) {
    const groups = new Map();
    for (const row of rows) {
      const key = row.assignmentId || (row.explicitId ? `id:${row.explicitId}` : identityKey(row));
      if (!groups.has(key)) groups.set(key, { key, ...row, rows: [] });
      const group = groups.get(key);
      if (identityKey(group) !== identityKey(row)) throw new Error(`Task ID ${key} is assigned to conflicting PIC, company or role values.`);
      if (group.rows.some(other => other.month === row.month)) throw new Error(`Duplicate month for Task ID ${key}.`);
      group.rows.push(row);
    }
    return [...groups.values()];
  }

  function compare(oldRows, input, mappings = {}, asOf = currentDate()) {
    const previous = assignments(oldRows || []), incoming = assignments(input);
    const used = new Set(), matches = new Map();
    const match = (next, old) => { if (used.has(old.key)) throw new Error('A previous task cannot be matched twice.'); matches.set(next.key, old); used.add(old.key); };
    for (const next of incoming) {
      const explicit = previous.find(old => (next.assignmentId && old.assignmentId === next.assignmentId) || (next.explicitId && old.explicitId === next.explicitId));
      if (explicit) match(next, explicit);
    }
    for (const next of incoming.filter(next => !matches.has(next.key))) {
      const exact = previous.filter(old => !used.has(old.key) && identityKey(old) === identityKey(next));
      if (exact.length === 1) match(next, exact[0]);
    }
    // Only unambiguous same-company task moves are inferred. Never guess a rename.
    for (const next of incoming.filter(next => !matches.has(next.key))) {
      const sameTask = row => row.service === next.service && normalized(row.company) === normalized(next.company) && taskName(row) === taskName(next);
      const candidates = previous.filter(old => !used.has(old.key) && sameTask(old));
      const competing = incoming.filter(other => !matches.has(other.key) && sameTask(other));
      if (candidates.length === 1 && competing.length === 1) match(next, candidates[0]);
    }
    for (const [newKey, oldKey] of Object.entries(mappings)) {
      if (!oldKey) continue;
      const next = incoming.find(row => row.key === newKey), old = previous.find(row => row.key === oldKey);
      if (!next || !old || matches.has(newKey) || old.service !== next.service || taskName(old) !== taskName(next)) throw new Error('Invalid reassignment match. Match one previous task within the same service and task type.');
      match(next, old);
    }
    const unmatchedOld = previous.filter(old => !used.has(old.key));
    const unmatchedNew = incoming.filter(next => !matches.has(next.key));
    const mappingOptions = unmatchedNew.map(next => ({ key: next.key, company: next.company, pic: next.pic, role: next.role, service: next.service, task: taskName(next), options: unmatchedOld.filter(old => old.service === next.service && taskName(old) === taskName(next)).map(old => ({ key: old.key, company: old.company, pic: old.pic, role: old.role })) })).filter(next => next.options.length);
    const changes = [], output = [];
    const add = (category, kind, old, next, id) => changes.push({ category, kind, recordId: `${id}|${(next || old).month}`, old: compact(old), next: compact(next) });
    const compact = row => row ? { pic: row.pic, company: row.company, service: row.service, role: row.role, month: row.month, task: taskName(row), status: rawStatus(row), displayStatus: statusLabel(row, asOf) } : null;
    for (const next of incoming) {
      const old = matches.get(next.key);
      const id = old?.assignmentId || old?.key || next.assignmentId || (next.explicitId ? `id:${next.explicitId}` : `task:${identityKey(next)}`);
      for (const row of next.rows) output.push({ ...row, task: taskName(row), assignmentId: id });
      if (!old) { if (oldRows?.length) next.rows.forEach(row => add('Assignment Changes', 'Task added', null, row, id)); continue; }
      const assignmentChanged = identityKey(old) !== identityKey(next);
      for (const row of next.rows) {
        const before = old.rows.find(other => other.month === row.month);
        if (!before) add('Monthly Updates', 'Month added', null, row, id);
        else {
          if (assignmentChanged) add('Assignment Changes', 'Reassigned task', before, row, id);
          if (rawStatus(before) !== rawStatus(row)) add('Status Changes', 'Status changed', before, row, id);
        }
      }
      for (const row of old.rows) if (!next.rows.some(other => other.month === row.month)) add('Monthly Updates', 'Month removed', row, null, id);
    }
    for (const old of unmatchedOld) old.rows.forEach(row => add('Assignment Changes', 'Task removed', row, null, old.assignmentId || old.key));
    changes.sort((a, b) => JSON.stringify([a.category, (a.next || a.old).service, (a.next || a.old).company, (a.next || a.old).month]).localeCompare(JSON.stringify([b.category, (b.next || b.old).service, (b.next || b.old).company, (b.next || b.old).month])));
    return { rows: output, changes, mappingOptions, firstImport: !oldRows?.length, counts: Object.fromEntries(['Status Changes', 'Assignment Changes', 'Monthly Updates'].map(category => [category, changes.filter(change => change.category === category).length])), changedRecords: new Set(changes.map(change => change.recordId)).size };
  }
  return { setDeadlines, currentDate, services, clean, label, rawStatus, statusLabel, effectiveStatus, currentMonth, taskName, identityKey, validateRows, validateWorkbook, compare };
});
