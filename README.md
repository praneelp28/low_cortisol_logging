# low_cortisol_logging
don't get framemogged by UNIX

tiny chrome extension that syncs your time range across Grafana, Kibana, and Thanos/Prometheus tabs in one click. no more copy-pasting timestamps during incidents.

### install
1. `chrome://extensions` → developer mode on → **Load unpacked** → pick this folder
2. open some obs tabs
3. click the extension icon → **sync time**

### how it works

each observability tool stores its time range in the URL differently:

- **Grafana** puts `from` and `to` in the query string as epoch milliseconds or relative strings (`now-1h`)
- **Kibana** buries `time:(from:...,to:...)` inside RISON-encoded state in the URL hash fragment
- **Thanos/Prometheus** uses `g0.range_input=1h` (a lookback duration) plus an optional `g0.end_input`

when you click sync, the extension reads the time from your active tab, converts it to each target tool's format, and rewrites their URLs via `chrome.tabs.update()`. the target tabs navigate to the new URL and reload with the synced time. no content scripts, no page injection — just URL surgery.

relative times like `now-1h` pass through directly since all three tools understand them. absolute times get converted between epoch ms (Grafana), ISO 8601 (Kibana), and duration + end time (Thanos).

### files

```
lib.js         — detection, parsing, conversion, writing (pure functions, no browser APIs)
popup.js       — popup UI wiring + chrome.tabs calls
popup.html     — popup markup
popup.css      — popup styles
manifest.json  — extension config
```


### permissions
- **tabs** — scan all open tabs for obs tool URLs
- **activeTab** — read the active tab on click
