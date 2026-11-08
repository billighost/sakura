/** Shared defaults keep the server, offline planner and settings controls coherent. */
export const FEED_DEFAULTS = {
  discovery: 0.35,
  artistVariety: 0.65,
  repeatTolerance: 0.45,
  newReleaseBias: 0.5,
  deepCutBias: 0.35,
  timeAware: true,
  learnFromListening: true,
} as const;

export const FEED_NUMERIC_FIELDS = [
  "discovery", "artistVariety", "repeatTolerance", "newReleaseBias", "deepCutBias",
] as const;

export const FEED_BOOLEAN_FIELDS = ["timeAware", "learnFromListening"] as const;
