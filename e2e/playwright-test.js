const { chromium } = require('playwright');

(async () => {
  const BASE = 'https://expense-tracker-prod-df355.web.app';
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ timeout: 120000 });

  try {
    console.log('Navigating to', BASE);
    await page.goto(BASE, { waitUntil: 'networkidle' });

    page.on('console', msg => console.log('PAGE LOG>', msg.text()));
    page.on('pageerror', err => console.error('PAGE ERROR>', err));

    // Ensure register form is visible (use showRegister button)
    const showRegister = await page.$('#showRegister');
    if (showRegister) {
      await showRegister.click();
      await page.waitForSelector('#registerUsername', { state: 'visible' });
    }

    const timestamp = Date.now();
    const email = `e2e+${timestamp}@example.com`;
    const password = 'TestPass123!';

    console.log('Filling registration form with', email);
    await page.fill('#registerUsername', email);
    await page.fill('#registerPassword', password);

    // Submit registration
    await page.click('#registerBtn');

    // wait a short while for client-side work, then capture diagnostics
    await page.waitForTimeout(2000);
    // capture localStorage state
    const lsAuth = await page.evaluate(() => ({ authToken: localStorage.getItem('authToken'), currentUser: localStorage.getItem('currentUser') }));
    console.log('Post-register localStorage:', lsAuth);
    // save a screenshot for inspection
    await page.screenshot({ path: 'e2e/register-after-click.png', fullPage: true });

    // Wait for auth:ready custom event to trigger UI change (app visible)
    // Since custom event occurs in page context, wait for #app to become visible
    await page.waitForSelector('#app:not(.hidden)', { timeout: 30000 });
    console.log('App visible after registration');

    // Check localStorage token
    const authToken = await page.evaluate(() => localStorage.getItem('authToken'));
    const userSnapshot = await page.evaluate(() => localStorage.getItem('currentUser'));

    console.log('LocalStorage authToken present:', !!authToken);
    console.log('LocalStorage currentUser:', userSnapshot);

    // Call protected API from the page context to use same-origin cookies/headers
    const apiStatus = await page.evaluate(async () => {
      const token = localStorage.getItem('authToken');
      if (!token) return { status: 'no-token' };
      try {
        const res = await fetch('/api/expenses', { method: 'GET', headers: { 'Authorization': `Bearer ${token}` } });
        const ct = res.headers.get('content-type') || '';
        const body = ct.includes('application/json') ? await res.json() : await res.text();
        return { status: res.status, body };
      } catch (err) {
        return { status: 'fetch-error', error: String(err) };
      }
    });

    console.log('Protected API status from page:', apiStatus.status);
    console.log('Protected API body sample:', Array.isArray(apiStatus.body) ? `${apiStatus.body.length} items` : String(apiStatus.body).slice(0, 200));

    await browser.close();
    process.exit(0);
  } catch (err) {
    console.error('E2E test failed:', err);
    try { await browser.close(); } catch(e){}
    process.exit(2);
  }
})();
