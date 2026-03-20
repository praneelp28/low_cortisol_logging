const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const lib = require('../lib.js');

// ── Real URLs from the user's environment ───────────────────────────────────

const REAL_KIBANA = `https://kibana.cfdata.org/app/discover#/?_g=(filters:!(),refreshInterval:(pause:!t,value:0),time:(from:now-7d,to:now))&_a=(columns:!(host,message,service),filters:!(),index:ea073d70-8ed6-11ea-88e9-39648e0749be,interval:auto,query:(language:kuery,query:'%221757f676-b10b-41c4-ae78-06154f8a9daf%22'),sort:!())`;

const REAL_THANOS = `https://metrics.cfdata.org/graph?g0.expr=mean_used_permits&g0.tab=1&g0.stacked=0&g0.range_input=1h&g0.max_source_resolution=0s&g0.deduplicate=1&g0.partial_response=1&g0.store_matches=%5B%5D&g0.engine=thanos&g0.analyze=0&g0.tenant=`;

const REAL_GRAFANA = `https://grafana.cfdata.org/d/qtXPQEiIz/ai-inference`;

const GRAFANA_WITH_TIME = `https://grafana.cfdata.org/d/000001576/elasticsearch-node-metrics?orgId=1&from=now-1h&to=now`;

const GRAFANA_ABSOLUTE = `https://grafana.cfdata.org/d/eixo04tGz/kafka-offsets?orgId=1&from=1674823250573&to=1674844380138`;

const KIBANA_ABSOLUTE = `https://kibana.cfdata.org/app/kibana#/discover?_g=(refreshInterval:(display:Off,pause:!f,value:0),time:(from:'2018-06-21T00:00:00.000Z',mode:absolute,to:'2018-06-21T03:00:00.000Z'))&_a=(columns:!(_source))`;

// ── detectTool ──────────────────────────────────────────────────────────────

describe('detectTool', () => {
  it('detects grafana.cfdata.org', () => {
    assert.equal(lib.detectTool(REAL_GRAFANA), 'grafana');
  });

  it('detects grafana.cloudflare.com', () => {
    assert.equal(lib.detectTool('https://grafana.cloudflare.com/d/HbgKXc3mz/edge-sli'), 'grafana');
  });

  it('detects kibana.cfdata.org', () => {
    assert.equal(lib.detectTool(REAL_KIBANA), 'kibana');
  });

  it('skips kibana goto links', () => {
    assert.equal(lib.detectTool('https://kibana.cfdata.org/goto/abc123'), null);
  });

  it('detects metrics.cfdata.org as thanos', () => {
    assert.equal(lib.detectTool(REAL_THANOS), 'thanos');
  });

  it('detects thanos.cfdata.org', () => {
    assert.equal(lib.detectTool('https://thanos.cfdata.org/graph?g0.expr=up'), 'thanos');
  });

  it('detects prometheus-access.cfdata.org', () => {
    assert.equal(lib.detectTool('https://akl01.prometheus-access.cfdata.org/graph'), 'thanos');
  });

  it('detects prometheus.access.*.k8s', () => {
    assert.equal(lib.detectTool('https://prometheus.access.pdx-b.k8s.cfplat.com/graph'), 'thanos');
  });

  it('returns null for random URLs', () => {
    assert.equal(lib.detectTool('https://google.com'), null);
  });

  it('returns null for null/empty', () => {
    assert.equal(lib.detectTool(null), null);
    assert.equal(lib.detectTool(''), null);
  });
});

// ── parseGrafana ────────────────────────────────────────────────────────────

describe('parseGrafana', () => {
  it('parses relative from/to', () => {
    const t = lib.parseGrafana(GRAFANA_WITH_TIME);
    assert.deepEqual(t, { from: 'now-1h', to: 'now' });
  });

  it('parses absolute epoch ms', () => {
    const t = lib.parseGrafana(GRAFANA_ABSOLUTE);
    assert.deepEqual(t, { from: '1674823250573', to: '1674844380138' });
  });

  it('returns null when no from/to', () => {
    assert.equal(lib.parseGrafana(REAL_GRAFANA), null);
  });

  it('handles explore mode', () => {
    const url = `https://grafana.cfdata.org/explore?orgId=1&left=${encodeURIComponent(JSON.stringify(['now-1h', 'now', 'some-ds', {}]))}`;
    const t = lib.parseGrafana(url);
    assert.deepEqual(t, { from: 'now-1h', to: 'now' });
  });

  it('returns null for garbage', () => {
    assert.equal(lib.parseGrafana('not-a-url'), null);
  });
});

// ── parseKibana ─────────────────────────────────────────────────────────────

describe('parseKibana', () => {
  it('parses relative time from real URL', () => {
    const t = lib.parseKibana(REAL_KIBANA);
    assert.deepEqual(t, { from: 'now-7d', to: 'now' });
  });

  it('parses absolute quoted ISO time', () => {
    const t = lib.parseKibana(KIBANA_ABSOLUTE);
    assert.deepEqual(t, { from: '2018-06-21T00:00:00.000Z', to: '2018-06-21T03:00:00.000Z' });
  });

  it('returns null with no hash', () => {
    assert.equal(lib.parseKibana('https://kibana.cfdata.org/app/discover'), null);
  });

  it('returns null for garbage', () => {
    assert.equal(lib.parseKibana('not-a-url'), null);
  });
});

// ── parseThanos ─────────────────────────────────────────────────────────────

describe('parseThanos', () => {
  it('parses relative range from real URL', () => {
    const t = lib.parseThanos(REAL_THANOS);
    assert.deepEqual(t, { from: 'now-1h', to: 'now' });
  });

  it('parses absolute with end_input', () => {
    const url = 'https://metrics.cfdata.org/graph?g0.expr=up&g0.range_input=1h&g0.end_input=2024-01-15T11:00:00Z';
    const t = lib.parseThanos(url);
    const endMs = Date.parse('2024-01-15T11:00:00Z');
    assert.equal(t.to, String(endMs));
    assert.equal(t.from, String(endMs - 3600000));
  });

  it('returns null without range_input', () => {
    assert.equal(lib.parseThanos('https://metrics.cfdata.org/graph?g0.expr=up'), null);
  });
});

// ── Duration helpers ────────────────────────────────────────────────────────

describe('durationToMs', () => {
  it('parses seconds', () => assert.equal(lib.durationToMs('30s'), 30000));
  it('parses minutes', () => assert.equal(lib.durationToMs('5m'), 300000));
  it('parses hours', () => assert.equal(lib.durationToMs('1h'), 3600000));
  it('parses days', () => assert.equal(lib.durationToMs('7d'), 604800000));
  it('returns null for bad input', () => assert.equal(lib.durationToMs('bad'), null));
});

describe('msToDuration', () => {
  it('converts to days', () => assert.equal(lib.msToDuration(86400000), '1d'));
  it('converts to hours', () => assert.equal(lib.msToDuration(3600000), '1h'));
  it('converts to minutes', () => assert.equal(lib.msToDuration(300000), '5m'));
  it('converts to seconds', () => assert.equal(lib.msToDuration(45000), '45s'));
  it('falls back for zero', () => assert.equal(lib.msToDuration(0), '1h'));
});

describe('relativeToMs', () => {
  it('parses now as 0', () => assert.equal(lib.relativeToMs('now'), 0));
  it('parses now-1h', () => assert.equal(lib.relativeToMs('now-1h'), 3600000));
  it('parses now-7d', () => assert.equal(lib.relativeToMs('now-7d'), 604800000));
  it('strips grafana rounding: now-1h/h', () => assert.equal(lib.relativeToMs('now-1h/h'), 3600000));
  it('returns null for gibberish', () => assert.equal(lib.relativeToMs('yesterday'), null));
});

describe('stripRounding', () => {
  it('strips /h', () => assert.equal(lib.stripRounding('now-1h/h'), 'now-1h'));
  it('strips /d', () => assert.equal(lib.stripRounding('now/d'), 'now'));
  it('leaves clean values alone', () => assert.equal(lib.stripRounding('now-6h'), 'now-6h'));
});

// ── writeGrafana ────────────────────────────────────────────────────────────

describe('writeGrafana', () => {
  it('writes relative time', () => {
    const result = lib.writeGrafana(GRAFANA_WITH_TIME, { from: 'now-6h', to: 'now' });
    const u = new URL(result);
    assert.equal(u.searchParams.get('from'), 'now-6h');
    assert.equal(u.searchParams.get('to'), 'now');
  });

  it('preserves other params', () => {
    const result = lib.writeGrafana(GRAFANA_WITH_TIME, { from: 'now-6h', to: 'now' });
    const u = new URL(result);
    assert.equal(u.searchParams.get('orgId'), '1');
  });

  it('adds from/to to URL that had none', () => {
    const result = lib.writeGrafana(REAL_GRAFANA, { from: 'now-1h', to: 'now' });
    const u = new URL(result);
    assert.equal(u.searchParams.get('from'), 'now-1h');
    assert.equal(u.searchParams.get('to'), 'now');
  });

  it('returns original on garbage URL', () => {
    assert.equal(lib.writeGrafana('nope', { from: 'now-1h', to: 'now' }), 'nope');
  });
});

// ── writeKibana ─────────────────────────────────────────────────────────────

describe('writeKibana', () => {
  it('replaces relative time', () => {
    const result = lib.writeKibana(REAL_KIBANA, { from: 'now-1h', to: 'now' });
    assert.ok(result.includes('time:(from:now-1h,to:now)'), `got: ${result}`);
    assert.ok(!result.includes('now-7d'), 'old time should be gone');
  });

  it('preserves the _a state', () => {
    const result = lib.writeKibana(REAL_KIBANA, { from: 'now-1h', to: 'now' });
    assert.ok(result.includes('columns:!(host,message,service)'), 'app state should survive');
  });

  it('writes absolute ISO time with quotes', () => {
    const abs = { from: '1705312800000', to: '1705316400000' };
    const result = lib.writeKibana(REAL_KIBANA, abs);
    assert.ok(result.includes("from:'20"), `expected ISO in result: ${result}`);
    assert.ok(result.includes("to:'20"), `expected ISO in result: ${result}`);
  });

  it('strips grafana rounding syntax', () => {
    const result = lib.writeKibana(REAL_KIBANA, { from: 'now-1h/h', to: 'now' });
    assert.ok(result.includes('time:(from:now-1h,to:now)'), 'rounding should be stripped');
    assert.ok(!result.includes('/h'), 'no /h in kibana URL');
  });

  it('returns original on URL with no hash', () => {
    const url = 'https://kibana.cfdata.org/app/discover';
    assert.equal(lib.writeKibana(url, { from: 'now-1h', to: 'now' }), url);
  });
});

// ── writeThanos ─────────────────────────────────────────────────────────────

describe('writeThanos', () => {
  it('writes relative duration', () => {
    const result = lib.writeThanos(REAL_THANOS, { from: 'now-6h', to: 'now' });
    const u = new URL(result);
    assert.equal(u.searchParams.get('g0.range_input'), '6h');
    assert.equal(u.searchParams.has('g0.end_input'), false);
  });

  it('preserves other g0 params', () => {
    const result = lib.writeThanos(REAL_THANOS, { from: 'now-6h', to: 'now' });
    const u = new URL(result);
    assert.equal(u.searchParams.get('g0.expr'), 'mean_used_permits');
    assert.equal(u.searchParams.get('g0.engine'), 'thanos');
  });

  it('writes absolute with end_input', () => {
    const abs = { from: '1705312800000', to: '1705316400000' }; // 1h range
    const result = lib.writeThanos(REAL_THANOS, abs);
    const u = new URL(result);
    assert.equal(u.searchParams.get('g0.range_input'), '1h');
    assert.ok(u.searchParams.has('g0.end_input'), 'should have end_input');
  });

  it('updates multiple panels', () => {
    const url = REAL_THANOS + '&g1.expr=other_metric&g1.range_input=1h&g1.tab=0';
    const result = lib.writeThanos(url, { from: 'now-6h', to: 'now' });
    const u = new URL(result);
    assert.equal(u.searchParams.get('g0.range_input'), '6h');
    assert.equal(u.searchParams.get('g1.range_input'), '6h');
  });
});

// ── Full round-trip: parse from one tool, write to another ──────────────────

describe('round-trip sync', () => {
  it('Grafana relative → Kibana', () => {
    const time = lib.parseGrafana(GRAFANA_WITH_TIME);
    const result = lib.writeKibana(REAL_KIBANA, time);
    assert.ok(result.includes('time:(from:now-1h,to:now)'));
  });

  it('Grafana relative → Thanos', () => {
    const time = lib.parseGrafana(GRAFANA_WITH_TIME);
    const result = lib.writeThanos(REAL_THANOS, time);
    const u = new URL(result);
    assert.equal(u.searchParams.get('g0.range_input'), '1h');
  });

  it('Kibana relative → Grafana', () => {
    const time = lib.parseKibana(REAL_KIBANA);
    const result = lib.writeGrafana(GRAFANA_WITH_TIME, time);
    const u = new URL(result);
    assert.equal(u.searchParams.get('from'), 'now-7d');
    assert.equal(u.searchParams.get('to'), 'now');
  });

  it('Kibana relative → Thanos', () => {
    const time = lib.parseKibana(REAL_KIBANA);
    const result = lib.writeThanos(REAL_THANOS, time);
    const u = new URL(result);
    assert.equal(u.searchParams.get('g0.range_input'), '7d');
  });

  it('Thanos relative → Grafana', () => {
    const time = lib.parseThanos(REAL_THANOS);
    const result = lib.writeGrafana(GRAFANA_WITH_TIME, time);
    const u = new URL(result);
    assert.equal(u.searchParams.get('from'), 'now-1h');
    assert.equal(u.searchParams.get('to'), 'now');
  });

  it('Thanos relative → Kibana', () => {
    const time = lib.parseThanos(REAL_THANOS);
    const result = lib.writeKibana(REAL_KIBANA, time);
    assert.ok(result.includes('time:(from:now-1h,to:now)'));
  });

  it('Grafana absolute → Kibana', () => {
    const time = lib.parseGrafana(GRAFANA_ABSOLUTE);
    const result = lib.writeKibana(REAL_KIBANA, time);
    assert.ok(result.includes("from:'20"), 'should have ISO date');
  });

  it('Grafana absolute → Thanos', () => {
    const time = lib.parseGrafana(GRAFANA_ABSOLUTE);
    const result = lib.writeThanos(REAL_THANOS, time);
    const u = new URL(result);
    assert.ok(u.searchParams.has('g0.end_input'), 'should have end_input');
    // Duration: 1674844380138 - 1674823250573 = 21129565ms ≈ 5h52m
    const dur = u.searchParams.get('g0.range_input');
    assert.ok(dur, 'should have a duration');
  });

  it('Kibana absolute → Grafana', () => {
    const time = lib.parseKibana(KIBANA_ABSOLUTE);
    const result = lib.writeGrafana(REAL_GRAFANA, time);
    const u = new URL(result);
    const from = Number(u.searchParams.get('from'));
    const to = Number(u.searchParams.get('to'));
    assert.ok(from > 1e12, 'should be epoch ms');
    assert.ok(to > from, 'to should be after from');
  });
});

// ── Edge cases / safety ─────────────────────────────────────────────────────

describe('safety', () => {
  it('writeTime returns original URL on unknown tool', () => {
    assert.equal(lib.writeTime('unknown', 'https://example.com', { from: 'now-1h', to: 'now' }), 'https://example.com');
  });

  it('parseTime returns null on unknown tool', () => {
    assert.equal(lib.parseTime('unknown', 'https://example.com'), null);
  });

  it('all parsers survive null/empty/garbage', () => {
    assert.equal(lib.parseGrafana(null), null);
    assert.equal(lib.parseKibana(''), null);
    assert.equal(lib.parseThanos('not a url at all'), null);
  });

  it('all writers return original URL on garbage input', () => {
    assert.equal(lib.writeGrafana('bad', { from: 'x', to: 'y' }), 'bad');
    assert.equal(lib.writeKibana('bad', { from: 'x', to: 'y' }), 'bad');
    assert.equal(lib.writeThanos('bad', { from: 'x', to: 'y' }), 'bad');
  });

  it('kibana write preserves query in _a', () => {
    const time = { from: 'now-15m', to: 'now' };
    const result = lib.writeKibana(REAL_KIBANA, time);
    assert.ok(result.includes('1757f676'), 'query UUID should survive');
  });
});
