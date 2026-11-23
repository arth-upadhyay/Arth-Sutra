// scripts/test-task-1-4.js
import http from 'http';
import fs from 'fs';
import path from 'path';

function getActivePort() {
  try {
    if (fs.existsSync('data/port.txt')) {
      const p = parseInt(fs.readFileSync('data/port.txt', 'utf8').trim(), 10);
      if (p >= 1024 && p <= 65535) return p;
    }
  } catch {}
  return 47371;
}

function request(method, pathStr, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';
    const port = getActivePort();
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: pathStr,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        ...headers,
      },
    }, (res) => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: raw ? JSON.parse(raw) : null });
        } catch {
          resolve({ status: res.statusCode, data: raw });
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function run() {
  console.log('--- Starting Integration Tests for Tasks 1 - 4 ---');

  // Step 1: Login with admin / admin123
  console.log('1. Testing POST /api/auth/login with default credentials...');
  const loginRes = await request('POST', '/api/auth/login', { username: 'admin', password: 'admin123' });
  console.log('   Status:', loginRes.status, 'User:', loginRes.data?.user?.username);
  if (loginRes.status !== 200 || !loginRes.data?.token) {
    throw new Error('Initial login failed: ' + JSON.stringify(loginRes.data));
  }
  let token = loginRes.data.token;

  // Step 2: Test PUT /api/auth/profile with WRONG current password
  console.log('2. Testing PUT /api/auth/profile with invalid current password...');
  const badPassRes = await request('PUT', '/api/auth/profile', {
    currentPassword: 'wrongPassword123',
    newPassword: 'myNewPassword999',
  }, { Authorization: `Bearer ${token}` });
  console.log('   Status:', badPassRes.status, 'Error:', badPassRes.data?.error);
  if (badPassRes.status !== 401) {
    throw new Error('Expected 401 for incorrect password, got: ' + badPassRes.status);
  }

  // Step 3: Test PUT /api/auth/profile with missing current password
  console.log('3. Testing PUT /api/auth/profile without current password...');
  const missingPassRes = await request('PUT', '/api/auth/profile', {
    newPassword: 'myNewPassword999',
  }, { Authorization: `Bearer ${token}` });
  console.log('   Status:', missingPassRes.status, 'Error:', missingPassRes.data?.error);
  if (missingPassRes.status !== 400) {
    throw new Error('Expected 400 for missing current password, got: ' + missingPassRes.status);
  }

  // Step 4: Test PUT /api/auth/profile with CORRECT current password and update username + password
  console.log('4. Testing PUT /api/auth/profile updating username to "arth_admin" and password to "arthPass456"...');
  const updateRes = await request('PUT', '/api/auth/profile', {
    currentPassword: 'admin123',
    newUsername: 'arth_admin',
    newPassword: 'arthPass456',
  }, { Authorization: `Bearer ${token}` });
  console.log('   Status:', updateRes.status, 'Message:', updateRes.data?.message, 'User:', updateRes.data?.user);
  if (updateRes.status !== 200 || !updateRes.data?.token) {
    throw new Error('Profile update failed: ' + JSON.stringify(updateRes.data));
  }
  token = updateRes.data.token;

  // Step 5: Verify login works with NEW credentials
  console.log('5. Testing POST /api/auth/login with new credentials (arth_admin / arthPass456)...');
  const newLoginRes = await request('POST', '/api/auth/login', { username: 'arth_admin', password: 'arthPass456' });
  console.log('   Status:', newLoginRes.status, 'User:', newLoginRes.data?.user?.username);
  if (newLoginRes.status !== 200) {
    throw new Error('Login with updated credentials failed: ' + JSON.stringify(newLoginRes.data));
  }

  // Step 6: Verify OLD credentials no longer work
  console.log('6. Verifying old credentials fail...');
  const oldLoginRes = await request('POST', '/api/auth/login', { username: 'admin', password: 'admin123' });
  console.log('   Status (should be 401):', oldLoginRes.status);
  if (oldLoginRes.status !== 401) {
    throw new Error('Old credentials still accepted!');
  }

  // Step 7: Restore original admin / admin123 credentials
  console.log('7. Restoring original credentials back to admin / admin123...');
  const restoreRes = await request('PUT', '/api/auth/profile', {
    currentPassword: 'arthPass456',
    newUsername: 'admin',
    newPassword: 'admin123',
  }, { Authorization: `Bearer ${token}` });
  console.log('   Status:', restoreRes.status, 'User:', restoreRes.data?.user);
  if (restoreRes.status !== 200) {
    throw new Error('Restoring credentials failed: ' + JSON.stringify(restoreRes.data));
  }

  // Final verification
  const finalLogin = await request('POST', '/api/auth/login', { username: 'admin', password: 'admin123' });
  if (finalLogin.status === 200) {
    console.log('✓ All integration tests passed successfully!');
  } else {
    throw new Error('Final check failed');
  }

  process.exit(0);
}

run().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
