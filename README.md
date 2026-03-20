# low_cortisol_logging
don't get framemogged by UNIX

bookmarklet that syncs time ranges across Grafana, Kibana, and Thanos/Prometheus tabs. no more copy-pasting timestamps during incidents.

### install
1. open `bookmarklet.html` in your browser
2. drag the button to your bookmarks bar
3. no extension, no install, nothing to approve

### usage
1. on any grafana/kibana/thanos tab, click the bookmark
2. hit **copy time** — writes `from|to` to your clipboard
3. switch to another obs tab, click the bookmark again
4. paste into the input and hit **apply**

### how it works

each observability tool stores its time range in the URL differently:

- **Grafana** puts `from` and `to` in the query string as epoch milliseconds or relative strings (`now-1h`)
- **Kibana** buries `time:(from:...,to:...)` inside RISON-encoded state in the URL hash fragment
- **Thanos/Prometheus** uses `g0.range_input=1h` (a lookback duration) plus an optional `g0.end_input`

clicking the bookmark injects a small overlay UI into the current page. it reads the time range from the URL, lets you copy it as a `from|to` string, and rewrites the URL when you apply a pasted time. all the logic lives inside the `javascript:` URI stored in the bookmark itself, so there's no server, no extension, no file on disk.

relative times like `now-1h` pass through directly since all three tools understand them. absolute times get converted between epoch ms (Grafana), ISO 8601 (Kibana), and duration + end time (Thanos).

applying tries to avoid a full reload where possible: Kibana swaps the hash fragment, Grafana tries its internal `locationService` first and falls back to `location.replace()`, Thanos does a full replace.

### files

```
index.html       drag-to-install page
lib.js           detection, parsing, conversion (pure functions, no browser APIs)
```
