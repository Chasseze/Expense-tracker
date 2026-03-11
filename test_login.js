const http = require('http');

const BASE_URL = 'http://localhost:3000/api';
const DEFAULT_HEADERS = {
  'Content-Type': 'application/json'
};

async function makeRequest(method, endpoint, data = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: `/api${endpoint}`,
      method,
      headers: {
        ...DEFAULT_HEADERS,
        ...headers
      }
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          const parsed = body ? JSON.parse(body) : {};
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            data: parsed
          });
        } catch (e) {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            data: body
          });
        }
      });
    });

    req.on('error', reject);

    if (data) {
      req.write(JSON.stringify(data));
    }

    req.end();
  });
}

async function testRegistration() {
  console.log('Testing registration endpoint...');

  const testUsername = `testuser_${Date.now()}`;
  const testPassword = 'TestPassword123!';

  try {
    const response = await makeRequest('POST', '/register', {
      username: testUsername,
      password: testPassword
    });

    if (response.statusCode === 200) {
      console.log('✅ Registration successful');
      console.log(`   Username: ${testUsername}`);
      console.log(`   Token: ${response.data.token ? 'Received' : 'Missing'}`);
      console.log(`   User ID: ${response.data.user?.id || 'N/A'}`);
      return {
        username: testUsername,
        password: testPassword,
        token: response.data.token,
        userId: response.data.user?.id
      };
    } else {
      console.log(`❌ Registration failed: ${response.statusCode}`);
      console.log(`   Error: ${response.data.error || 'Unknown error'}`);
      return null;
    }
  } catch (error) {
    console.log(`❌ Registration request failed: ${error.message}`);
    return null;
  }
}

async function testLogin(username, password) {
  console.log('\nTesting login endpoint...');

  try {
    const response = await makeRequest('POST', '/login', {
      username,
      password
    });

    if (response.statusCode === 200) {
      console.log('✅ Login successful');
      console.log(`   Token: ${response.data.token ? 'Received' : 'Missing'}`);
      return response.data.token;
    } else {
      console.log(`❌ Login failed: ${response.statusCode}`);
      console.log(`   Error: ${response.data.error || 'Unknown error'}`);
      return null;
    }
  } catch (error) {
    console.log(`❌ Login request failed: ${error.message}`);
    return null;
  }
}

async function testInvalidLogin() {
  console.log('\nTesting invalid login...');

  try {
    const response = await makeRequest('POST', '/login', {
      username: 'nonexistentuser',
      password: 'wrongpassword'
    });

    if (response.statusCode === 401) {
      console.log('✅ Invalid login correctly rejected (401)');
    } else if (response.statusCode === 400) {
      console.log('✅ Invalid login correctly rejected (400)');
    } else {
      console.log(`⚠️ Unexpected response: ${response.statusCode}`);
      console.log(`   Response: ${JSON.stringify(response.data)}`);
    }
  } catch (error) {
    console.log(`❌ Invalid login test failed: ${error.message}`);
  }
}

async function testProtectedEndpoint(token) {
  console.log('\nTesting protected endpoint...');

  if (!token) {
    console.log('⚠️ No token available, skipping protected endpoint test');
    return false;
  }

  try {
    const response = await makeRequest('GET', '/expenses', null, {
      'Authorization': `Bearer ${token}`
    });

    if (response.statusCode === 200) {
      console.log('✅ Protected endpoint accessible with valid token');
      console.log(`   Received ${Array.isArray(response.data) ? response.data.length : 'unknown'} expenses`);
      return true;
    } else if (response.statusCode === 401 || response.statusCode === 403) {
      console.log(`❌ Protected endpoint rejected token: ${response.statusCode}`);
      console.log(`   Error: ${response.data.error || 'Unknown'}`);
      return false;
    } else {
      console.log(`⚠️ Unexpected response from protected endpoint: ${response.statusCode}`);
      return false;
    }
  } catch (error) {
    console.log(`❌ Protected endpoint test failed: ${error.message}`);
    return false;
  }
}

async function testMissingToken() {
  console.log('\nTesting protected endpoint without token...');

  try {
    const response = await makeRequest('GET', '/expenses');

    if (response.statusCode === 401) {
      console.log('✅ Protected endpoint correctly requires token (401)');
    } else {
      console.log(`⚠️ Unexpected response without token: ${response.statusCode}`);
      console.log(`   Response: ${JSON.stringify(response.data)}`);
    }
  } catch (error) {
    console.log(`❌ Missing token test failed: ${error.message}`);
  }
}

async function testInvalidToken() {
  console.log('\nTesting protected endpoint with invalid token...');

  try {
    const response = await makeRequest('GET', '/expenses', null, {
      'Authorization': 'Bearer invalid.token.here'
    });

    if (response.statusCode === 403) {
      console.log('✅ Invalid token correctly rejected (403)');
    } else if (response.statusCode === 401) {
      console.log('✅ Invalid token correctly rejected (401)');
    } else {
      console.log(`⚠️ Unexpected response with invalid token: ${response.statusCode}`);
    }
  } catch (error) {
    console.log(`❌ Invalid token test failed: ${error.message}`);
  }
}

async function testServerStatus() {
  console.log('\nTesting server status endpoint...');

  try {
    const response = await makeRequest('GET', '/status');

    if (response.statusCode === 200) {
      console.log('✅ Status endpoint working');
      console.log(`   Storage mode: ${response.data.storageMode || 'Unknown'}`);
      console.log(`   LibSQL URL: ${response.data.libsqlUrl ? 'Set' : 'Not set'}`);
    } else {
      console.log(`⚠️ Status endpoint returned: ${response.statusCode}`);
    }
  } catch (error) {
    console.log(`❌ Status endpoint test failed: ${error.message}`);
  }
}

async function testDevelopmentAuthToggle() {
  console.log('\nTesting development auth toggle endpoints...');

  try {
    // Check if development endpoints exist
    const statusResponse = await makeRequest('GET', '/dev/auth-status');

    if (statusResponse.statusCode === 200) {
      console.log('✅ Development auth status endpoint working');
      console.log(`   devAuthDisabled: ${statusResponse.data.devAuthDisabled}`);

      // Try to toggle auth (these might be POST only, but we'll try GET first)
      try {
        const disableResponse = await makeRequest('POST', '/dev/disable-auth');
        console.log(`   Disable auth response: ${disableResponse.statusCode}`);

        const enableResponse = await makeRequest('POST', '/dev/enable-auth');
        console.log(`   Enable auth response: ${enableResponse.statusCode}`);
      } catch (postError) {
        console.log('   Auth toggle endpoints might require POST with body');
      }
    } else {
      console.log(`   Development endpoints not available (status: ${statusResponse.statusCode})`);
    }
  } catch (error) {
    console.log(`   Development endpoints not available: ${error.message}`);
  }
}

async function runAllTests() {
  console.log('Starting login/authentication tests...');
  console.log('========================================\n');

  // First, check if server is running
  try {
    await testServerStatus();
  } catch (error) {
    console.log(`❌ Cannot connect to server: ${error.message}`);
    console.log('Make sure the server is running on http://localhost:3000');
    process.exit(1);
  }

  // Test development auth toggles
  await testDevelopmentAuthToggle();

  // Test registration
  const credentials = await testRegistration();

  // Test login with registered credentials
  let token = null;
  if (credentials) {
    token = await testLogin(credentials.username, credentials.password);
  }

  // Test invalid login
  await testInvalidLogin();

  // Test missing token
  await testMissingToken();

  // Test invalid token
  await testInvalidToken();

  // Test protected endpoint with valid token
  if (token) {
    await testProtectedEndpoint(token);
  }

  console.log('\n========================================');
  console.log('Tests completed!');

  // Provide summary
  if (credentials && token) {
    console.log('\nTest credentials created:');
    console.log(`  Username: ${credentials.username}`);
    console.log(`  Password: ${credentials.password}`);
    console.log(`  User ID: ${credentials.userId || 'N/A'}`);
    console.log('\nYou can use these credentials for manual testing.');
  }
}

// Handle command line arguments
if (require.main === module) {
  runAllTests().catch(error => {
    console.error('Test runner failed:', error);
    process.exit(1);
  });
}

module.exports = {
  makeRequest,
  testRegistration,
  testLogin,
  testInvalidLogin,
  testProtectedEndpoint,
  testMissingToken,
  testInvalidToken,
  testServerStatus,
  testDevelopmentAuthToggle,
  runAllTests
};
