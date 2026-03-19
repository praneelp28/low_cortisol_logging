// lib.js — Pure logic for detecting, parsing, converting, and writing
// observability tool time ranges. No browser/chrome APIs here.

// ── Detection ────────────────────────────────────────────────────────────────

function detectTool(url) {
  if (!url) return null;
  try {
    if (url.includes('grafana.cfdata.org') || url.includes('grafana.cloudflare.com'))
      return 'grafana';
    if (url.includes('kibana.cfdata.org') && !url.includes('/goto/'))
      return 'kibana';
    if (
      url.includes('metrics.cfdata.org') ||
      url.includes('thanos.cfdata.org') ||
      url.includes('prometheus-access.cfdata.org') ||
      url.includes('prometheus.access.')
    )
      return 'thanos';
  } catch (e) { /* defensive */ }
  return null;
}

function toolLabel(tool) {
  return { grafana: 'Grafana', kibana: 'Kibana', thanos: 'Thanos/Prom' }[tool] || tool;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function isRelative(val) {
  return typeof val === 'string' && val.startsWith('now');
}

function stripRounding(val) {
  if (typeof val !== 'string') return val;
  return val.replace(/\/[smhd]$/, '');
}

function safeURL(url) {
  try { return new URL(url); } catch (e) { return null; }
}

const DURATION_UNITS = { s: 1000, m: 60000, h: 3600000, d: 86400000 };

function durationToMs(dur) {
  const match = dur.match(/^(\d+)([smhd])$/);
  if (!match) return null;
  return parseInt(match[1]) * DURATION_UNITS[match[2]];
}

function msToDuration(ms) {
  if (ms <= 0) return '1h';
  if (ms % DURATION_UNITS.d === 0) return (ms / DURATION_UNITS.d) + 'd';
  if (ms % DURATION_UNITS.h === 0) return (ms / DURATION_UNITS.h) + 'h';
  if (ms % DURATION_UNITS.m === 0) return (ms / DURATION_UNITS.m) + 'm';
  return Math.round(ms / DURATION_UNITS.s) + 's';
}

function relativeToMs(val) {
  const cleaned = stripRounding(val);
  if (cleaned === 'now') return 0;
  const match = cleaned.match(/^now-(\d+)([smhd])$/);
  if (!match) return null;
  return parseInt(match[1]) * DURATION_UNITS[match[2]];
}

function toEpochMs(val) {
  const n = Number(val);
  if (!isNaN(n) && n > 1e12) return n;
  if (!isNaN(n) && n > 1e9) return n * 1000;
  return Date.parse(val);
}

function resolveToAbsolute(time) {
  const now = Date.now();
  let fromMs, toMs;

  if (isRelative(time.to)) {
    toMs = now;
  } else {
    toMs = toEpochMs(time.to);
  }

  if (isRelative(time.from)) {
    const offset = relativeToMs(time.from);
    if (offset === null) return null;
    fromMs = now - offset;
  } else {
    fromMs = toEpochMs(time.from);
  }

  if (isNaN(fromMs) || isNaN(toMs)) return null;
  return { from: fromMs, to: toMs };
}

// ── Parsing ─────────────────────────────────────────────────────────────────

function parseGrafana(url) {
  const u = safeURL(url);
  if (!u) return null;

  if (u.pathname.includes('/explore')) {
    const left = u.searchParams.get('left');
    if (!left) return null;
    try {
      const arr = JSON.parse(decodeURIComponent(left));
      if (arr && arr[0] && arr[1]) {
        return { from: String(arr[0]), to: String(arr[1]) };
      }
    } catch (e) { /* fall through */ }
    return null;
  }

  const from = u.searchParams.get('from');
  const to = u.searchParams.get('to');
  if (!from || !to) return null;
  return { from, to };
}

function parseKibana(url) {
  const u = safeURL(url);
  if (!u) return null;
  const hash = u.hash;
  if (!hash) return null;

  let decoded;
  try { decoded = decodeURIComponent(hash); } catch (e) { decoded = hash; }

  // Extract the time:(...) block first
  const timeBlock = decoded.match(/time:\(([^)]*)\)/);
  if (!timeBlock) return null;
  const inner = timeBlock[1];

  // Extract from and to independently — handles extra fields like mode:absolute
  // Try quoted first (absolute ISO), then unquoted (relative like now-1h)
  const fromQuoted = inner.match(/from:'([^']*)'/);
  const fromUnquoted = inner.match(/from:([^,)]+)/);
  const toQuoted = inner.match(/to:'([^']*)'/);
  const toUnquoted = inner.match(/to:([^,)]+)/);

  const from = fromQuoted ? fromQuoted[1] : fromUnquoted ? fromUnquoted[1] : null;
  const to = toQuoted ? toQuoted[1] : toUnquoted ? toUnquoted[1] : null;

  if (!from || !to) return null;
  return { from, to };
}

function parseThanos(url) {
  const u = safeURL(url);
  if (!u) return null;
  const range = u.searchParams.get('g0.range_input');
  if (!range) return null;
  const endInput = u.searchParams.get('g0.end_input');

  if (endInput) {
    const endMs = Date.parse(endInput);
    if (isNaN(endMs)) return null;
    const durMs = durationToMs(range);
    if (!durMs) return null;
    return { from: String(endMs - durMs), to: String(endMs) };
  }

  return { from: 'now-' + range, to: 'now' };
}

function parseTime(tool, url) {
  try {
    if (tool === 'grafana') return parseGrafana(url);
    if (tool === 'kibana') return parseKibana(url);
    if (tool === 'thanos') return parseThanos(url);
  } catch (e) {
    console.warn('parseTime failed for', tool, e);
  }
  return null;
}

// ── Writing ─────────────────────────────────────────────────────────────────

function writeGrafana(url, time) {
  const u = safeURL(url);
  if (!u) return url;

  if (u.pathname.includes('/explore')) {
    return writeGrafanaExplore(u, time);
  }

  if (isRelative(time.from)) {
    u.searchParams.set('from', time.from);
    u.searchParams.set('to', time.to);
  } else {
    const abs = resolveToAbsolute(time);
    if (!abs) return url;
    u.searchParams.set('from', String(abs.from));
    u.searchParams.set('to', String(abs.to));
  }
  return u.toString();
}

function writeGrafanaExplore(u, time) {
  const left = u.searchParams.get('left');
  if (!left) return u.toString();
  try {
    const arr = JSON.parse(decodeURIComponent(left));
    if (isRelative(time.from)) {
      arr[0] = time.from;
      arr[1] = time.to;
    } else {
      const abs = resolveToAbsolute(time);
      if (!abs) return u.toString();
      arr[0] = String(abs.from);
      arr[1] = String(abs.to);
    }
    u.searchParams.set('left', JSON.stringify(arr));
  } catch (e) { /* bail */ }
  return u.toString();
}

function writeKibana(url, time) {
  const u = safeURL(url);
  if (!u) return url;
  let hash = u.hash;
  if (!hash) return url;

  let decoded;
  try { decoded = decodeURIComponent(hash); } catch (e) { decoded = hash; }

  let fromStr, toStr;
  if (isRelative(time.from)) {
    fromStr = stripRounding(time.from);
    toStr = stripRounding(time.to);
  } else {
    const abs = resolveToAbsolute(time);
    if (!abs) return url;
    fromStr = "'" + new Date(abs.from).toISOString() + "'";
    toStr = "'" + new Date(abs.to).toISOString() + "'";
  }

  // Replace the entire time:(...) block — this handles extra fields like mode:absolute
  const timeRegex = /time:\([^)]*\)/;
  if (timeRegex.test(decoded)) {
    decoded = decoded.replace(timeRegex, `time:(from:${fromStr},to:${toStr})`);
  } else {
    const gRegex = /_g=\(([^)]*)\)/;
    const gMatch = decoded.match(gRegex);
    if (gMatch) {
      const inner = gMatch[1];
      const newInner = inner
        ? `time:(from:${fromStr},to:${toStr}),${inner}`
        : `time:(from:${fromStr},to:${toStr})`;
      decoded = decoded.replace(gRegex, `_g=(${newInner})`);
    }
  }

  u.hash = decoded;
  return u.toString();
}

function writeThanos(url, time) {
  const u = safeURL(url);
  if (!u) return url;

  const hasPanels = u.searchParams.has('g0.expr') || u.searchParams.has('g0.range_input');
  if (!hasPanels) return url;

  if (isRelative(time.from)) {
    const offset = relativeToMs(time.from);
    const dur = offset !== null ? msToDuration(offset) : '1h';

    for (let i = 0; i < 20; i++) {
      if (!u.searchParams.has(`g${i}.expr`) && !u.searchParams.has(`g${i}.range_input`)) break;
      u.searchParams.set(`g${i}.range_input`, dur);
      u.searchParams.delete(`g${i}.end_input`);
      u.searchParams.delete(`g${i}.moment_input`);
    }
  } else {
    const abs = resolveToAbsolute(time);
    if (!abs) return url;
    const dur = msToDuration(abs.to - abs.from);
    const endStr = new Date(abs.to).toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');

    for (let i = 0; i < 20; i++) {
      if (!u.searchParams.has(`g${i}.expr`) && !u.searchParams.has(`g${i}.range_input`)) break;
      u.searchParams.set(`g${i}.range_input`, dur);
      u.searchParams.set(`g${i}.end_input`, endStr);
    }
  }

  return u.toString();
}

function writeTime(tool, url, time) {
  try {
    if (tool === 'grafana') return writeGrafana(url, time);
    if (tool === 'kibana') return writeKibana(url, time);
    if (tool === 'thanos') return writeThanos(url, time);
  } catch (e) {
    console.warn('writeTime failed for', tool, e);
  }
  return url;
}

// ── Display helpers ─────────────────────────────────────────────────────────

function formatTimeDisplay(time) {
  if (!time) return 'no time detected';
  const from = isRelative(time.from) ? time.from : shortTimestamp(time.from);
  const to = isRelative(time.to) ? time.to : shortTimestamp(time.to);
  return `${from}  →  ${to}`;
}

function shortTimestamp(val) {
  const ms = toEpochMs(val);
  if (isNaN(ms)) return String(val);
  const d = new Date(ms);
  return d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
}

// ── Export for Node.js tests (no-op in browser) ─────────────────────────────

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    detectTool, toolLabel, isRelative, stripRounding, safeURL,
    durationToMs, msToDuration, relativeToMs, toEpochMs, resolveToAbsolute,
    parseGrafana, parseKibana, parseThanos, parseTime,
    writeGrafana, writeKibana, writeThanos, writeTime,
    formatTimeDisplay, shortTimestamp,
  };
}
