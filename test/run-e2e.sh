#!/bin/bash
# Run e2e tests with your real Chrome profile (must close Chrome first!)
#
# Usage:
#   1. Quit Chrome completely (Cmd+Q)
#   2. Run: bash context/run-e2e.sh
#   3. Watch the puppeteer browser — it should auto-auth via your CF Access sessions
#   4. Tests will verify bookmarklet works on real Grafana/Kibana/Thanos pages

# Swap to real profile for auth
export LCL_CHROME_PROFILE="$HOME/Library/Application Support/Google/Chrome"

# Check Chrome isn't running
if pgrep -f "Google Chrome" > /dev/null; then
  echo "Chrome is still running! Please quit Chrome first (Cmd+Q)."
  exit 1
fi

echo "Running e2e tests with your Chrome profile..."
node --test context/e2e.js
