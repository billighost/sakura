import test from "node:test";
import assert from "node:assert/strict";
import { appendUniqueFeedItems } from "../src/rebuild/app/feedItems";
import { invalidateRecommendationResources } from "../src/rebuild/app/recommendationResources";
import { loadResource, resourceSnapshot, clearResources } from "../src/rebuild/app/resources";

test("overlapping feed pages retain the original explanation and card order", () => {
  const first = { track: { id: "song-a" }, reason: "An artist you chose" };
  const previous = [first, { track: { id: "song-b" }, reason: "A familiar song" }];
  const incoming = [
    { track: { id: "song-a" }, reason: "An outdated replacement reason" },
    { track: { id: "song-c" }, reason: "A new song" },
    { track: { id: "song-c" }, reason: "Repeated in the same provider page" },
  ];
  const merged = appendUniqueFeedItems(previous, incoming);
  assert.deepEqual(merged.map(item => item.track.id), ["song-a", "song-b", "song-c"]);
  assert.equal(merged[0], first);
  assert.equal(merged[0].reason, "An artist you chose");
  assert.equal(previous.length, 2);
  assert.equal(incoming.length, 3);
});

test("recommendation choices refresh suggestions without refetching retained listening stories", async t => {
  const account = "recommendation-choice-scope", calls = new Map<string, number>();
  const journal = "/api/v2/profile", story = "/api/v2/bloom/yearly-2025";
  const suggestions = ["/api/v2/taste", "/api/v2/feed", "/api/v2/home", "/api/v2/mixes", "/api/v2/search/suggestions"];
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
    const path = String(input); calls.set(path, (calls.get(path) || 0) + 1);
    return Response.json({ path, generation: calls.get(path) });
  });
  await Promise.all([...suggestions, journal, story].map(path => loadResource(account, path)));
  const retainedJournal = resourceSnapshot(account, journal), retainedStory = resourceSnapshot(account, story);
  invalidateRecommendationResources(account);
  await Promise.all([...suggestions, journal, story].map(path => loadResource(account, path)));
  assert.equal(resourceSnapshot(account, journal), retainedJournal);
  assert.equal(resourceSnapshot(account, story), retainedStory);
  assert.equal(calls.get(journal), 1);
  assert.equal(calls.get(story), 1);
  for (const path of suggestions) assert.equal(calls.get(path), 2);
  clearResources(account);
});
