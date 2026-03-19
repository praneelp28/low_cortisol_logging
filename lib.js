"use strict";

// lib.js — Pure logic for detecting, parsing, converting, and writing
// observability tool time ranges. No browser/chrome APIs here.

// ── Constants ────────────────────────────────────────────────────────────────

var DURATION_UNITS = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
var MAX_THANOS_PANELS = 20;

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
      url.includes('prometheus-access.cfdata.org') ||
      url.includes('.k8s.cfplat.com')
    )
      return 'thanos';
  } catch (e) { console.debug('detectTool:', e); }
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

function durationToMs(dur) {
  var match = dur.match(/^(\d+)([smhd])$/);
  if (!match) return null;
  return parseInt(match[1], 10) * DURATION_UNITS[match[2]];
}

function msToDuration(ms) {
  if (ms <= 0) return '1h';
  if (ms % DURATION_UNITS.d === 0) return (ms / DURATION_UNITS.d) + 'd';
  if (ms % DURATION_UNITS.h === 0) return (ms / DURATION_UNITS.h) + 'h';
  if (ms % DURATION_UNITS.m === 0) return (ms / DURATION_UNITS.m) + 'm';
  return Math.round(ms / DURATION_UNITS.s) + 's';
}

function relativeToMs(val) {
  var cleaned = stripRounding(val);
  if (cleaned === 'now') return 0;
  var match = cleaned.match(/^now-(\d+)([smhd])$/);
  if (!match) return null;
  return parseInt(match[1], 10) * DURATION_UNITS[match[2]];
}

// Heuristic: >1e12 = epoch ms, >1e9 = epoch seconds, else ISO string.
// Valid for dates between ~2001 and ~2286.
function toEpochMs(val) {
  var n = Number(val);
  if (!isNaN(n) && n > 1e12) return n;
  if (!isNaN(n) && n > 1e9) return n * 1000;
  return Date.parse(val);
}

function resolveToAbsolute(time) {
  var now = Date.now();
  var fromMs, toMs;

  if (isRelative(time.to)) {
    var toOffset = relativeToMs(time.to);
    toMs = toOffset !== null ? now - toOffset : now;
  } else {
    toMs = toEpochMs(time.to);
  }

  if (isRelative(time.from)) {
    var fromOffset = relativeToMs(time.from);
    if (fromOffset === null) return null;
    fromMs = now - fromOffset;
  } else {
    fromMs = toEpochMs(time.from);
  }

  if (isNaN(fromMs) || isNaN(toMs)) return null;
  return { from: fromMs, to: toMs };
}

// ── Parsing ─────────────────────────────────────────────────────────────────

function parseGrafana(url) {
  var u = safeURL(url);
  if (!u) return null;

  if (u.pathname.includes('/explore')) {
    var left = u.searchParams.get('left');
    if (!left) return null;
    try {
      var arr = JSON.parse(decodeURIComponent(left));
      if (arr && arr[0] && arr[1]) {
        return { from: String(arr[0]), to: String(arr[1]) };
      }
    } catch (e) { console.debug('parseGrafana explore:', e); }
    return null;
  }

  var from = u.searchParams.get('from');
  var to = u.searchParams.get('to');
  if (!from || !to) return null;
  return { from: from, to: to };
}

function parseKibana(url) {
  var u = safeURL(url);
  if (!u) return null;
  var hash = u.hash;
  if (!hash) return null;

  var decoded;
  try { decoded = decodeURIComponent(hash); } catch (e) { decoded = hash; }

  var timeBlock = decoded.match(/time:\(([^)]*)\)/);
  if (!timeBlock) return null;
  var inner = timeBlock[1];

  var fromQuoted = inner.match(/from:'([^']*)'/);
  var fromUnquoted = inner.match(/from:([^,)]+)/);
  var toQuoted = inner.match(/to:'([^']*)'/);
  var toUnquoted = inner.match(/to:([^,)]+)/);

  var from = fromQuoted ? fromQuoted[1] : fromUnquoted ? fromUnquoted[1] : null;
  var to = toQuoted ? toQuoted[1] : toUnquoted ? toUnquoted[1] : null;

  if (!from || !to) return null;
  return { from: from, to: to };
}

function parseThanos(url) {
  var u = safeURL(url);
  if (!u) return null;
  var range = u.searchParams.get('g0.range_input');
  if (!range) return null;
  var endInput = u.searchParams.get('g0.end_input');

  if (endInput) {
    var endMs = Date.parse(endInput);
    if (isNaN(endMs)) return null;
    var durMs = durationToMs(range);
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
    console.debug('parseTime failed:', tool, e);
  }
  return null;
}

// ── Writing ─────────────────────────────────────────────────────────────────

function writeGrafana(url, time) {
  var u = safeURL(url);
  if (!u) return url;

  if (u.pathname.includes('/explore')) {
    return writeGrafanaExplore(u, time);
  }

  if (isRelative(time.from)) {
    u.searchParams.set('from', time.from);
    u.searchParams.set('to', time.to);
  } else {
    var abs = resolveToAbsolute(time);
    if (!abs) return url;
    u.searchParams.set('from', String(abs.from));
    u.searchParams.set('to', String(abs.to));
  }
  return u.toString();
}

function writeGrafanaExplore(u, time) {
  var left = u.searchParams.get('left');
  if (!left) return u.toString();
  try {
    var arr = JSON.parse(decodeURIComponent(left));
    if (isRelative(time.from)) {
      arr[0] = time.from;
      arr[1] = time.to;
    } else {
      var abs = resolveToAbsolute(time);
      if (!abs) return u.toString();
      arr[0] = String(abs.from);
      arr[1] = String(abs.to);
    }
    u.searchParams.set('left', JSON.stringify(arr));
  } catch (e) { console.debug('writeGrafanaExplore:', e); }
  return u.toString();
}

function writeKibana(url, time) {
  var u = safeURL(url);
  if (!u) return url;
  var hash = u.hash;
  if (!hash) return url;

  var decoded;
  try { decoded = decodeURIComponent(hash); } catch (e) { decoded = hash; }

  var fromStr, toStr;
  if (isRelative(time.from)) {
    fromStr = stripRounding(time.from);
    toStr = stripRounding(time.to);
  } else {
    var abs = resolveToAbsolute(time);
    if (!abs) return url;
    fromStr = "'" + new Date(abs.from).toISOString() + "'";
    toStr = "'" + new Date(abs.to).toISOString() + "'";
  }

  var timeRegex = /time:\([^)]*\)/;
  if (timeRegex.test(decoded)) {
    decoded = decoded.replace(timeRegex, 'time:(from:' + fromStr + ',to:' + toStr + ')');
  } else {
    var gRegex = /_g=\(([^)]*)\)/;
    var gMatch = decoded.match(gRegex);
    if (gMatch) {
      var inner = gMatch[1];
      var timeStr = 'time:(from:' + fromStr + ',to:' + toStr + ')';
      var newInner = inner ? timeStr + ',' + inner : timeStr;
      decoded = decoded.replace(gRegex, '_g=(' + newInner + ')');
    }
  }

  u.hash = decoded;
  return u.toString();
}

function writeThanos(url, time) {
  var u = safeURL(url);
  if (!u) return url;

  var hasPanels = u.searchParams.has('g0.expr') || u.searchParams.has('g0.range_input');
  if (!hasPanels) return url;

  if (isRelative(time.from)) {
    var offset = relativeToMs(time.from);
    var dur = offset !== null ? msToDuration(offset) : '1h';

    for (var i = 0; i < MAX_THANOS_PANELS; i++) {
      if (!u.searchParams.has('g' + i + '.expr') && !u.searchParams.has('g' + i + '.range_input')) break;
      u.searchParams.set('g' + i + '.range_input', dur);
      u.searchParams.delete('g' + i + '.end_input');
      u.searchParams.delete('g' + i + '.moment_input');
    }
  } else {
    var abs = resolveToAbsolute(time);
    if (!abs) return url;
    var absDur = msToDuration(abs.to - abs.from);
    var endStr = new Date(abs.to).toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');

    for (var j = 0; j < MAX_THANOS_PANELS; j++) {
      if (!u.searchParams.has('g' + j + '.expr') && !u.searchParams.has('g' + j + '.range_input')) break;
      u.searchParams.set('g' + j + '.range_input', absDur);
      u.searchParams.set('g' + j + '.end_input', endStr);
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
    console.debug('writeTime failed:', tool, e);
  }
  return url;
}

// ── Display helpers ─────────────────────────────────────────────────────────

function formatTimeDisplay(time) {
  if (!time) return 'no time detected';
  var from = isRelative(time.from) ? time.from : shortTimestamp(time.from);
  var to = isRelative(time.to) ? time.to : shortTimestamp(time.to);
  return from + '  \u2192  ' + to;
}

function shortTimestamp(val) {
  var ms = toEpochMs(val);
  if (isNaN(ms)) return String(val);
  return new Date(ms).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
}

// ── Export for Node.js tests (no-op in browser) ─────────────────────────────

if (typeof exports === 'object' && typeof module === 'object') {
  module.exports = {
    detectTool: detectTool, toolLabel: toolLabel,
    isRelative: isRelative, stripRounding: stripRounding, safeURL: safeURL,
    durationToMs: durationToMs, msToDuration: msToDuration,
    relativeToMs: relativeToMs, toEpochMs: toEpochMs,
    resolveToAbsolute: resolveToAbsolute,
    parseGrafana: parseGrafana, parseKibana: parseKibana,
    parseThanos: parseThanos, parseTime: parseTime,
    writeGrafana: writeGrafana, writeKibana: writeKibana,
    writeThanos: writeThanos, writeTime: writeTime,
    formatTimeDisplay: formatTimeDisplay, shortTimestamp: shortTimestamp,
  };
}
