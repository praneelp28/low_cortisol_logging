// popup.js — UI and chrome.tabs logic only. Pure logic lives in lib.js.

function badge(tool) {
  return `<span class="tool-badge ${tool}">${toolLabel(tool)}</span>`;
}

async function init() {
  const sourceEl = document.getElementById('source-info');
  const targetsList = document.getElementById('targets-list');
  const noTargets = document.getElementById('no-targets');
  const syncBtn = document.getElementById('sync-btn');
  const statusEl = document.getElementById('status');

  // Get active tab
  let activeTab;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTab = tab;
  } catch (e) {
    sourceEl.innerHTML = '<span class="detecting">failed to read tab</span>';
    return;
  }

  if (!activeTab) {
    sourceEl.innerHTML = '<span class="detecting">no active tab</span>';
    return;
  }

  const sourceTool = detectTool(activeTab.url);
  const sourceTime = sourceTool ? parseTime(sourceTool, activeTab.url) : null;

  // Render source
  if (sourceTool && sourceTime) {
    sourceEl.innerHTML = `
      ${badge(sourceTool)}
      <div class="time-range">${formatTimeDisplay(sourceTime)}</div>
    `;
  } else if (sourceTool) {
    sourceEl.innerHTML = `
      ${badge(sourceTool)}
      <div class="time-range muted">no time range in URL</div>
    `;
  } else {
    sourceEl.innerHTML = '<span class="detecting">not an obs tab</span>';
  }

  // Get all tabs, find targets
  let allTabs = [];
  try {
    allTabs = await chrome.tabs.query({});
  } catch (e) {
    statusEl.textContent = 'failed to query tabs';
    statusEl.className = 'error';
    return;
  }

  const targets = [];
  for (const tab of allTabs) {
    if (tab.id === activeTab.id) continue;
    const tool = detectTool(tab.url);
    if (!tool) continue;
    targets.push({ tab, tool });
  }

  // Render targets as clickable bubbles
  if (targets.length === 0) {
    noTargets.style.display = 'block';
  } else {
    for (const { tab, tool } of targets) {
      const row = document.createElement('div');
      row.className = 'target-row';
      const title = (tab.title || 'Untitled').replace(/"/g, '&quot;');
      row.innerHTML = `
        <input type="checkbox" checked data-tab-id="${tab.id}" data-tool="${tool}">
        <div class="check on"></div>
        ${badge(tool)}
        <span class="tab-title" title="${title}">${title}</span>
      `;

      // Click anywhere on the row to toggle
      row.addEventListener('click', () => {
        const cb = row.querySelector('input[type="checkbox"]');
        cb.checked = !cb.checked;
        const check = row.querySelector('.check');
        check.className = cb.checked ? 'check on' : 'check';
        row.className = cb.checked ? 'target-row' : 'target-row unchecked';

        // Update sync button state
        const anyChecked = targetsList.querySelector('input[type="checkbox"]:checked');
        syncBtn.disabled = !(sourceTime && anyChecked);
      });

      targetsList.appendChild(row);
    }
  }

  // Enable sync only if we have source time + targets
  if (sourceTime && targets.length > 0) {
    syncBtn.disabled = false;
  }

  // Sync handler
  syncBtn.addEventListener('click', async () => {
    syncBtn.disabled = true;
    syncBtn.textContent = 'syncing...';
    statusEl.textContent = '';
    statusEl.className = 'muted';

    let synced = 0;
    let errors = 0;
    const checkboxes = targetsList.querySelectorAll('input[type="checkbox"]:checked');

    for (const cb of checkboxes) {
      const tabId = parseInt(cb.dataset.tabId);
      const tool = cb.dataset.tool;

      try {
        const tab = await chrome.tabs.get(tabId);
        const newUrl = writeTime(tool, tab.url, sourceTime);

        if (newUrl && newUrl !== tab.url) {
          await chrome.tabs.update(tabId, { url: newUrl });
          synced++;
        }
      } catch (e) {
        console.warn('Failed to sync tab', tabId, e);
        errors++;
      }
    }

    if (errors > 0) {
      statusEl.className = 'error';
      statusEl.textContent = `synced ${synced}, failed ${errors} (tab closed?)`;
      syncBtn.textContent = 'retry';
      syncBtn.disabled = false;
    } else if (synced > 0) {
      statusEl.className = 'success';
      statusEl.textContent = `synced ${synced} tab${synced > 1 ? 's' : ''}`;
      syncBtn.textContent = 'done~';
      setTimeout(() => window.close(), 1200);
    } else {
      statusEl.className = 'muted';
      statusEl.textContent = 'times already match';
      syncBtn.textContent = 'sync time';
      syncBtn.disabled = false;
    }
  });
}

init();
