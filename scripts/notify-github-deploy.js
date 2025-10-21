#!/usr/bin/env node
// Usage: set GITHUB_TOKEN env and optionally REPO_OWNER, REPO_NAME, HOSTING_URL
// This script sends a repository_dispatch event of type `hosting_deploy_success`.

const owner = process.env.REPO_OWNER || 'Chasseze';
const repo = process.env.REPO_NAME || 'Expense-tracker';
const token = process.env.GITHUB_TOKEN;
const hostingUrl = process.env.HOSTING_URL || 'https://expense-tracker-prod-df355.web.app';
const deployId = process.env.DEPLOY_ID || process.env.GITHUB_SHA || null;

if (!token) {
  console.error('GITHUB_TOKEN is required as an environment variable.');
  process.exit(1);
}

async function notify() {
  const url = `https://api.github.com/repos/${owner}/${repo}/dispatches`;
  const body = {
    event_type: 'hosting_deploy_success',
    client_payload: {
      hosting_url: hostingUrl,
      deploy_id: deployId,
      timestamp: new Date().toISOString()
    }
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `token ${token}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': `${owner}/${repo}`
    },
    body: JSON.stringify(body)
  });

  if (res.status === 204) {
    console.log('Dispatch event sent successfully.');
    process.exit(0);
  }

  const text = await res.text();
  console.error('Failed to send dispatch event:', res.status, text);
  process.exit(2);
}

notify().catch(err => { console.error('Notify failed', err); process.exit(3); });
