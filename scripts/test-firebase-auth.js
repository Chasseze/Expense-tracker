const key = 'AIzaSyDpHj-GlKfGrP6G3BMt7Vwjgwg4QPT8yaI';
const email = `autotest+${Date.now()}@example.com`;
const password = 'TestPass123!';

async function main() {
  const signupRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true })
  });
  const signupBody = await signupRes.json();
  console.log('SignUp status:', signupRes.status);
  console.log('Email:', email);
  console.log('SignUp response:', signupBody);

  if (!signupRes.ok && signupBody.error?.message !== 'EMAIL_EXISTS') {
    console.error('Signup failed.');
    return;
  }

  const loginRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true })
  });
  const loginBody = await loginRes.json();
  console.log('Login status:', loginRes.status);
  console.log('Login response:', loginBody);

  if (loginRes.ok) {
    console.log('ID token (first 60 chars):', loginBody.idToken.slice(0, 60) + '...');

  const apiUrl = 'https://expense-tracker-prod-df355.web.app/api/expenses';
    const apiRes = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${loginBody.idToken}`
      }
    });
    const contentType = apiRes.headers.get('content-type') || '';
    let apiBody;
    if (contentType.includes('application/json')) {
      apiBody = await apiRes.json();
    } else {
      apiBody = await apiRes.text();
    }
    console.log('Protected API status:', apiRes.status);
    console.log('Protected API response:', apiBody);
  } else {
    console.error('Login failed.');
  }
}

main().catch((err) => {
  console.error('Unexpected error:', err);
});
