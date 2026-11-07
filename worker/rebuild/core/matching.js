// Generated from src/rebuild/core; run node scripts/build-rebuild-worker.cjs.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assessAudioCandidate = assessAudioCandidate;
exports.selectAudioCandidate = selectAudioCandidate;
const identity_1 = require("./identity.js");
function identifierEvidence(request, candidate) {
    let shared = false;
    let conflict = false;
    for (const want of request.references ?? []) {
        for (const got of candidate.references ?? []) {
            if (want.provider !== got.provider || (want.scope ?? "") !== (got.scope ?? ""))
                continue;
            if ((0, identity_1.referenceKey)(want) === (0, identity_1.referenceKey)(got))
                shared = true;
            // A different release's Deezer/Spotify ID need not be a different recording.
            // Conflicting ISRC or MB recording IDs, however, require explicit verification.
            else if (want.provider === "isrc" || want.provider === "musicbrainz")
                conflict = true;
        }
    }
    return { shared, conflict };
}
/** Hard gates establish correctness before duration and audio quality can affect ranking. */
function assessAudioCandidate(request, candidate) {
    const want = (0, identity_1.normalizedRecording)(request.metadata);
    const got = (0, identity_1.normalizedRecording)(candidate.metadata, want.artists);
    const identity = identifierEvidence(request, candidate);
    const reasons = [];
    if (candidate.audioKind === "preview")
        reasons.push("preview");
    if (candidate.audioKind === "unknown")
        reasons.push("unverified-audio");
    if (!want.title || !got.title || !want.primaryArtist || !got.primaryArtist)
        reasons.push("missing-metadata");
    if (want.title !== got.title)
        reasons.push("title");
    const creditsMatch = request.metadata.artistsComplete === false
        ? want.artists.every(artist => got.artists.includes(artist))
        : candidate.metadata.artistsComplete === false
            ? got.artists.every(artist => want.artists.includes(artist))
            : JSON.stringify([...want.artists].sort()) === JSON.stringify([...got.artists].sort());
    if (want.primaryArtist !== got.primaryArtist || !creditsMatch)
        reasons.push("artist");
    if (JSON.stringify(want.version) !== JSON.stringify(got.version))
        reasons.push("version");
    if (want.explicit !== "unknown" && got.explicit !== "unknown" && want.explicit !== got.explicit)
        reasons.push("explicit");
    if (identity.conflict)
        reasons.push("identifier-conflict");
    const difference = want.durationMs && got.durationMs ? Math.abs(want.durationMs - got.durationMs) : null;
    if (difference !== null && difference > Math.max(5000, want.durationMs * 0.025))
        reasons.push("duration");
    if (difference === null && !identity.shared)
        reasons.push("missing-duration");
    const acceptable = reasons.length === 0;
    const durationScore = difference === null ? 0 : Math.max(0, 20 - difference / 500);
    return { candidate, acceptable, score: acceptable ? 80 + durationScore + (identity.shared ? 200 : 0) : 0, reasons, authoritativeMatch: identity.shared && !identity.conflict };
}
/** Never return the first result solely because the provider found something. */
function selectAudioCandidate(request, candidates) {
    const assessments = candidates.map((candidate) => assessAudioCandidate(request, candidate));
    const valid = assessments.filter((result) => result.acceptable).sort((a, b) => b.score - a.score);
    if (!valid.length)
        return { status: "unavailable", assessments };
    if (valid.length === 1)
        return { status: "matched", candidate: valid[0].candidate, assessments };
    const best = valid[0];
    const near = valid.filter((result) => best.score - result.score < 5);
    if (near.length === 1)
        return { status: "matched", candidate: best.candidate, assessments };
    // Multiple encodings of one *verified* recording are safe to select by quality.
    const verifiedKeys = (candidate) => new Set((candidate.references ?? [])
        .filter((ref) => ref.provider === "isrc" || ref.provider === "musicbrainz")
        .map(identity_1.referenceKey));
    const bestKeys = verifiedKeys(best.candidate);
    const sameRecording = bestKeys.size > 0 && near.every((result) => [...verifiedKeys(result.candidate)].some((key) => bestKeys.has(key)));
    if (sameRecording) {
        near.sort((a, b) => (b.candidate.bitrateKbps ?? 0) - (a.candidate.bitrateKbps ?? 0));
        return { status: "matched", candidate: near[0].candidate, assessments };
    }
    return { status: "ambiguous", candidates: near.map((result) => result.candidate), assessments };
}
