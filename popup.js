"use strict";

// popup.js — The popup UI. Talks to chrome.tabs to detect and sync.
// All URL logic lives in lib.js — this file just wires up the DOM.

// HTML-escape a string to prevent XSS (tab titles are attacker-controlled).
function esc(s) {
  var d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function renderSource(el, tool, time) {
  if (tool && time) {
    el.innerHTML =
      '<span class="tool-badge ' + esc(tool) + '">' + esc(toolLabel(tool)) + '</span>' +
      '<div class="time-range">' + esc(formatTimeDisplay(time)) + '</div>';
  } else if (tool) {
    el.innerHTML =
      '<span class="tool-badge ' + esc(tool) + '">' + esc(toolLabel(tool)) + '</span>' +
      '<div class="time-range muted">no time range in URL</div>';
  } else {
    el.textContent = 'not an obs tab';
    el.classList.add('detecting');
  }
}

function renderTarget(container, tab, tool, syncBtn, sourceTime) {
  var row = document.createElement('div');
  row.className = 'target-row';

  var cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = true;
  cb.dataset.tabId = tab.id;
  cb.dataset.tool = tool;

  var check = document.createElement('div');
  check.className = 'check on';

  var badge = document.createElement('span');
  badge.className = 'tool-badge ' + tool;
  badge.textContent = toolLabel(tool);

  var title = document.createElement('span');
  title.className = 'tab-title';
  title.textContent = tab.title || 'Untitled';
  title.title = tab.title || 'Untitled';

  row.appendChild(cb);
  row.appendChild(check);
  row.appendChild(badge);
  row.appendChild(title);

  row.addEventListener('click', function () {
    cb.checked = !cb.checked;
    check.className = cb.checked ? 'check on' : 'check';
    row.className = cb.checked ? 'target-row' : 'target-row unchecked';
    var anyChecked = container.querySelector('input[type="checkbox"]:checked');
    syncBtn.disabled = !(sourceTime && anyChecked);
  });

  container.appendChild(row);
}

async function init() {
  var sourceEl = document.getElementById('source-info');
  var targetsList = document.getElementById('targets-list');
  var noTargets = document.getElementById('no-targets');
  var syncBtn = document.getElementById('sync-btn');
  var statusEl = document.getElementById('status');

  var activeTab;
  try {
    var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTab = tabs[0];
  } catch (e) {
    sourceEl.textContent = 'failed to read active tab';
    return;
  }

  if (!activeTab) {
    sourceEl.textContent = 'no active tab';
    return;
  }

  var sourceTool = detectTool(activeTab.url);
  var sourceTime = sourceTool ? parseTime(sourceTool, activeTab.url) : null;

  renderSource(sourceEl, sourceTool, sourceTime);

  var allTabs;
  try {
    allTabs = await chrome.tabs.query({});
  } catch (e) {
    statusEl.textContent = 'failed to query tabs';
    statusEl.className = 'error';
    return;
  }

  var targets = [];
  for (var i = 0; i < allTabs.length; i++) {
    if (allTabs[i].id === activeTab.id) continue;
    var tool = detectTool(allTabs[i].url);
    if (!tool) continue;
    targets.push({ tab: allTabs[i], tool: tool });
  }

  if (targets.length === 0) {
    noTargets.classList.add('visible');
  } else {
    for (var j = 0; j < targets.length; j++) {
      renderTarget(targetsList, targets[j].tab, targets[j].tool, syncBtn, sourceTime);
    }
  }

  if (sourceTime && targets.length > 0) {
    syncBtn.disabled = false;
  }

  // Sync handler
  syncBtn.addEventListener('click', async function () {
    var mode = document.getElementById('mode-new').classList.contains('active') ? 'new' : 'replace';
    syncBtn.disabled = true;
    syncBtn.textContent = 'syncing...';
    statusEl.textContent = '';
    statusEl.className = 'muted';

    var synced = 0;
    var errors = 0;
    var checkboxes = targetsList.querySelectorAll('input[type="checkbox"]:checked');

    for (var k = 0; k < checkboxes.length; k++) {
      var tabId = parseInt(checkboxes[k].dataset.tabId, 10);
      var tabTool = checkboxes[k].dataset.tool;

      try {
        var tab = await chrome.tabs.get(tabId);
        var newUrl = writeTime(tabTool, tab.url, sourceTime);

        if (newUrl && newUrl !== tab.url) {
          if (mode === 'new') {
            await chrome.tabs.create({ url: newUrl, active: false });
          } else {
            await chrome.tabs.update(tabId, { url: newUrl });
          }
          synced++;
        }
      } catch (e) {
        console.debug('failed to sync tab', tabId, e);
        errors++;
      }
    }

    var verb = mode === 'new' ? 'opened' : 'synced';
    if (errors > 0) {
      statusEl.className = 'error';
      statusEl.textContent = verb + ' ' + synced + ', failed ' + errors + ' (tab closed?)';
      syncBtn.textContent = 'retry';
      syncBtn.disabled = false;
    } else if (synced > 0) {
      statusEl.className = 'success';
      statusEl.textContent = verb + ' ' + synced + ' tab' + (synced > 1 ? 's' : '');
      syncBtn.textContent = 'done~';
      setTimeout(function () { window.close(); }, 1200);
    } else {
      statusEl.className = 'muted';
      statusEl.textContent = 'times already match';
      syncBtn.textContent = 'sync time';
      syncBtn.disabled = false;
    }
  });
}

// Toggle wiring — runs immediately, no chrome APIs needed
(function () {
  var modeReplace = document.getElementById('mode-replace');
  var modeNew = document.getElementById('mode-new');

  modeReplace.addEventListener('click', function () {
    modeReplace.classList.add('active');
    modeNew.classList.remove('active');
  });

  modeNew.addEventListener('click', function () {
    modeNew.classList.add('active');
    modeReplace.classList.remove('active');
  });
})();

init();
