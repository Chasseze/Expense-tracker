const { chromium } = require('playwright');
const fs = require('fs');

const BASE = process.argv[2] || process.env.BASE_URL || 'https://expense-tracker-prod-df355.web.app';

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('console', msg => console.log('PAGE LOG>', msg.type(), msg.text()));
  page.on('pageerror', err => console.error('PAGE ERROR>', err));

  const testEmail = `e2e+${Date.now()}@example.com`;
  const testPassword = 'TestPass123!';

  try {
    console.log('Opening app...', BASE);
    await page.goto(BASE, { waitUntil: 'networkidle' });

    // If testing locally, enable client local-only mode so mocked auth is used and no real Firebase calls are made.
    if (BASE.includes('localhost') || BASE.includes('127.0.0.1')) {
      await page.evaluate(() => localStorage.setItem('localOnly', '1'));
      await page.reload({ waitUntil: 'networkidle' });
      console.log('Local-only client mode enabled');
    }

    // Ensure firebase initialized (listen to window.firebaseInitPromise)
    const initOk = await page.evaluate(() => {
      return !!(window.firebaseInitPromise || window.firebaseInitPromise === null);
    });
    console.log('Init promise present:', initOk);

    // Show register form and fill
    await page.click('#showRegister');
    await page.fill('#registerUsername', testEmail);
    await page.fill('#registerPassword', testPassword);

    // Click register and wait for localStorage currentUser to appear
    await Promise.all([
      page.click('#registerBtn'),
      page.waitForFunction(() => !!localStorage.getItem('currentUser'), { timeout: 15000 })
    ]);

    console.log('Registration appears to have completed.');

    // Take screenshot of app after login
    const screenshotPath = `./playwright-smoke-${Date.now()}.png`;
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log('Screenshot saved to', screenshotPath);

    // Retrieve stored auth token and user
    const stored = await page.evaluate(() => ({ token: localStorage.getItem('authToken'), user: JSON.parse(localStorage.getItem('currentUser') || 'null') }));
    console.log('Stored auth snapshot:', stored.user ? stored.user.email : stored.user, 'token length:', stored.token ? stored.token.length : 0);

    // Call protected API from the page context
    const apiResult = await page.evaluate(async () => {
      const token = localStorage.getItem('authToken');
      const res = await fetch('/api/expenses', { headers: { Authorization: `Bearer ${token}` } });
      const ct = res.headers.get('content-type') || '';
      const body = ct.includes('application/json') ? await res.json() : await res.text();
      return { status: res.status, body };
    });

    console.log('Protected API call result:', apiResult.status);
    if (typeof apiResult.body === 'object') {
      console.log('Protected API body (len):', Array.isArray(apiResult.body) ? apiResult.body.length : JSON.stringify(apiResult.body).length);
    }

    // Save a short report
    const report = {
      url: BASE,
      email: testEmail,
      apiStatus: apiResult.status,
      user: stored.user
    };
    fs.writeFileSync('./playwright-smoke-report.json', JSON.stringify(report, null, 2));
    console.log('Report written to playwright-smoke-report.json');

    await browser.close();
    return 0;
  } catch (err) {
    console.error('Smoke test failed:', err);
    try { await browser.close(); } catch (e) {}
    return 1;
  }
}

if (require.main === module) {
  run().then(code => process.exit(code)).catch(err => { console.error(err); process.exit(1); });
}
