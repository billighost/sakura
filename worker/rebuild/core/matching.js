// Generated from src/rebuild/core; run node scripts/build-rebuild-worker.cjs.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifiedRecordingAliases = verifiedRecordingAliases;
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
/** A generic label repeats its kind; a named mix, venue or year adds evidence.
 * Providers often expose `kinds:["remix"]` while ID3 exposes `(Remix)`. */
function versionEvidence(version) {
    const generic = /^(?:remix|mix|live|acoustic|instrumental|karaoke|demo|sped up|speed up|slowed|remaster|remastered|リミックス|ライブ|アコースティック|インストゥルメンタル|カラオケ|リマスター|混音|现场|現場)$/u;
    const labels = version.labels.map(label => label.replace(/リミックス|混音/gu, " remix ").replace(/ライブ|现场|現場/gu, " live ").replace(/アコースティック/gu, " acoustic ").replace(/インストゥルメンタル|伴奏(?:版)?/gu, " instrumental ").replace(/カラオケ/gu, " karaoke ").replace(/リマスター/gu, " remaster ").replace(/\bremastered\b/gu, "remaster").replace(/\bver\b/gu, "version").trim().replace(/\s+/gu, " "));
    return { kinds: version.kinds, labels: [...new Set(labels.filter(label => !generic.test(label)))].sort() };
}
/** Alternate writing is evidence only when a trusted catalogue read binds it
 * to this exact row or an authoritative recording ID. Variants, missing credit
 * information and changed duration cannot become spelling aliases. */
function verifiedRecordingAliases(request) {
    const want = (0, identity_1.normalizedRecording)(request.metadata), aliases = request.metadata.verifiedAliases;
    if (!Array.isArray(aliases) || !want.title || !want.primaryArtist || !want.durationMs)
        return [];
    return aliases.slice(0, 32).filter(alias => {
        try {
            if (!alias || !alias.metadata || !Array.isArray(alias.metadata.artists) || alias.metadata.artistsComplete !== true || !Array.isArray(alias.references))
                return false;
            const identity = identifierEvidence(request, { metadata: alias.metadata, references: alias.references });
            if (!identity.shared || identity.conflict)
                return false;
            const sharedRecordingRef = (request.references ?? []).some(wantRef => (0, identity_1.isRecordingProofReference)(wantRef) && alias.references.some((gotRef) => (0, identity_1.isRecordingProofReference)(gotRef) && (0, identity_1.referenceKey)(wantRef) === (0, identity_1.referenceKey)(gotRef)));
            if (!sharedRecordingRef)
                return false;
            const got = (0, identity_1.normalizedRecording)(alias.metadata);
            if (!got.title || !got.primaryArtist || !got.durationMs || Math.abs(want.durationMs - got.durationMs) > Math.max(5000, want.durationMs * .025))
                return false;
            if (request.metadata.artistsComplete !== false && want.artists.length !== got.artists.length)
                return false;
            if (want.explicit !== "unknown" && got.explicit !== "unknown" && want.explicit !== got.explicit)
                return false;
            return JSON.stringify(versionEvidence(want.version)) === JSON.stringify(versionEvidence(got.version));
        }
        catch {
            return false;
        }
    }).map(alias => ({
        metadata: { title: alias.metadata.title, artists: [...alias.metadata.artists], artistsComplete: true, durationMs: alias.metadata.durationMs,
            ...(alias.metadata.explicit !== undefined ? { explicit: alias.metadata.explicit } : {}),
            ...(alias.metadata.version ? { version: { kinds: [...(alias.metadata.version.kinds ?? [])], labels: [...(alias.metadata.version.labels ?? [])] } } : {}) },
        references: alias.references.map((ref) => ({ provider: ref.provider, id: ref.id, ...(ref.scope ? { scope: ref.scope } : {}) })),
    }));
}
/** Hard gates establish correctness before duration and audio quality can affect ranking. */
function assessStrictAudioCandidate(request, candidate) {
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
    if (JSON.stringify(versionEvidence(want.version)) !== JSON.stringify(versionEvidence(got.version)))
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
/** Match one complete, provider-authorized spelling at a time. A localized
 * title/artist can change; the requested file's other safety gates cannot. */
function assessAudioCandidate(request, candidate) {
    const canonical = assessStrictAudioCandidate(request, candidate);
    if (canonical.acceptable || canonical.reasons.some(reason => reason !== "title" && reason !== "artist"))
        return canonical;
    for (const alias of verifiedRecordingAliases(request)) {
        const assessment = assessStrictAudioCandidate({ metadata: alias.metadata, references: request.references }, candidate);
        if (assessment.acceptable)
            return assessment;
    }
    return canonical;
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
