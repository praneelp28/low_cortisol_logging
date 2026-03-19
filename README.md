# low_cortisol_logging
don't get framemogged by UNIX

tiny tool that syncs your time range across Grafana, Kibana, and Thanos/Prometheus tabs. no more copy-pasting timestamps during incidents.

### install (bookmarklet — no permissions needed)
1. open `bookmarklet.html` in Chrome
2. drag the link to your bookmarks bar
3. done

### usage
1. on your **source** obs tab: click the bookmarklet → **copy time**
2. switch to your **target** obs tab: click the bookmarklet → **paste** → **apply**
3. page reloads with the synced time range

### what it does
- reads the time window from the current page's URL
- converts between Grafana (epoch ms), Kibana (RISON/ISO), and Thanos (duration) formats
- rewrites the URL and reloads — relative (`now-1h`) or absolute timestamps
- no data leaves your browser, nothing installed, just a bookmark

### alt install (chrome extension — needs developer mode)
if your org allows sideloading extensions, this is the one-click version:
1. `chrome://extensions` → developer mode on → **Load unpacked** → pick this folder
2. open some obs tabs
3. click the extension icon → **sync time**
