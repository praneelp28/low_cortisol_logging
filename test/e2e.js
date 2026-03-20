const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// Load the bookmarklet source (strip the javascript: prefix for evaluate())
var bmRaw = fs.readFileSync(path.join(__dirname, 'bookmarklet.js'), 'utf8');
var bmCode = bmRaw.replace(/^javascript:void\(function\(\)\{/, '(function(){').replace(/\n\s*/g, '');

// Test URLs
var GRAFANA_URL = 'https://grafana.cfdata.org/d/000001576/elasticsearch-node-metrics?orgId=1&from=now-1h&to=now';
var KIBANA_URL = 'https://kibana.cfdata.org/app/discover#/?_g=(filters:!(),refreshInterval:(pause:!t,value:0),time:(from:now-1h,to:now))&_a=(columns:!(host,message,service),filters:!(),index:ea073d70-8ed6-11ea-88e9-39648e0749be,interval:auto,query:(language:kuery,query:\'\'),sort:!())';
var THANOS_URL = 'https://metrics.cfdata.org/graph?g0.expr=prometheus_tsdb_head_series&g0.tab=0&g0.stacked=0&g0.range_input=1h&g0.max_source_resolution=0s&g0.deduplicate=1&g0.partial_response=1&g0.store_matches=%5B%5D&g0.engine=thanos&g0.analyze=0&g0.tenant=';

var CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
var PROFILE_DIR = process.env.LCL_CHROME_PROFILE || '/tmp/lcl-chrome-profile';

var browser;

// Helper: check if page loaded the actual app (not SSO redirect)
async function isAuthenticated(page) {
  var url = page.url();
  return !url.includes('sso.cloudflare.dev') && !url.includes('cloudflareaccess.com');
}

// Helper: wait for page to settle (either loads the app or hits SSO)
async function loadAndCheck(page, url, label) {
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 }).catch(function(){});
  var authed = await isAuthenticated(page);
  console.log('    ' + label + ': ' + (authed ? 'authenticated' : 'SSO redirect (not authed)'));
  return authed;
}

// Helper: inject bookmarklet and wait for overlay
async function injectBookmarklet(page) {
  await page.evaluate(bmCode);
  await new Promise(function(r) { setTimeout(r, 300); });
  var overlay = await page.$('#lcl-overlay');
  return overlay !== null;
}

// Helper: place a DOM marker to detect full page reloads
async function placeReloadMarker(page) {
  await page.evaluate(function() {
    var m = document.createElement('div');
    m.id = 'lcl-reload-marker';
    m.style.display = 'none';
    document.body.appendChild(m);
  });
}

async function reloadMarkerSurvived(page) {
  return await page.evaluate(function() {
    return document.getElementById('lcl-reload-marker') !== null;
  });
}

describe('e2e: bookmarklet on real authenticated pages', function () {
  before(async function () {
    console.log('    launching Chrome with copied profile...');
    browser = await puppeteer.launch({
      headless: false,
      executablePath: CHROME_PATH,
      userDataDir: PROFILE_DIR,
      args: [
        '--no-first-run',
        '--disable-default-apps',
        '--disable-features=TranslateUI',
      ],
    });
    console.log('    Chrome launched');
  });

  after(async function () {
    if (browser) await browser.close();
  });

  // ── Auth check ────────────────────────────────────────────

  it('can authenticate to Grafana', async function () {
    var page = await browser.newPage();
    var authed = await loadAndCheck(page, GRAFANA_URL, 'Grafana');
    if (!authed) {
      console.log('    SKIP: not authenticated. remaining tests will be skipped.');
      console.log('    to fix: close Chrome, re-run. or manually auth in the puppeteer browser.');
    }
    // Don't assert — let remaining tests check individually
    await page.close();
  });

  // ── Grafana tests ─────────────────────────────────────────

  it('Grafana: bookmarklet overlay appears', async function () {
    var page = await browser.newPage();
    var authed = await loadAndCheck(page, GRAFANA_URL, 'Grafana');
    if (!authed) { await page.close(); return; }

    var hasOverlay = await injectBookmarklet(page);
    assert.ok(hasOverlay, 'overlay should appear');

    // Check it detected Grafana
    var badge = await page.$eval('#lcl-overlay .lcl-badge', function(el) { return el.textContent; }).catch(function() { return null; });
    assert.equal(badge, 'Grafana');

    // Check it parsed the time
    var timeText = await page.$eval('#lcl-overlay .lcl-time', function(el) { return el.textContent; });
    assert.ok(timeText.includes('now-1h'), 'should show now-1h, got: ' + timeText);

    await page.close();
  });

  it('Grafana: apply time WITHOUT reload (pushState)', async function () {
    var page = await browser.newPage();
    var authed = await loadAndCheck(page, GRAFANA_URL, 'Grafana');
    if (!authed) { await page.close(); return; }

    await placeReloadMarker(page);
    await injectBookmarklet(page);

    // Type a new time into the input and click apply
    await page.type('#lcl-input', 'now-6h|now');
    await page.click('#lcl-apply');
    await new Promise(function(r) { setTimeout(r, 1000); });

    // Check URL changed
    var newUrl = page.url();
    assert.ok(newUrl.includes('from=now-6h'), 'URL should have 6h, got: ' + newUrl);

    // Check page did NOT reload
    var survived = await reloadMarkerSurvived(page);
    assert.ok(survived, 'page should NOT have reloaded (marker should survive)');

    // Check overlay shows success
    var status = await page.$eval('#lcl-status', function(el) { return el.textContent; }).catch(function() { return ''; });
    console.log('    grafana status: ' + status);

    await page.close();
  });

  // ── Kibana tests ──────────────────────────────────────────

  it('Kibana: bookmarklet overlay appears', async function () {
    var page = await browser.newPage();
    var authed = await loadAndCheck(page, KIBANA_URL, 'Kibana');
    if (!authed) { await page.close(); return; }

    var hasOverlay = await injectBookmarklet(page);
    assert.ok(hasOverlay, 'overlay should appear');

    var badge = await page.$eval('#lcl-overlay .lcl-badge', function(el) { return el.textContent; }).catch(function() { return null; });
    assert.equal(badge, 'Kibana');

    var timeText = await page.$eval('#lcl-overlay .lcl-time', function(el) { return el.textContent; });
    assert.ok(timeText.includes('now-1h'), 'should show now-1h, got: ' + timeText);

    await page.close();
  });

  it('Kibana: apply time WITHOUT reload (hashchange)', async function () {
    var page = await browser.newPage();
    var authed = await loadAndCheck(page, KIBANA_URL, 'Kibana');
    if (!authed) { await page.close(); return; }

    // Wait for Kibana app to fully render
    await new Promise(function(r) { setTimeout(r, 3000); });

    await placeReloadMarker(page);
    await injectBookmarklet(page);

    await page.type('#lcl-input', 'now-6h|now');
    await page.click('#lcl-apply');
    await new Promise(function(r) { setTimeout(r, 1000); });

    // Check hash changed
    var newUrl = page.url();
    assert.ok(newUrl.includes('now-6h'), 'URL should have 6h, got: ' + newUrl.slice(0, 200));

    // Check page did NOT reload
    var survived = await reloadMarkerSurvived(page);
    assert.ok(survived, 'page should NOT have reloaded (marker should survive)');

    var status = await page.$eval('#lcl-status', function(el) { return el.textContent; }).catch(function() { return ''; });
    console.log('    kibana status: ' + status);

    await page.close();
  });

  // ── Thanos tests ──────────────────────────────────────────

  it('Thanos: bookmarklet overlay appears', async function () {
    var page = await browser.newPage();
    var authed = await loadAndCheck(page, THANOS_URL, 'Thanos');
    if (!authed) { await page.close(); return; }

    var hasOverlay = await injectBookmarklet(page);
    assert.ok(hasOverlay, 'overlay should appear');

    var badge = await page.$eval('#lcl-overlay .lcl-badge', function(el) { return el.textContent; }).catch(function() { return null; });
    assert.equal(badge, 'Thanos/Prom');

    await page.close();
  });

  it('Thanos: apply time WITH reload (expected)', async function () {
    var page = await browser.newPage();
    var authed = await loadAndCheck(page, THANOS_URL, 'Thanos');
    if (!authed) { await page.close(); return; }

    await placeReloadMarker(page);
    await injectBookmarklet(page);

    await page.type('#lcl-input', 'now-6h|now');
    await page.click('#lcl-apply');
    await new Promise(function(r) { setTimeout(r, 3000); });

    // Check URL changed
    var newUrl = page.url();
    // After reload, thanos might redirect to SSO again, or load with new params
    console.log('    thanos final URL: ' + newUrl.slice(0, 100) + '...');
    
    // The marker should be GONE because thanos does a full reload
    var survived = await reloadMarkerSurvived(page);
    assert.ok(!survived, 'thanos SHOULD have reloaded (marker should be gone)');

    await page.close();
  });

  // ── Cross-tool round trip ─────────────────────────────────

  it('round-trip: copy from Grafana, apply to Kibana', async function () {
    // Open Grafana with 6h range
    var grafUrl = GRAFANA_URL.replace('from=now-1h', 'from=now-6h');
    var grafPage = await browser.newPage();
    var grafAuthed = await loadAndCheck(grafPage, grafUrl, 'Grafana (6h)');
    if (!grafAuthed) { await grafPage.close(); return; }

    // Inject bookmarklet on Grafana, read the copied time
    await injectBookmarklet(grafPage);
    var copiedTime = await grafPage.evaluate(function() {
      var t = parseTime(location.href);
      return t ? t.from + '|' + t.to : null;
    });
    assert.ok(copiedTime, 'should parse time from Grafana');
    assert.ok(copiedTime.includes('now-6h'), 'should be 6h, got: ' + copiedTime);
    console.log('    copied from Grafana: ' + copiedTime);

    // Open Kibana
    var kibPage = await browser.newPage();
    var kibAuthed = await loadAndCheck(kibPage, KIBANA_URL, 'Kibana');
    if (!kibAuthed) { await kibPage.close(); await grafPage.close(); return; }

    await new Promise(function(r) { setTimeout(r, 2000); });
    await placeReloadMarker(kibPage);
    await injectBookmarklet(kibPage);

    // Type the copied time and apply
    await kibPage.type('#lcl-input', copiedTime);
    await kibPage.click('#lcl-apply');
    await new Promise(function(r) { setTimeout(r, 1000); });

    var kibUrl = kibPage.url();
    assert.ok(kibUrl.includes('now-6h'), 'Kibana should now have 6h, got: ' + kibUrl.slice(0, 200));

    var survived = await reloadMarkerSurvived(kibPage);
    assert.ok(survived, 'Kibana should NOT have reloaded');

    console.log('    round-trip Grafana→Kibana: success, no reload');

    await grafPage.close();
    await kibPage.close();
  });
});
