# Spec: Low Cortisol Logging — Observability Time Sync Extension

## Problem

An engineer debugging an incident has Grafana, Kibana, and Thanos/Prometheus
open in different tabs. They zoom into a suspicious 20-minute window on Grafana.
Now they have to manually replicate that exact time range in Kibana and Thanos —
different URL schemes, different formats, different locations in the URL. It's
tedious, error-prone, and breaks flow.

## Solution

A Chrome extension that reads the time range from your current observability tab
and propagates it to all your other open observability tabs in one click.

---

## UX

### Primary Flow

```
1. Engineer is on a Grafana dashboard, zoomed to a time range of interest
2. They click the extension icon in the toolbar
3. A popup appears showing:
   - Source: "Grafana — last 1h (now-1h → now)"  [the active tab]
   - Targets: "Kibana (Tab 3)", "Thanos (Tab 7)"  [auto-detected]
4. Engineer clicks "Sync"
5. Target tabs update to the same time range
6. Popup briefly shows "Synced 2 tabs" then closes
```

### Popup Layout (rough sketch)

```
┌─────────────────────────────────┐
│  ⏱ Low Cortisol Logging        │
├─────────────────────────────────┤
│                                 │
│  SOURCE (active tab)            │
│  ┌───────────────────────────┐  │
│  │ Grafana                   │  │
│  │ now-1h → now              │  │
│  └───────────────────────────┘  │
│                                 │
│  TARGETS (detected tabs)        │
│  ☑ Kibana — Tab 3              │
│  ☑ Thanos — Tab 7              │
│  ☐ Grafana — Tab 12 (other)    │
│                                 │
│  ┌───────────────────────────┐  │
│  │         Sync Time         │  │
│  └───────────────────────────┘  │
│                                 │
└─────────────────────────────────┘
```

### Design Decisions

| Decision | Choice | Rationale |
|:---|:---|:---|
| Trigger | Click extension icon (browser action popup) | Always available, low friction, no conflict with app shortcuts |
| Direction | Active tab → other tabs (one-way) | Intuitive: "I'm looking at this, push it everywhere" |
| Target selection | All obs tabs checked by default, user can uncheck | Opt-out is faster than opt-in for the common case |
| Feedback | Inline confirmation in popup | No toasts/alerts to dismiss, stays clean |
| Keyboard shortcut | Ctrl+Shift+S (configurable) | Power users can skip the popup entirely |

### What if the active tab isn't an observability tool?

The popup shows "No time range detected on this tab" with a list of detected
obs tabs below. No sync button. Keeps it simple — the user just switches to the
tab they want to sync FROM and clicks again.

---

## Technical Architecture

### Extension Structure (Manifest V3)

```
low_cortisol_logging/
├── manifest.json        # Extension manifest (V3)
├── background.js        # Service worker: tab queries, URL updates
├── popup.html           # Popup UI
├── popup.js             # Popup logic: display state, handle sync click
├── popup.css            # Popup styles
├── lib/
│   ├── detect.js        # Detect which tool a URL belongs to
│   ├── parse.js         # Extract time range from a URL (per tool)
│   ├── convert.js       # Normalize + convert time between formats
│   └── write.js         # Produce a new URL with updated time (per tool)
├── icons/               # Extension icons (16, 48, 128)
├── context/             # Research docs (not shipped)
└── spec.md              # This file (not shipped)
```

### Approach: URL-Only (No Content Scripts)

We do NOT inject content scripts. Everything is done via URL manipulation.

- **Read:** `chrome.tabs.query()` to get all tab URLs, parse time from URL strings
- **Write:** `chrome.tabs.update(tabId, { url: newUrl })` to navigate the tab

**Why URL-only:**
- No Same-Origin-Policy headaches
- No content script injection permissions needed
- No risk of breaking app-internal JS state
- Grafana, Kibana, and Thanos are all URL-driven — the URL IS the state
- Simpler to build, test, and debug

**Tradeoff:** Tab will navigate (soft reload). Acceptable because:
- These apps restore full state from the URL
- It's exactly what the user does when they manually edit the URL bar
- Grafana and Kibana both handle URL-driven navigation gracefully

### Tab Detection

```javascript
function detectTool(url) {
  if (url.includes('grafana.cfdata.org') || url.includes('grafana.cloudflare.com'))
    return 'grafana';
  if (url.includes('kibana.cfdata.org'))
    return 'kibana';
  if (url.includes('metrics.cfdata.org') || url.includes('thanos.cfdata.org')
      || url.includes('prometheus-access.cfdata.org')
      || url.includes('prometheus.access.'))
    return 'thanos';
  return null;
}
```

Scan ALL tabs across ALL windows. Only include tabs where `detectTool` returns
non-null.

### Time Parsing (per tool)

#### Grafana

Location: Query string `?from=X&to=Y`

```javascript
function parseGrafana(url) {
  const u = new URL(url);
  const from = u.searchParams.get('from');
  const to = u.searchParams.get('to');
  if (!from || !to) return null;
  return { from, to, type: isRelative(from) ? 'relative' : 'absolute' };
}
```

Values are either relative strings (`now-1h`, `now`) or epoch milliseconds
(`1705312800000`).

**Explore mode exception:** The `/explore` path uses a `left` query param
containing a URL-encoded JSON array where `[0]` is from and `[1]` is to.
Detect via `url.pathname.includes('/explore')`.

#### Kibana

Location: Hash fragment `#..._g=(...time:(from:X,to:Y)...)`

```javascript
function parseKibana(url) {
  const hash = new URL(url).hash;
  const match = hash.match(/time:\(from:'?(.*?)'?,to:'?(.*?)'?\)/);
  if (!match) return null;
  return { from: match[1], to: match[2], type: isRelative(match[1]) ? 'relative' : 'absolute' };
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
  const end = u.searchParams.get('g0.end_input');  // optional
  if (!range) return null;
  return {
    from: null,         // computed: end - duration
    to: end || 'now',
    duration: range,    // e.g. "1h"
    type: end ? 'absolute' : 'relative'
  };
}
```

Thanos doesn't have a `from`/`to` pair — it has a lookback duration from an
end point. This is a different mental model so conversion requires special care.

### Canonical Time Format (internal)

All parsed times get normalized to:

```javascript
{
  from: Number | String,  // epoch ms or relative string like "now-1h"
  to:   Number | String,  // epoch ms or relative string like "now"
  type: 'relative' | 'absolute'
}
```

**Strategy:** Prefer relative strings when both source and target support them.
Only convert to absolute when necessary. Relative times are more portable and
avoid clock-skew issues.

### Time Writing (per tool)

#### Grafana

```javascript
function writeGrafana(url, time) {
  const u = new URL(url);
  if (u.pathname.includes('/explore')) {
    // Handle explore mode JSON array in `left` param
    return writeGrafanaExplore(u, time);
  }
  u.searchParams.set('from', formatGrafana(time.from));  // epoch ms or relative
  u.searchParams.set('to', formatGrafana(time.to));
  return u.toString();
}
```

#### Kibana

```javascript
function writeKibana(url, time) {
  const u = new URL(url);
  const from = formatKibana(time.from);  // relative string or ISO with quotes
  const to = formatKibana(time.to);
  // Regex replace time in _g within hash
  u.hash = u.hash.replace(
    /time:\(from:'?.*?'?,to:'?.*?'?\)/,
    `time:(from:${from},to:${to})`
  );
  return u.toString();
}
```

For relative strings: `time:(from:now-1h,to:now)` (no quotes).
For absolute ISO: `time:(from:'2024-01-15T10:00:00.000Z',to:'...')` (with quotes).

#### Thanos

```javascript
function writeThanos(url, time) {
  const u = new URL(url);
  const duration = toDuration(time.from, time.to);  // calculate or passthrough

  // Update ALL panels (g0, g1, g2, ...)
  for (let i = 0; u.searchParams.has(`g${i}.expr`); i++) {
    u.searchParams.set(`g${i}.range_input`, duration);
    if (time.type === 'absolute') {
      u.searchParams.set(`g${i}.end_input`, toISOish(time.to));
    } else {
      u.searchParams.delete(`g${i}.end_input`);
    }
  }
  return u.toString();
}
```

### Conversion Logic

| Source → Target | Conversion |
|:---|:---|
| Relative → Relative | Pass through directly (`now-1h` works everywhere) |
| Grafana absolute (epoch ms) → Kibana | `new Date(ms).toISOString()` |
| Grafana absolute (epoch ms) → Thanos | Compute duration + set `end_input` |
| Kibana absolute (ISO) → Grafana | `Date.parse(iso)` → epoch ms |
| Kibana absolute (ISO) → Thanos | Compute duration + set `end_input` |
| Thanos (duration + end) → Grafana | Compute `from = end - duration`, both as epoch ms |
| Thanos (duration + end) → Kibana | Compute `from = end - duration`, both as ISO |

Duration parsing helper (for Thanos `range_input` like `1h`, `30m`, `7d`):

```javascript
function durationToMs(dur) {
  const match = dur.match(/^(\d+)([smhd])$/);
  const n = parseInt(match[1]);
  const unit = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return n * unit[match[2]];
}
```

---

## Edge Cases

### Handled in v1

| Case | Behavior |
|:---|:---|
| **Kibana `goto` short links** | Cannot parse time. Show tab in popup as "Kibana (short link — can't sync)" and skip it as a source. Can still be a target (we construct a new discover URL? or skip). For v1: skip as both source and target, show note. |
| **Grafana explore mode** | Detect via `/explore` path, parse `left` JSON param for `[0]`/`[1]` time values. Handled separately from dashboard mode. |
| **Multiple Thanos panels** | Iterate `g0`, `g1`, `g2`... updating `range_input` on each until no more `gN.expr` params exist. |
| **No time in URL** | Grafana dashboards can omit `from`/`to` (uses dashboard default). Cannot parse → show "No time range in URL" and skip as source. As a target, append `?from=...&to=...` which overrides the default. |
| **Multiple tabs of same tool** | All obs tabs shown in target list. User can uncheck any they don't want synced. |
| **Tabs across windows** | Scan all windows. Sync works across windows. |
| **Active tab is not an obs tool** | Popup says "No time range detected." No sync button. Just shows detected obs tabs for awareness. |

### Deferred to v2

| Case | Notes |
|:---|:---|
| **Kibana `goto` links as targets** | Would need to resolve the redirect first, then rewrite the resolved URL. Complex. |
| **Grafana snapshot/embedded URLs** | Different URL structure entirely. |
| **Manual time input** | Let user type a custom time range into the popup instead of pulling from a tab. |
| **Sync refresh interval** | Grafana has `refresh=10s`, Kibana has `refreshInterval`. Could sync these too. |
| **Undo** | Cache previous URLs so user can revert. |
| **Non-cfdata.org instances** | Support custom domain configuration for non-Cloudflare users. |

---

## Permissions

```json
{
  "permissions": ["tabs", "activeTab"],
  "host_permissions": [
    "*://*.cfdata.org/*",
    "*://*.cloudflare.com/*",
    "*://*.cfplat.com/*"
  ]
}
```

- `tabs`: Read URLs of all tabs to detect observability tools
- `activeTab`: Access the active tab on click
- `host_permissions`: Required to update URLs on these domains via `chrome.tabs.update`

No `content_scripts` permission needed. No remote code. No data leaves the browser.

---

## State & Storage

None for v1. The extension is stateless — it reads URLs, transforms them, and
writes them back. No persistent storage, no sync, no accounts.

Future: Could store user preferences (default targets, custom domains, shortcut
config) in `chrome.storage.local`.

---

## Testing Plan

### Manual Test with the 1:1:1 Trio

1. Open all three test URLs from `context/examples.md`
2. On the Grafana tab, change time to `now-6h` via the Grafana UI
3. Click extension → Sync
4. Verify Kibana tab now shows `time:(from:now-6h,to:now)` in its URL hash
5. Verify Thanos tab now shows `g0.range_input=6h` in its URL

### Test Matrix

| Source | Target | Time Type | Expected |
|:---|:---|:---|:---|
| Grafana (relative) | Kibana | `now-1h` → `now` | `time:(from:now-1h,to:now)` |
| Grafana (relative) | Thanos | `now-1h` → `now` | `g0.range_input=1h` |
| Grafana (absolute) | Kibana | epoch ms | ISO 8601 in `_g` |
| Grafana (absolute) | Thanos | epoch ms | duration + `end_input` |
| Kibana (relative) | Grafana | `now-7d` → `now` | `from=now-7d&to=now` |
| Kibana (relative) | Thanos | `now-7d` → `now` | `g0.range_input=7d` |
| Thanos (relative) | Grafana | `range_input=1h` | `from=now-1h&to=now` |
| Thanos (relative) | Kibana | `range_input=1h` | `time:(from:now-1h,to:now)` |
| Thanos (absolute) | Grafana | duration + end_input | epoch ms from/to |
| Thanos (absolute) | Kibana | duration + end_input | ISO 8601 from/to |

---

## Non-Goals (v1)

- **Not** a dashboard aggregator or log correlator
- **Not** syncing queries, filters, or any content — just the time window
- **Not** supporting tools outside Grafana/Kibana/Thanos (Sentry, ClickHouse, Jaeger, etc.)
- **Not** available on the Chrome Web Store — internal sideload only
- **Not** modifying anything inside the page DOM — URL-only approach

---

## Open Questions

1. **Should the popup auto-close after sync?** Leaning yes with a brief delay
   so the user sees confirmation.

2. **What about Grafana's `orgId` parameter?** Should we preserve it when
   writing? Yes — we only touch `from`/`to`, leave everything else in the URL
   untouched.

3. **Chrome vs Firefox?** Manifest V3 is Chrome-first. Firefox support is a v2
   concern. The APIs are nearly identical.

4. **Should we show a badge count on the icon?** Could show number of detected
   obs tabs. Nice quality-of-life but not critical for v1.
