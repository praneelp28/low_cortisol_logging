# Spec: Low Cortisol Logging — Observability Time Sync Bookmarklet

## Problem

An engineer debugging an incident has Grafana, Kibana, and Thanos/Prometheus
open in different tabs. They zoom into a suspicious 20-minute window on Grafana.
Now they have to manually replicate that exact time range in Kibana and Thanos —
different URL schemes, different formats, different locations in the URL. It's
tedious, error-prone, and breaks flow.

## Solution

A bookmarklet that reads the time range from the current observability tab and
lets you paste it into another tab. No extension install, no approval required.
The entire implementation lives inside a `javascript:` URI stored in the bookmark.

---

## UX

### Primary Flow

```
1. Engineer is on a Grafana dashboard, zoomed to a time range of interest
2. They click the bookmarklet
3. An overlay appears on the page showing:
   - Tool badge: "Grafana"
   - Detected time: "now-1h → now"
   - A "copy time" button
4. Engineer clicks "copy time" — writes "now-1h|now" to clipboard
5. Engineer switches to Kibana tab, clicks the bookmarklet again
6. Pastes into the input field, clicks "apply"
7. Kibana URL updates to the synced time range
```

### Overlay Layout (rough sketch)

```
┌─────────────────────────────────┐
│  ~ low cortisol logged ~      × │
├─────────────────────────────────┤
│  [Grafana]                      │
│  now-1h → now                   │
│                                 │
│  [ copy time ]                  │
│                                 │
│  apply from another tab         │
│  ┌───────────────────────────┐  │
│  │ paste time here (from|to) │  │
│  └───────────────────────────┘  │
│  [ apply ]                      │
│                                 │
│  (status)                       │
└─────────────────────────────────┘
```

### Design Decisions

| Decision | Choice | Rationale |
|:---|:---|:---|
| Trigger | Click bookmarklet | Works on any browser, no extension install required |
| Direction | Manual copy/paste between tabs | No cross-tab access from a bookmarklet — URL can only touch the current tab |
| Time format (clipboard) | `from\|to` pipe-separated string | Simple to parse, readable, easy to inspect |
| Apply strategy | Avoid full reload where possible | Better UX, Kibana and Grafana can handle in-place navigation |
| Overlay injection | Fixed-position div injected into page | No new window/tab, stays out of the way |
| Toggle | Second click removes overlay if already open | Clean, no leftover UI |

### What if the current tab isn't an observability tool?

The overlay still opens but shows "no time detected" and the copy button is
disabled. The apply/paste flow still works — you can paste a time onto any
supported obs tab regardless of where you copied it from.

---

## Technical Architecture

### How it works

The bookmarklet is a single `javascript:` URI. When clicked it:

1. Injects a `<div>` overlay into the current page's DOM
2. Reads `window.location.href` to detect the tool and parse the time range
3. Lets the user copy the time as `from|to` to clipboard
4. Accepts a pasted `from|to` string and rewrites the current page's URL

All logic (detection, parsing, conversion, writing) is inlined from `lib.js`
and minified into the `javascript:` URI stored in `bookmarklet.html`. There is
no external file reference, no server, no background process.

### Files

```
bookmarklet.html     drag-to-install page (contains the minified javascript: URI)
bookmarklet.js       unminified annotated source (what gets minified into the above)
lib.js               detection, parsing, conversion, writing (pure functions, no browser APIs)
```

### Approach: URL-Only (No DOM Scraping)

We do NOT read from the page's internal JS state (except as a fallback for
Grafana — see below). Everything is done via URL manipulation.

- **Read:** Parse time range from `window.location.href`
- **Write:** Rewrite the URL via `window.location.hash`, `history.pushState`,
  or `location.replace()` depending on the tool

**Why URL-only:**
- No Same-Origin-Policy issues
- No fragile DOM selectors
- Grafana, Kibana, and Thanos are all URL-driven — the URL IS the state
- Simpler to build, test, and debug

### Tab Detection

```javascript
function detectTool(url) {
  if (url.includes('grafana.cfdata.org') || url.includes('grafana.cloudflare.com'))
    return 'grafana';
  if (url.includes('kibana.cfdata.org') && !url.includes('/goto/'))
    return 'kibana';
  if (url.includes('metrics.cfdata.org') || url.includes('thanos.cfdata.org')
      || url.includes('prometheus-access.cfdata.org')
      || url.includes('prometheus.access.'))
    return 'thanos';
  return null;
}
```

### Time Parsing (per tool)

#### Grafana

Location: Query string `?from=X&to=Y`

```javascript
function parseGrafana(url) {
  const u = new URL(url);
  const from = u.searchParams.get('from');
  const to = u.searchParams.get('to');
  if (!from || !to) return null;
  return { from, to };
}
```

Values are either relative strings (`now-1h`, `now`) or epoch milliseconds
(`1705312800000`).

**Explore mode exception:** The `/explore` path uses a `left` query param
containing a URL-encoded JSON array where `[0]` is from and `[1]` is to.
Detected via `url.pathname.includes('/explore')`.

#### Kibana

Location: Hash fragment `#..._g=(...time:(from:X,to:Y)...)`

```javascript
function parseKibana(url) {
  const hash = decodeURIComponent(new URL(url).hash);
  const match = hash.match(/time:\(([^)]*)\)/);
  if (!match) return null;
  const from = match[1].match(/from:'?([^',)]+)/)?.[1];
  const to   = match[1].match(/to:'?([^',)]+)/)?.[1];
  return (from && to) ? { from, to } : null;
}
```

Time values are either relative (`now-1h`) or ISO 8601 strings
(`2024-01-15T10:00:00.000Z`), RISON-encoded inside `_g`.

#### Thanos / Prometheus

Location: Query string `?g0.range_input=X` (+ optional `g0.end_input=Y`)

```javascript
function parseThanos(url) {
  const u = new URL(url);
  const range = u.searchParams.get('g0.range_input');
  const end   = u.searchParams.get('g0.end_input');
  if (!range) return null;
  if (end) {
    const endMs  = Date.parse(end);
    const fromMs = endMs - durationToMs(range);
    return { from: String(fromMs), to: String(endMs) };
  }
  return { from: 'now-' + range, to: 'now' };
}
```

Thanos stores a lookback duration from an end point rather than a `from`/`to`
pair. Conversion requires computing one from the other.

### Canonical Time Format (internal)

All parsed times normalize to:

```javascript
{ from: String, to: String }
// from/to are either epoch ms strings or relative strings like "now-1h"
```

Clipboard format is `from|to`, e.g. `now-1h|now` or `1705312800000|1705316400000`.

### Time Writing (per tool)

#### Grafana

```javascript
function writeGrafana(url, time) {
  const u = new URL(url);
  if (u.pathname.includes('/explore')) {
    // update [0] and [1] in the `left` JSON array param
  }
  u.searchParams.set('from', toGrafanaFmt(time.from));  // epoch ms or relative
  u.searchParams.set('to',   toGrafanaFmt(time.to));
  return u.toString();
}
```

#### Kibana

```javascript
function writeKibana(url, time) {
  const u = new URL(url);
  const fs = isRelative(time.from) ? strip(time.from) : `'${toISO(time.from)}'`;
  const ts = isRelative(time.to)   ? strip(time.to)   : `'${toISO(time.to)}'`;
  const decoded = decodeURIComponent(u.hash);
  u.hash = decoded.replace(
    /time:\([^)]*\)/,
    `time:(from:${fs},to:${ts})`
  );
  return u.toString();
}
```

For relative: `time:(from:now-1h,to:now)` (no quotes).
For absolute ISO: `time:(from:'2024-01-15T10:00:00.000Z',to:'...')` (with quotes).

#### Thanos

```javascript
function writeThanos(url, time) {
  const u = new URL(url);
  const duration = msTodur(toMs(time.to) - toMs(time.from));
  for (let i = 0; i < 20; i++) {
    if (!u.searchParams.has(`g${i}.expr`) && !u.searchParams.has(`g${i}.range_input`)) break;
    u.searchParams.set(`g${i}.range_input`, duration);
    if (isRelative(time.from)) {
      u.searchParams.delete(`g${i}.end_input`);
    } else {
      u.searchParams.set(`g${i}.end_input`, toISOish(time.to));
    }
  }
  return u.toString();
}
```

Updates ALL panels (`g0`, `g1`, `g2`...) until a gap in the sequence.

### Apply Strategy (avoiding full reload)

| Tool | Strategy |
|:---|:---|
| Kibana | Set `window.location.hash` directly — Kibana watches hashchange and re-reads `_g` state, no reload |
| Grafana | Try `window.__grafanaRuntime.locationService.partial({from, to})` first (Grafana 10+). Fall back to `history.pushState` + popstate event. If Grafana doesn't react within 500ms, fall back to `location.replace()` |
| Thanos | `location.replace(newUrl)` — full replace, but preserves back button |

### Conversion Logic

| Source → Target | Conversion |
|:---|:---|
| Relative → Relative | Pass through directly (`now-1h` works everywhere) |
| Grafana absolute (epoch ms) → Kibana | `new Date(ms).toISOString()` |
| Grafana absolute (epoch ms) → Thanos | Compute duration + set `end_input` |
| Kibana absolute (ISO) → Grafana | `Date.parse(iso)` to epoch ms |
| Kibana absolute (ISO) → Thanos | Compute duration + set `end_input` |
| Thanos (duration + end) → Grafana | Compute `from = end - duration`, both as epoch ms |
| Thanos (duration + end) → Kibana | Compute `from = end - duration`, both as ISO |

Duration parsing helper (for Thanos `range_input` like `1h`, `30m`, `7d`):

```javascript
function durationToMs(dur) {
  const match = dur.match(/^(\d+)([smhd])$/);
  const unit = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return parseInt(match[1]) * unit[match[2]];
}
```

---

## Edge Cases

### Handled in v0

| Case | Behavior |
|:---|:---|
| **Kibana `goto` short links** | `detectTool` excludes URLs containing `/goto/` — overlay opens but shows "no time detected" |
| **Grafana explore mode** | Detected via `/explore` path, parses `left` JSON param for `[0]`/`[1]` time values |
| **Multiple Thanos panels** | Iterates `g0`, `g1`, `g2`... updating `range_input` on each until the sequence ends |
| **No time in URL** | Shows "no time detected", copy button disabled. Apply still works |
| **Overlay already open** | Second bookmarklet click removes the existing overlay before re-injecting |
| **Relative times** | Pass through as-is — all three tools understand `now-Xh` natively |

### Deferred

| Case | Notes |
|:---|:---|
| **Kibana `goto` links as targets** | Would need to resolve the redirect first, then rewrite |
| **Grafana snapshot/embedded URLs** | Different URL structure entirely |
| **Sync refresh interval** | Grafana has `refresh=10s`, Kibana has `refreshInterval` — could sync these too |
| **Non-cfdata.org instances** | Would need configurable domain list — out of scope for now |

---

## State and Storage

None. The bookmarklet is stateless — it reads the current URL, shows an overlay,
and either copies a string to clipboard or rewrites the current URL. No
persistence, no accounts, nothing stored between clicks.

---

## Testing Plan

See `test/smoke.md` for the manual smoke test checklist.

See `test/test.js` for the unit test suite (pure function coverage on `lib.js`).

### Test Matrix

| Source | Target | Time Type | Expected |
|:---|:---|:---|:---|
| Grafana (relative) | Kibana | `now-1h` / `now` | `time:(from:now-1h,to:now)` |
| Grafana (relative) | Thanos | `now-1h` / `now` | `g0.range_input=1h` |
| Grafana (absolute) | Kibana | epoch ms | ISO 8601 in `_g` |
| Grafana (absolute) | Thanos | epoch ms | duration + `end_input` |
| Kibana (relative) | Grafana | `now-7d` / `now` | `from=now-7d&to=now` |
| Kibana (relative) | Thanos | `now-7d` / `now` | `g0.range_input=7d` |
| Thanos (relative) | Grafana | `range_input=1h` | `from=now-1h&to=now` |
| Thanos (relative) | Kibana | `range_input=1h` | `time:(from:now-1h,to:now)` |
| Thanos (absolute) | Grafana | duration + end_input | epoch ms from/to |
| Thanos (absolute) | Kibana | duration + end_input | ISO 8601 from/to |

---

## Non-Goals (v0)

- Not a dashboard aggregator or log correlator
- Not syncing queries, filters, or any content — just the time window
- Not supporting tools outside Grafana/Kibana/Thanos
- Not touching anything inside the page DOM beyond injecting the overlay
