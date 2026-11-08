import { invalidateResources } from "./resources";

/** Recommendation choices leave retained listening charts and Bloom stories intact. */
export function invalidateRecommendationResources(accountId: string) {
  for (const prefix of ["/api/v2/taste", "/api/v2/feed", "/api/v2/home", "/api/v2/mixes", "/api/v2/search/suggestions"]) {
    invalidateResources(accountId, prefix);
  }
}
