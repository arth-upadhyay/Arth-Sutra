// scripts/test-setup-wizard.js
import http from 'http';
import fs from 'fs';

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
  console.log('--- Testing Live Setup Wizard API Endpoints ---');

  // Step 1: Query GET /api/auth/status
  console.log('1. Testing GET /api/auth/status...');
  const statusRes = await request('GET', '/api/auth/status');
  console.log('   Status:', statusRes.status, 'Body:', statusRes.data);
  if (statusRes.status !== 200 || typeof statusRes.data?.isSetupComplete !== 'boolean') {
    throw new Error('GET /api/auth/status failed: ' + JSON.stringify(statusRes.data));
  }

  // Step 2: Attempt POST /api/auth/setup when users exist (should be rejected with 403)
  console.log('2. Testing POST /api/auth/setup when users already exist...');
  const setupForbiddenRes = await request('POST', '/api/auth/setup', {
    username: 'new_rogue_admin',
    password: 'password123',
  });
  console.log('   Status:', setupForbiddenRes.status, 'Error:', setupForbiddenRes.data?.error);
  if (setupForbiddenRes.status !== 403) {
    throw new Error('Expected 403 for setup when users table not empty, got: ' + setupForbiddenRes.status);
  }

  console.log('✓ Live endpoint tests for /api/auth/status and /api/auth/setup passed!');
  process.exit(0);
}

run().catch(err => {
  console.error('Setup wizard test failed:', err);
  process.exit(1);
});
