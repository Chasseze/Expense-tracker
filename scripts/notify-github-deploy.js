// Notify GitHub repository_dispatch that hosting deploy finished.
// Requires Node 18+ (global fetch available) and GITHUB_TOKEN in env.

const OWNER = process.env.REPO_OWNER || process.env.OWNER || 'Chasseze';
const REPO = process.env.REPO_NAME || process.env.REPO || 'Expense-tracker';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.GITHUB_API_TOKEN;
const HOSTING_URL = process.env.HOSTING_URL || 'https://expense-tracker-prod-df355.web.app';
const DEPLOY_ID = process.env.DEPLOY_ID || process.env.GITHUB_SHA || `local-${Date.now()}`;

if (!GITHUB_TOKEN) {
  console.error('GITHUB_TOKEN (or GITHUB_API_TOKEN) is required in env to notify GitHub.');
  process.exit(2);
}

const payload = {
  event_type: 'hosting_deploy_success',
  client_payload: {
    hosting_url: HOSTING_URL,
    deploy_id: DEPLOY_ID,
    timestamp: new Date().toISOString()
  }
};

async function sendDispatch() {
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/dispatches`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'User-Agent': `${OWNER}/${REPO}`
    },
    body: JSON.stringify(payload)
  });

  if (res.status === 204) {
    console.log('✅ Repository dispatch sent successfully.');
    return 0;
  }
  const txt = await res.text();
  console.error('Failed to send repository dispatch. Status:', res.status, txt);
  return 3;
}

(async () => {
  try {
    const code = await sendDispatch();
    process.exit(code);
  } catch (err) {
    console.error('Error sending repository dispatch:', err);
    process.exit(4);
  }
})();
