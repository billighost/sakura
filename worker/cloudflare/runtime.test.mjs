import test from 'node:test';
import assert from 'node:assert/strict';
const base = process.env.WORKER_TEST_URL || 'http://127.0.0.1:8788';
const secret = process.env.WORKER_TEST_SECRET || 'synthetic-runtime-proof-secret-123456';
test('actual Workers runtime: auth and disabled acquisition never contact Telegram', async () => {
  assert.equal((await fetch(base + '/health')).status, 200);
  assert.equal((await fetch(base + '/v2/capabilities', { method: 'POST' })).status, 401);
  const headers = { Authorization: 'Bearer ' + secret };
  const caps = await (await fetch(base + '/v2/capabilities', { method: 'POST', headers })).json();
  assert.equal(caps.protocol, 'v2'); assert.equal(caps.acquisitionEnabled, false);
  const response = await fetch(base + '/v2/resolve', { method: 'POST', headers });
  assert.equal(response.status, 503); assert.equal((await response.json()).reason, 'audio-worker-disabled');
});
test('actual Workers runtime: GramJS TL, crypto, SQLite ownership and Node-to-Web streams', async () => {
  const response = await fetch(base + '/v2/runtime-proof', { method: 'POST', headers: { Authorization: 'Bearer ' + secret } });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.ok, true); assert.equal(result.durableStorage, true); assert.match(result.gramjs, /^2\.26\./); assert.equal(result.streamedBytes, 256);
});
test('hosted Workers runtime: real unauthenticated Telegram TCP handshake', {skip: !base.startsWith('https://')}, async () => {
 const response=await fetch(base+'/v2/tcp-proof',{method:'POST',headers:{Authorization:'Bearer '+secret},signal:AbortSignal.timeout(20000)});
 assert.equal(response.status,200);const result=await response.json();assert.equal(result.ok,true);assert.equal(result.authenticated,false);
});
