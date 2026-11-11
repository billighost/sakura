// Generated from src/rebuild/core; run node scripts/build-rebuild-worker.cjs.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.collectionDate = collectionDate;
/** Collection membership dates are contextual; missing dates stay unknown. */
function collectionDate(value) {
    const stamp = value instanceof Date ? value.getTime() : typeof value === "number" ? value : typeof value === "string" && value.trim() ? Date.parse(value) : NaN;
    if (!Number.isFinite(stamp))
        return;
    const date = new Date(stamp);
    return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}
