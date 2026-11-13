/* eslint-disable @typescript-eslint/no-require-imports -- Shared worker telemetry tests. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createWorkerPerformance } = require('./performance.cjs');

test('disabled worker measurements preserve direct return values without clock work', async () => {
  const metrics = createWorkerPerformance(false, () => { assert.fail('Disabled instrumentation read the clock'); });
  const result = Promise.resolve(7);
  assert.equal(metrics.measure('storage_fence', () => result), result);
  assert.equal(metrics.measure('socket_write', () => 4), 4);
  metrics.count('packet_bytes', 512); metrics.maximum('peak_transfers', 2);
  assert.equal(metrics.snapshot(), undefined);
});

test('enabled telemetry records fixed numeric stages through failures and never accepts request keys', async () => {
  let clock = 0;
  const metrics = createWorkerPerformance(true, () => clock);
  await metrics.measure('storage_fence', async () => { clock += 5; });
  await assert.rejects(metrics.measure('storage_fence', async () => { clock += 3; throw new Error('private failure'); }));
  metrics.count('packet_bytes', 1024); metrics.count('packet_bytes', 2048); metrics.count('transfer_bytes', 10);
  metrics.maximum('peak_transfers', 2); metrics.maximum('peak_transfers', 1);
  metrics.measure('private-id-or-token', () => { clock += 9; });
  metrics.count('https://private-url.invalid', 900); metrics.count('packet_bytes', NaN);
  const snapshot = metrics.snapshot();
  assert.deepEqual(snapshot, { stages: { storage_fence: { count: 2, totalMs: 8, maxMs: 5 } }, counters: { packet_bytes: 3072, transfer_bytes: 10 }, maximums: { peak_transfers: 2 } });
  snapshot.stages.storage_fence.totalMs = 999;
  assert.equal(metrics.snapshot().stages.storage_fence.totalMs, 8);
  assert.ok(!JSON.stringify(metrics.snapshot()).includes('private'));
});
