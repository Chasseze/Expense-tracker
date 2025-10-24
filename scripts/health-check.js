(async () => {
  const base = 'http://localhost:3000';
  const out = (label, v) => console.log(label + ':', v);
  try {
    // /api/status
    const s = await fetch(base + '/api/status');
    out('/api/status status', s.status);
    const statusJson = await s.json().catch(() => null);
    out('/api/status body', JSON.stringify(statusJson));

    // /api/expenses (protected) - server should accept since dev auth can be disabled
    const e = await fetch(base + '/api/expenses');
    out('/api/expenses status', e.status);
    const eBody = await e.text();
    out('/api/expenses body (first 100 chars)', eBody.slice(0, 100));

    // root
    const r = await fetch(base + '/');
    out('/ root status', r.status);
    const rText = await r.text();
    out('/ root length', rText.length);

    process.exit(0);
  } catch (err) {
    console.error('Health check failed:', err.message);
    process.exit(2);
  }
})();