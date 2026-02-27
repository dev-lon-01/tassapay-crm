/**
 * Smoke test for tayoSyncService
 * Run: node scripts/smoke-tayo-sync.mjs
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const axios = require('axios');

// Load .env.local
import { readFileSync } from 'fs';
const envLines = readFileSync('.env.local', 'utf8').split('\n');
for (const line of envLines) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const [key, ...rest] = trimmed.split('=');
  if (key && rest.length) process.env[key.trim()] = rest.join('=').trim();
}

const { encrypt, decrypt } = require('../src/utils/tayoCrypto.js');

const PROXY = { host: '18.171.109.95', port: 808, protocol: 'http' };

// ── 1. Crypto round-trip ──────────────────────────────────────────────────────
console.log('\n[1] Crypto round-trip...');
const sample = '{"ClientId":"fEuluus","FrDate":"2/25/2026","ToDate":"2/26/2026"}';
const enc = encrypt(sample);
const dec = decrypt(enc);
const ok = dec === sample;
console.log('  Encrypted :', enc);
console.log('  Decrypted :', dec);
console.log('  Match     :', ok ? '✓ PASS' : '✗ FAIL');
if (!ok) process.exit(1);

// ── 2. Auth token ──────────────────────────────────────────────────────────────
console.log('\n[2] Fetching auth token from TayoTransfer...');
const basicAuth = process.env.TAYO_BASIC_AUTH;
let authData;
try {
  const authRes = await axios.post('http://efuluusprod.tayotransfer.com/api/Token', null, {
    headers: { Authorization: `Basic ${basicAuth}` },
    proxy: PROXY,
  });
  console.log('  HTTP status:', authRes.status);
  authData = authRes.data;
} catch (e) {
  console.error('  Auth failed:', e.response?.status, e.response?.data ?? e.message);
  process.exit(1);
}
const token = authData.Token;
console.log('  Token      :', token ? token.substring(0, 20) + '...' : '(none)');
if (!token) { console.error('  No token received'); process.exit(1); }

// ── 3. Fetch remittance list ───────────────────────────────────────────────────
console.log('\n[3] Fetching remittance list...');
const today = new Date();
const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
const fmt = (d) => `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
const payload = JSON.stringify({ ClientId: 'fEuluus', FrDate: fmt(yesterday), ToDate: fmt(today) });
const encPayload = encrypt(payload);
console.log('  Payload    :', payload);

let rawBody;
try {
  const dataRes = await axios.post('http://efuluusprod.tayotransfer.com/api/RemittanceList',
    { jsonstring: encPayload },
    {
      headers: {
        Authorization: `Basic ${basicAuth}`,
        Efuluusrodp2025: token,
        'Content-Type': 'application/json',
      },
      proxy: PROXY,
      responseType: 'text',
      transformResponse: (r) => r, // prevent axios auto-parsing
    }
  );
  console.log('  HTTP status:', dataRes.status);
  rawBody = dataRes.data;
} catch (e) {
  console.error('  Request failed:', e.response?.status, e.response?.data ?? e.message);
  process.exit(1);
}
console.log('  Raw response (first 300 chars):', rawBody.substring(0, 300));

// ── 4. Parse response ───────────────────────────────────────────────────
console.log('\n[4] Parsing response...');
let transfers;
try {
  const parsed = JSON.parse(rawBody);
  transfers = parsed.RemittanceList ?? parsed;
} catch (e) {
  console.error('  Parse error:', e.message);
  process.exit(1);
}

console.log(`  Records returned: ${Array.isArray(transfers) ? transfers.length : '(not an array)'}`);

const efuTransfers = transfers.filter((t) => t.Frsubagent === 'EFU');
console.log(`  EFU records     : ${efuTransfers.length}`);
if (efuTransfers.length > 0) {
  console.log('  Sample EFU record:', JSON.stringify(efuTransfers[0], null, 2));
}

console.log('\n✓ Smoke test PASSED\n');
