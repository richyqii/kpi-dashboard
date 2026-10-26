(function () {
  const $ = id => document.getElementById(id);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const dialog = $('uploadWorkflow');
  let activeVersion = null, draft = null, file = null, busy = false, committing = false, ready = false, requestGeneration = 0;
  let historyRequest = null;
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
    $('workflowSteps').hidden = true;
    $('workflowSteps').replaceChildren();
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
  async function checkUploadName() {
    if (busy || committing || !file) return;
    busy = true;
    const selected = file, generation = ++requestGeneration;
    screen(0, 'Making changes...', 'Checking Version History before applying your uploaded document.', '<p>' + escape(selected.name) + '</p>', [cancel]);
    try {
      const data = await api('versions', { signal: AbortSignal.timeout(15000) });
      if (generation !== requestGeneration || file !== selected) return;
      busy = false;
      const normalize = name => String(name).normalize('NFKC').trim().toLowerCase();
      if (data.versions.some(version => normalize(version.fileName) === normalize(selected.name))) {
        screen(0, 'File Name Already Exists', 'A file with this name is already in Version History. Do you want to use the newly uploaded version?', '<p><strong>' + escape(selected.name) + '</strong></p><p>The new file will become the current baseline. The previous version will remain in Version History. Cancel leaves the dashboard unchanged.</p>', [cancel, { label: 'Use New Version', primary: true, run: applyUpload }]);
      } else await applyUpload();
    } catch (error) {
      if (generation !== requestGeneration) return;
      busy = false;
      screen(0, 'Unable to check file name', 'The file has not been applied. Retry to check Version History.', '', [cancel, { label: 'Retry', primary: true, run: checkUploadName }]);
      showError(error);
    }
  }
  async function applyUpload() {
    if (busy || committing || !file) return;
    busy = true; committing = true;
    const selected = file;
    screen(0, 'Making changes...', 'Using your uploaded document to update the dashboard.', '<p role="status"><span class="workflow-spinner" aria-hidden="true"></span>Making changes...</p><p>'+escape(selected.name)+'</p>', []);
    let saving = false;
    try {
      if (!draft) draft = await api('preview', {method:'POST',headers:{'Content-Type':'application/octet-stream','X-File-Name':encodeURIComponent(selected.name),'X-Baseline-Id':activeVersion?.id || ''},body:selected});
      saving = true;
      const result = await api('commit', {method:'POST',body:JSON.stringify({draftId:draft.id,approved:true,useUploadedFile:true})});
      activeVersion = result.version;
      showVersionMeta(activeVersion);
      window.KpiDashboard.apply(result.rows, result.version.fileName);
      $('uploadStatus').textContent = 'Now using '+result.version.fileName;
      draft = null; file = null; $('excelUpload').value = ''; busy = false; committing = false;
      screen(0, 'Update Successful', 'The dashboard is now using your uploaded file.', '<p class="workflow-success">'+escape(result.version.fileName)+'</p><p class="workflow-note">Saved in Version History. The dashboard has been refreshed.</p>', [{label:'Done',primary:true,run:close}]);
    } catch(error) {
      busy = false; committing = false;
      screen(0, saving ? 'Update could not be confirmed' : 'Unable to use this file', saving ? 'Retry to confirm the update, or close and refresh the dashboard to check the current file.' : 'The saved baseline has not been changed.', '', [...(saving ? [{label:'Retry',primary:true,run:applyUpload}] : []), {label:'Close',run:close}]);
      showError(error);
      if (error.status === 409) { draft = null; await loadCurrent(); }
    }
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
    screen(0, 'Version History', 'Use This Version immediately makes the selected file the shared baseline and refreshes the dashboard.', `<div class="workflow-history">${data.versions.map((version, index) => `<article class="workflow-version"><div><strong>${escape(version.fileName)}</strong><p class="workflow-note">${escape(new Date(version.createdAt).toLocaleString('en-GB', { timeZone: 'Asia/Singapore' }))} (Singapore) · ${escape(version.kind)} · ${version.summary.records} tasks${version.id === data.currentId ? ' · Current baseline' : ''}</p></div><div class="workflow-version-actions">${version.id !== data.currentId ? `<button type="button" class="workflow-button history-restore" data-index="${index}">Use This Version</button>` : ''}</div></article>`).join('') || '<p>No approved versions yet.</p>'}</div>`, [{ label: 'Close', run: close }]);
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
    document.querySelectorAll('.history-restore').forEach(button => button.addEventListener('click', () => useVersion(data.versions[button.dataset.index], data.currentId)));
  }
  async function useVersion(version, baselineId) {
    if (busy || committing) return;
    busy = true; committing = true; draft = null;
    screen(0, 'Making changes...', 'Using the selected saved file to update the dashboard.', '<p role="status"><span class="workflow-spinner" aria-hidden="true"></span>Making changes...</p><p>' + escape(version.fileName) + '</p>', []);
    try {
      const result = await api('use-version', { method: 'POST', body: JSON.stringify({ versionId: version.id, expectedVersionId: baselineId }) });
      activeVersion = result.version;
      showVersionMeta(activeVersion);
      window.KpiDashboard.apply(result.rows, result.version.fileName);
      $('uploadStatus').textContent = 'Now using ' + result.version.fileName;
      file = null; $('excelUpload').value = ''; busy = false; committing = false;
      screen(0, 'Update Successful', 'The dashboard is now using the selected version.', '<p class="workflow-success">' + escape(result.version.fileName) + '</p><p class="workflow-note">This file is now the shared baseline. Version History has been retained.</p>', [{ label: 'Done', primary: true, run: close }]);
    } catch (error) {
      busy = false; committing = false;
      screen(0, 'Update could not be confirmed', 'Retry or reopen Version History to check the current baseline.', '', [{ label: 'Retry', primary: true, run: () => useVersion(version, baselineId) }, { label: 'Version History', run: history }, { label: 'Close', run: close }]);
      showError(error);
      if (error.status === 409) await loadCurrent();
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
  $('excelUpload').addEventListener('change', event => {
    if (busy || committing) return;
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
