(function () {
  const $ = id => document.getElementById(id);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const dialog = $('uploadWorkflow');
  let activeVersion = null, draft = null, file = null, busy = false, committing = false, ready = false, requestGeneration = 0, currentChanges = [];
  let historyRequest = null;
  const steps = ['Confirm Upload', 'Validating Document', 'KPI Changes Detected', 'Update Successful'];
  async function api(path, options = {}) {
    const response = await fetch('/api/' + path, { ...options, headers: { ...(options.body && typeof options.body === 'string' ? { 'Content-Type': 'application/json' } : {}), ...options.headers }, cache: 'no-store' });
    let data;
    try { data = await response.json(); } catch { throw new Error('The shared dashboard service is unavailable. Please retry.'); }
    if (!response.ok) throw Object.assign(new Error(data.error || 'Request failed.'), { details: data.details, status: response.status });
    return data;
  }
  function showError(error) {
    $('workflowError').hidden = false;
    $('workflowError').innerHTML = `<strong>${escape(error.message)}</strong>${error.details?.length ? `<ul>${error.details.map(item => `<li>${escape(item)}</li>`).join('')}</ul>` : ''}`;
  }
  function screen(stage, title, message, content = '', actions = []) {
    $('workflowError').hidden = true;
    $('workflowSteps').hidden = !stage;
    $('workflowSteps').innerHTML = steps.map((label, index) => `<li class="${stage === index + 1 ? 'current' : ''}" ${stage === index + 1 ? 'aria-current="step"' : ''}>${index + 1}. ${label}</li>`).join('');
    $('workflowTitle').textContent = title;
    $('workflowMessage').textContent = message;
    $('workflowBody').innerHTML = content;
    $('workflowFooter').replaceChildren();
    for (const action of actions) {
      const button = document.createElement('button');
      button.type = 'button'; button.textContent = action.label; button.className = 'workflow-button' + (action.primary ? ' primary' : '');
      if (action.id) button.id = action.id;
      button.addEventListener('click', () => Promise.resolve(action.run()).catch(showError));
      $('workflowFooter').append(button);
    }
    if (!dialog.open) dialog.showModal();
    dialog.scrollTop = 0;
  }
  function setReady(value) {
    ready = value;
    $('excelUpload').disabled = !value;
    document.querySelector('label[for="excelUpload"]').classList.toggle('disabled', !value);
    $('versionHistory').disabled = false;
  }
  function showVersionMeta(version) {
    const saved = version ? new Date(version.createdAt).toLocaleString('en-GB', { timeZone: 'Asia/Singapore', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }) : '';
    $('lastUpdated').textContent = version ? `Last updated: ${saved}` : 'No saved version';
    $('fileVersionMeta').textContent = version ? `Saved: ${saved} (Singapore)` : 'Upload a document to create the first baseline.';
    $('activeFileBadge').hidden = !version;
  }
  async function loadCurrent() {
    const data = await api('current');

    activeVersion = data.version;
    showVersionMeta(activeVersion);
    window.KpiDashboard.apply(data.rows, data.version?.fileName || 'No baseline yet');
    $('uploadStatus').textContent = data.version ? '' : 'No baseline yet. The first approved file will create it.';
    return data;
  }
  async function close() {
    if (committing) return;
    requestGeneration++;
    if (draft?.id) api('drafts/' + encodeURIComponent(draft.id), { method: 'DELETE' }).catch(() => {});
    draft = null; file = null; busy = false; $('excelUpload').value = '';
    dialog.close();
  }
  const cancel = { label: 'Cancel', run: close };
  function countsHTML(result) {
    return `<div class="workflow-summary">${Object.entries(result.counts || {}).filter(([, count]) => count > 0).map(([name, count]) => `<div>${escape(name)}<strong>${count}</strong></div>`).join('')}</div>`;
  }
  function simpleSummary(result) {
    const descriptions = {
      'Status Changes': 'Updates to PIC completion, boss completion or empty tasks.',
      'Assignment Changes': 'Changes to PIC, company or role, including added and removed tasks.',
      'Monthly Updates': 'A month’s record was added or removed for an existing task.'
    };
    const status = row => escape(row?.displayStatus || KpiCore.label[row?.status] || '—');
    const cards = Object.entries(descriptions).map(([category, description]) => {
      const items = result.changes.filter(change => change.category === category);
      if (!items.length) return '';
      const example = items.find(change => change.old && change.next) || items[0];
      let detail = '<p class="workflow-note">No changes in this category.</p>';
      if (example) {
        const row = example.next || example.old;
        let changeText = escape(example.kind);
        if (category === 'Status Changes') changeText = `<span class="change-status ${escape(example.old.status)}">${status(example.old)}</span> → <span class="change-status ${escape(example.next.status)}">${status(example.next)}</span>`;
        else if (example.old && example.next) changeText = ['pic', 'company', 'service', 'role'].filter(key => example.old[key] !== example.next[key]).map(key => `${{ pic: 'PIC', company: 'Company', service: 'Service', role: 'Role' }[key]}: ${escape(example.old[key])} → <strong>${escape(example.next[key])}</strong>`).join('<br>');
        detail = `<div class="change-example"><p class="workflow-note">Example: ${escape(row.company)} · ${escape(row.service)} · ${escape(row.month)}</p><p>${escape(row.pic)} · ${escape(row.role)} Reviewer</p><p>${changeText}</p></div>`;
      }
      return `<article class="change-card"><h4>${escape(category)}<span>${items.length}</span></h4><p class="workflow-note">${description}</p>${detail}</article>`;
    }).join('');
    return `<div class="change-total"><strong>${result.changedRecords}</strong><span>Monthly records affected</span></div><h3 class="change-summary-title">Changes Summary</h3><div class="change-cards">${cards}</div>`;
  }
  function changeTable(changes) {
    currentChanges = changes;
    const groups = ['Status Changes', 'Assignment Changes', 'Monthly Updates'].filter(name => changes.some(change => change.category === name));
    return `<div class="workflow-tools"><label>Search changes<input id="changeSearch" class="workflow-input" type="search" placeholder="PIC, company, service, month or status"></label><label>Change group<select id="changeGroup" class="workflow-input"><option value="">All groups</option>${groups.map(name => `<option>${name}</option>`).join('')}</select></label></div><p id="changeCount" class="workflow-note" aria-live="polite"></p><div class="workflow-table-wrap"><table class="workflow-table"><thead><tr>${['Change', 'PIC', 'Company', 'Service', 'Role', 'Month', 'Task', 'Old status', 'New status'].map(name => `<th scope="col">${name}</th>`).join('')}</tr></thead><tbody id="changeRows"></tbody></table></div>`;
  }
  function renderChanges() {
    const search = $('changeSearch').value.toLowerCase(), category = $('changeGroup').value;
    const filtered = currentChanges.filter(change => (!category || change.category === category) && JSON.stringify(change).toLowerCase().includes(search));
    $('changeCount').textContent = `${filtered.length} of ${currentChanges.length} changes. Old assignments are shown below changed values.`;
    let previous = '';
    $('changeRows').innerHTML = filtered.map(change => {
      const group = previous !== change.category ? `<tr class="group-row"><th colspan="9">${escape(change.category)}</th></tr>` : '';
      previous = change.category;
      const row = change.next || change.old;
      const cells = ['pic', 'company', 'service', 'role', 'month', 'task'].map(key => `<td>${escape(row[key])}${change.old && change.next && change.old[key] !== change.next[key] ? `<span class="old-value">Previously: ${escape(change.old[key])}</span>` : ''}</td>`).join('');
      const status = value => value ? (value.displayStatus || KpiCore.label[value.status]) : '—';
      return `${group}<tr><td>${escape(change.kind)}</td>${cells}<td>${escape(status(change.old))}</td><td>${escape(status(change.next))}</td></tr>`;
    }).join('') || '<tr><td colspan="9" class="workflow-empty">No matching changes.</td></tr>';
  }
  function bindTable() {
    $('changeSearch').addEventListener('input', renderChanges);
    $('changeGroup').addEventListener('change', renderChanges);
    renderChanges();
  }
  function review() {
    busy = false;
    const initial = draft.firstImport, noChanges = !initial && !draft.changes.length && draft.kind !== 'selection';
    let content = `<p class="workflow-note">${escape(draft.fileName)}${draft.kind === 'rollback' ? ' · Restoring an earlier version; history will be retained.' : ''}</p>`;
    if (draft.kind === 'selection' && !draft.changes.length) content += '<p>No KPI differences were found. You can still confirm this saved file as the baseline.</p>';
    if (initial) content += '<p>This is the first import. No previous file exists, so no changes are reported. Approval will create the initial baseline.</p>';
    else if (noChanges) content += '<p>The selected file matches the saved baseline. No data or version history will be changed.</p>';
    else content += simpleSummary(draft);
    if (!initial && !noChanges) content += '<details id="changeDetails" class="change-details"><summary>View Details</summary><p class="workflow-note">Full change list and optional assignment matching. A monthly record may appear in more than one category.</p>';
    if (draft.warnings?.length) content += `<ul class="workflow-note">${draft.warnings.map(warning => `<li>${escape(warning)}</li>`).join('')}</ul>`;
    if (draft.mappingOptions?.length) content += `<details class="workflow-mappings"><summary>Link renamed or reassigned companies (${draft.mappingOptions.length})</summary><p class="workflow-note">This file has no matching permanent task ID for these tasks. If a company was renamed or moved, select its previous task. Otherwise leave it as a new task. Excel row numbers are never used as identities.</p>${draft.mappingOptions.map((mapping, i) => `<label class="workflow-mapping">${escape(`${mapping.service} · ${mapping.company} · ${mapping.pic} · ${mapping.role}`)}<select class="workflow-input assignment-match" data-index="${i}"><option value="">Keep as a new task</option>${mapping.options.map((old, j) => `<option value="${j}">${escape(`${old.company} · ${old.pic} · ${old.role}`)}</option>`).join('')}</select></label>`).join('')}<button type="button" id="applyMatches" class="workflow-button">Recalculate matches</button></details>`;
    if (!initial && !noChanges) content += changeTable(draft.changes) + '</details>';
    screen(3, noChanges ? 'No Changes Detected' : 'KPI Changes Detected', noChanges ? 'The saved baseline is unchanged.' : initial ? 'Ready to create the initial baseline.' : 'Document validated successfully. No changes have been applied yet.', content, [cancel, ...(!noChanges ? [{ label: 'Update Successful', primary: true, id: 'approveUpdate', run: commit }] : [])]);
    if (!initial && !noChanges) bindTable();
    $('applyMatches')?.addEventListener('click', async event => {
      event.target.disabled = true;
      busy = true;
      const generation = ++requestGeneration;
      $('workflowFooter').querySelectorAll('button').forEach(button => button.disabled = true);
      try {
        const mappings = { ...(draft.matchMappings || {}) };
        document.querySelectorAll('.assignment-match').forEach(select => {
          if (select.value === '') return;
          const mapping = draft.mappingOptions[Number(select.dataset.index)];
          mappings[mapping.key] = mapping.options[Number(select.value)].key;
        });
        const updated = await api('match', { method: 'POST', body: JSON.stringify({ draftId: draft.id, mappings }) });
        if (generation !== requestGeneration) return;
        draft = { ...draft, ...updated, matchMappings: mappings }; review();
      } catch (error) {
        if (generation !== requestGeneration) return;
        busy = false; showError(error); event.target.disabled = false;
        $('workflowFooter').querySelectorAll('button').forEach(button => button.disabled = false);
      }
    });
  }
  async function validate() {
    if (busy) return;
    busy = true;
    const generation = ++requestGeneration;
    screen(2, 'Validating Document', 'Checking KPI worksheets, monthly statuses, PIC assignments and company records…', '<p role="status"><span class="workflow-spinner" aria-hidden="true"></span>Validating the document and comparing it with the saved baseline.</p><p class="workflow-note">The saved data will not change during validation.</p>', [cancel]);
    try {
      const result = await api('preview', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name), 'X-Baseline-Id': activeVersion?.id || '' }, body: file });
      if (generation !== requestGeneration) { api('drafts/' + result.id, { method: 'DELETE' }).catch(() => {}); return; }
      draft = result;
      review();
    } catch (error) {
      if (generation !== requestGeneration) return;
      busy = false;
      screen(2, 'Validation Failed', 'The saved baseline has not been changed.', '<p class="workflow-note">Correct the document and select it again.</p>', [{ label: 'Close', run: close }]);
      showError(error);
      if (error.status === 409) await loadCurrent();
    }
  }
  async function commit() {
    if (committing || busy || !draft) return;
    committing = true;
    dialog.querySelectorAll('button, input, select').forEach(control => control.disabled = true);
    $('workflowMessage').textContent = 'Saving the approved version…';
    try {
      const result = await api('commit', { method: 'POST', body: JSON.stringify({ draftId: draft.id, approved: true }) });
      if (result.noChanges) { committing = false; review(); return; }
      activeVersion = result.version;
      showVersionMeta(activeVersion);
      window.KpiDashboard.apply(result.rows, result.version.fileName);
      $('uploadStatus').textContent = 'The KPI Dashboard has been updated successfully. This file is now the shared baseline.';
      const changes = result.changes, version = result.version;
      draft = null; file = null; $('excelUpload').value = ''; committing = false;
      screen(4, 'Update Successful', 'The KPI Dashboard has been updated successfully.', `<p class="workflow-success">${version.kind === 'rollback' ? 'Rollback saved as a new version.' : 'The approved file is now the shared baseline.'}</p><p>${escape(version.fileName)}</p>${countsHTML(version.summary)}<p class="workflow-note">${version.summary.records} monthly tasks saved. Overall Status Chart and Monthly Status Trend have been refreshed.</p>`, [{ label: 'View Changes', run: () => viewChanges(version, changes) }, { label: 'Done', primary: true, run: close }]);
    } catch (error) {
      committing = false;
      $('workflowFooter').querySelectorAll('button').forEach(button => button.disabled = false);
      $('workflowMessage').textContent = 'The update could not be confirmed. Retry safely or close and refresh the saved version.';
      $('workflowBody').querySelectorAll('button, input, select').forEach(control => control.disabled = false);
      showError(error);
    }
  }
  function viewChanges(version, changes) {
    screen(0, 'View Changes', version.fileName, changes.length ? countsHTML(version.summary) + changeTable(changes) : !version.summary.firstImport ? '<p>No KPI differences were found for this update.</p>' : '<p>This version created the initial baseline. There was no previous file to compare.</p>', [{ label: 'Version History', run: history }, { label: 'Close', run: close }]);
    if (changes.length) bindTable();
  }
  async function history() {
    const generation = ++requestGeneration;
    screen(0, 'Version History', 'Loading saved versions…', '<p role="status"><span class="workflow-spinner" aria-hidden="true"></span>Fetching version history.</p>', [{ label: 'Close', run: close }]);
    try {
      if (!historyRequest) historyRequest = api('versions', { signal: AbortSignal.timeout(15000) }).finally(() => { historyRequest = null; });
      const data = await historyRequest;
      if (generation !== requestGeneration || !dialog.open) return;
      renderHistory(data);
    } catch (error) {
      if (generation !== requestGeneration || !dialog.open) return;
      screen(0, 'Version History', 'Version history could not be loaded.', '', [{ label: 'Retry', run: history }, { label: 'Close', run: close }]);
      showError(error);
    }
  }
  function renderHistory(data) {
    screen(0, 'Version History', 'Use This Version validates the saved document and shows its changes. Click Update Successful after reviewing to apply it as the shared baseline.', `<div class="workflow-history">${data.versions.map((version, index) => `<article class="workflow-version"><div><strong>${escape(version.fileName)}</strong><p class="workflow-note">${escape(new Date(version.createdAt).toLocaleString('en-GB', { timeZone: 'Asia/Singapore' }))} (Singapore) · ${escape(version.kind)} · ${version.summary.records} tasks${version.id === data.currentId ? ' · Current baseline' : ''}</p></div><div class="workflow-version-actions">${version.id !== data.currentId ? `<button type="button" class="workflow-button history-restore" data-index="${index}">Use This Version</button>` : ''}</div></article>`).join('') || '<p>No approved versions yet.</p>'}</div>`, [{ label: 'Close', run: close }]);
    document.querySelectorAll('.workflow-version-actions').forEach((actions, index) => {
      const version = data.versions[index];
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'workflow-button history-remove'; button.textContent = 'Remove';
      button.disabled = version.id === data.currentId;
      if (button.disabled) {
        const note = document.createElement('p');
        note.className = 'workflow-note'; note.textContent = 'Use another version before removing this baseline.';
        actions.append(note);
      }
      button.addEventListener('click', () => confirmRemove(version));
      actions.append(button);
    });
    document.querySelectorAll('.history-restore').forEach(button => button.addEventListener('click', () => validateVersion(data.versions[button.dataset.index], data.currentId)));
  }
  async function validateVersion(version, baselineId, applyAfterValidation = false) {
    if (busy) return;
    busy = true; draft = null;
    const generation = ++requestGeneration;
    screen(2, 'Validating Document', 'Checking Accounting, Payroll, E-Invoice and SST records, monthly statuses, PIC assignments and company records…', '<p role="status"><span class="workflow-spinner" aria-hidden="true"></span>Validating the saved document and comparing it with the current baseline.</p><p>' + escape(version.fileName) + '</p>', [cancel]);
    try {
      const result = await api('rollback-preview', { method: 'POST', body: JSON.stringify({ versionId: version.id, expectedVersionId: baselineId }) });
      if (generation !== requestGeneration) { api('drafts/' + result.id, { method: 'DELETE' }).catch(() => {}); return; }
      draft = result;
      if (applyAfterValidation) { busy = false; await commit(); }
      else review();
    } catch (error) {
      if (generation !== requestGeneration) return;
      busy = false;
      screen(2, 'Validation Failed', 'The saved baseline has not been changed.', '', [{ label: 'Version History', run: history }, { label: 'Close', run: close }]);
      showError(error);
    }
  }

  function confirmRemove(version) {
    screen(0, 'Confirm Remove', 'Do you want to delete this document from Version History?',
      `<p><strong>${escape(version.fileName)}</strong></p><p class="workflow-note">Saved ${escape(new Date(version.createdAt).toLocaleString('en-GB', { timeZone: 'Asia/Singapore' }))} (Singapore).</p><p>This saved version will be permanently removed for everyone. The current dashboard baseline will stay unchanged.</p>`,
      [{ label: 'Cancel', run: history }, { label: 'Delete Document', run: async () => {
        if (committing) return;
        committing = true;
        $('workflowFooter').querySelectorAll('button').forEach(button => button.disabled = true);
        $('workflowMessage').textContent = 'Removing the document...';
        try {
          await api('versions/' + encodeURIComponent(version.id), { method: 'DELETE', body: JSON.stringify({ confirmed: true }) });
          committing = false;
          await history();
          $('workflowMessage').textContent = 'Document removed successfully. The current baseline is unchanged.';
        } catch (error) {
          committing = false;
          $('workflowFooter').querySelectorAll('button').forEach(button => button.disabled = false);
          $('workflowMessage').textContent = 'Removal could not be confirmed. Retry or return to Version History.';
          showError(error);
        }
      } }]);
  }
  const filenameKey = name => String(name).normalize('NFKC').trim().toLowerCase();
  function sameNamePrompt() {
    screen(1, 'File Name Already Exists', 'Do you want to use the newly uploaded file?',
      '<p><strong>' + escape(file.name) + '</strong></p><p>A file with this name already exists in Version History. The newly uploaded file will be validated and compared with the current baseline. Review its changes before applying the update.</p>',
      [cancel, { label: 'Use Uploaded File', primary: true, run: validate }]);
  }
  async function checkUploadName() {
    const generation = ++requestGeneration;
    if (activeVersion && filenameKey(activeVersion.fileName) === filenameKey(file.name)) {
      sameNamePrompt(activeVersion, activeVersion.id);
      return;
    }
    screen(1, 'Confirm Upload', 'Checking the filename in Version History…', '<p role="status"><span class="workflow-spinner" aria-hidden="true"></span>Checking saved filenames.</p>', [cancel]);
    try {
      const data = await api('versions');
      if (generation !== requestGeneration || !dialog.open) return;
      const match = data.versions.find(version => filenameKey(version.fileName) === filenameKey(file.name));
      if (match) { sameNamePrompt(match, data.currentId); return; }
      screen(1, 'Confirm Upload', 'Do you want to validate the selected Excel file?', `<p>${escape(file.name)}</p><p class="workflow-note">The file will be compared with ${escape(activeVersion?.fileName || 'no previous baseline')}. Selecting or validating a file does not apply it.</p>`, [cancel, { label: 'Validate File', primary: true, run: validate }]);
    } catch (error) {
      if (generation !== requestGeneration || !dialog.open) return;
      screen(1, 'Confirm Upload', 'Saved filenames could not be checked.', '', [cancel, { label: 'Retry', run: checkUploadName }]);
      showError(error);
    }
  }
  $('excelUpload').addEventListener('change', event => {
    file = event.target.files?.[0];
    if (!file || !ready) return;
    draft = null;
    checkUploadName();
  });
  $('versionHistory').addEventListener('click', () => history().catch(error => { screen(0, 'Version History', '', '', [{ label: 'Close', run: close }]); showError(error); }));
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  setReady(false);
  loadCurrent().then(() => setReady(true)).catch(error => { $('uploadStatus').textContent = error.message + ' Showing the bundled baseline; shared updates are unavailable.'; });
  // Other viewers pick up approved shared versions without overwriting an open review.
  async function refresh() {
    if (dialog.open || document.hidden) return;
    try {
      const data = await api('current');

      if (data.version?.id !== activeVersion?.id) { activeVersion = data.version; window.KpiDashboard.apply(data.rows, data.version?.fileName || 'No baseline yet'); $('uploadStatus').textContent = 'The latest shared baseline has been loaded.'; }
      showVersionMeta(activeVersion);
    } catch { /* Retain the last successfully loaded dataset during an outage. */ }
  }
  window.addEventListener('focus', refresh);
  setInterval(refresh, 30000);
})();
