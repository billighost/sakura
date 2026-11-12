import assert from "node:assert/strict";
import { test } from "node:test";
import { measureApiStage, withApiTiming } from "../src/rebuild/server/performance";

test("handler timing preserves private cache, cookies, redirect and existing measurements", async () => {
  const response = await withApiTiming("/api/example", new Request("https://example.test/api/example"), () =>
    measureApiStage("account", () => new Response(null, { status: 307, headers: {
      Location: "/login", "Cache-Control": "private, no-store", "Set-Cookie": "fixture=1; HttpOnly",
      "Server-Timing": "upstream;dur=2",
    } })),
  );
  assert.equal(response.status, 307);
  assert.equal(response.headers.get("Location"), "/login");
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.equal(response.headers.get("Set-Cookie"), "fixture=1; HttpOnly");
  assert.match(response.headers.get("Server-Timing")!, /upstream;dur=2, app;dur=\d/);
  assert.match(response.headers.get("Server-Timing")!, /account;dur=\d.*1 calls/);
});

test("concurrent requests isolate stage data and late work cannot change completed response", async () => {
  let finish!: () => void;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const slow = withApiTiming("/api/slow", new Request("https://example.test/api/slow"), async () => {
    await measureApiStage("slow", () => gate);
    return Response.json({ ok: true });
  });
  const fast = await withApiTiming("/api/fast", new Request("https://example.test/api/fast"), async () => {
    await measureApiStage("fast", () => undefined);
    return Response.json({ ok: true });
  });
  finish();
  const other = await slow;
  assert.match(fast.headers.get("Server-Timing")!, /fast;dur=/);
  assert.doesNotMatch(fast.headers.get("Server-Timing")!, /slow;dur=/);
  assert.match(other.headers.get("Server-Timing")!, /slow;dur=/);
  assert.doesNotMatch(other.headers.get("Server-Timing")!, /fast;dur=/);
});

test("timing streams does not await their bytes and preserves range semantics", async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
  const response = await withApiTiming("/api/media", new Request("https://example.test/api/media"), () =>
    new Response(stream, { status: 206, headers: { "Content-Range": "bytes 0-3/10", "Content-Length": "4" } }),
  );
  assert.equal(response.status, 206);
  assert.equal(response.body, stream);
  assert.equal(response.headers.get("Content-Range"), "bytes 0-3/10");
  assert.equal(response.headers.get("Content-Length"), "4");
  controller.enqueue(new Uint8Array([1, 2, 3, 4]));
  controller.close();
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [1, 2, 3, 4]);
});

test("exceptions retain their identity; invalid stage names never enter response headers", async () => {
  const failure = new Error("fixture failure");
  await assert.rejects(withApiTiming("/api/fail", new Request("https://example.test/api/fail"), () =>
    measureApiStage("work", () => { throw failure; }),
  ), error => error === failure);
  const response = await withApiTiming("/api/valid", new Request("https://example.test/api/valid"), async () => {
    await measureApiStage("unsafe\r\nheader", () => undefined);
    return new Response(null, { status: 204 });
  });
  assert.doesNotMatch(response.headers.get("Server-Timing")!, /unsafe|work/);
});
