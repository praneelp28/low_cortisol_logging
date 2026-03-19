# low_cortisol_logging
don't get framemogged by UNIX

tiny chrome extension that syncs your time range across Grafana, Kibana, and Thanos/Prometheus tabs in one click. no more copy-pasting timestamps during incidents.

### install
1. `chrome://extensions` → developer mode on → **Load unpacked** → pick this folder
2. open some obs tabs
3. click the extension icon → **sync time**

### what it does
- reads the time window from your current tab
- detects all other open Grafana / Kibana / Thanos tabs
- rewrites their URLs to match — relative (`now-1h`) or absolute timestamps
- no data leaves your browser, no content scripts, just URL rewrites

### permissions
- **tabs** — needed to scan all open tabs for observability tool URLs
- **activeTab** — needed to read the active tab on click
