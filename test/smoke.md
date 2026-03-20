# smoke test (2 min)

open 3 tabs:
1. any Grafana dashboard
2. any Kibana discover view
3. any Thanos/Prometheus query

then:
- [ ] on Grafana, change time to `last 6 hours` via the UI
- [ ] click the extension → verify it shows "Grafana: now-6h → now"
- [ ] check Kibana and Thanos targets are listed
- [ ] click **sync time**
- [ ] verify Kibana reloads and shows a 6h window
- [ ] verify Thanos reloads and shows `range_input=6h` in the URL
- [ ] repeat from Kibana as source → sync to Grafana
- [ ] try an absolute range: drag-select a window on Grafana, then sync
- [ ] test "open new" mode — verify new tabs open instead of replacing
