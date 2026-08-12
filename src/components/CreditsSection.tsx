import { useEffect, useMemo, useState } from "react";
import styles from "./CreditsSection.module.css";

interface CreditsSectionProps {
  trackId: string;
  artistName: string;
  artistId?: string;
}

interface CreditEntry {
  id?: string;
  name?: string;
  role?: string;
}

interface SampleEntry {
  trackTitle?: string;
  sampleType?: string;
  artistName?: string;
}

/**
 * Sits directly below LyricsPreviewCard and deliberately shares its visual
 * grammar — same `.card` radius/fill/border/padding, same `.header` label
 * style — so the two read as one family of "about this track" surfaces
 * rather than two differently-styled blocks stacked on top of each other.
 *
 * Individual credit entries are grouped by role ("Written by: A, B") rather
 * than rendered as one row per person: most tracks have several writers or
 * producers, and a row per person turned into a wall of near-identical
 * avatar rows for anything with a real credits list.
 */
export function CreditsSection({ trackId, artistName, artistId }: CreditsSectionProps) {
  const [creditsData, setCreditsData] = useState<any>(null);
  const [artistData, setArtistData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showBioModal, setShowBioModal] = useState(false);

  useEffect(() => {
    let active = true;

    async function fetchData() {
      setLoading(true);
      try {
        const [creditsRes, artistRes] = await Promise.all([
          fetch(`/api/tracks/${trackId}/credits`),
          artistId ? fetch(`/api/artists/${artistId}`) : Promise.resolve(null),
        ]);

        const cData = creditsRes.ok ? await creditsRes.json() : null;
        let aData = null;

        if (artistRes && artistRes.ok) {
          aData = await artistRes.json();
        }

        // If artist image or data is missing, perform fallback search by artistName
        if ((!aData || !aData.imageUrl) && artistName) {
          try {
            const searchRes = await fetch(`/api/search?q=${encodeURIComponent(artistName)}&limit=5`);
            if (searchRes.ok) {
              const searchJson = await searchRes.json();
              const match =
                (searchJson.artists || []).find(
                  (a: any) => a.name.toLowerCase() === artistName.toLowerCase()
                ) || searchJson.artists?.[0];

              if (match) {
                aData = {
                  ...aData,
                  imageUrl: match.imageUrl || aData?.imageUrl,
                  bio: aData?.bio || match.description,
                };
              }
            }
          } catch (e) {
            console.warn("[CreditsSection] Fallback search for artist failed:", e);
          }
        }

        if (active) {
          setCreditsData(cData);
          setArtistData(aData);
        }
      } catch (e) {
        console.error("Failed to fetch credits data", e);
      } finally {
        if (active) setLoading(false);
      }
    }

    fetchData();

    return () => {
      active = false;
    };
  }, [trackId, artistId, artistName]);

  // One row per role rather than one row per person — see the note above.
  const groupedCredits = useMemo(() => {
    const entries: CreditEntry[] = creditsData?.credits || [];
    if (!entries.length) return [];

    const byRole = new Map<string, string[]>();
    for (const entry of entries) {
      if (!entry.name) continue;
      const role = entry.role || "Credit";
      if (!byRole.has(role)) byRole.set(role, []);
      byRole.get(role)!.push(entry.name);
    }

    return Array.from(byRole, ([role, names]) => ({ role, names }));
  }, [creditsData]);

  const samples: SampleEntry[] = creditsData?.samples || [];
  const sampledBy: SampleEntry[] = creditsData?.sampledBy || [];
  const hasMore = groupedCredits.length > 0 || samples.length > 0 || sampledBy.length > 0;

  return (
    <div className={styles.container} data-block-drag>
      <div className={styles.header}>Credits</div>

      {loading ? (
        <div className={`${styles.card} ${styles.cardLoading}`}>
          <div className={styles.loadingText}>Loading credits&hellip;</div>
        </div>
      ) : (
        <div className={styles.card}>
          <div className={styles.artistRow}>
            {artistData?.imageUrl ? (
              <img
                src={artistData.imageUrl}
                alt=""
                className={styles.artistAvatar}
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className={`${styles.artistAvatar} ${styles.artistAvatarFallback}`}>
                <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
                  <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
                </svg>
              </div>
            )}
            <div className={styles.artistMeta}>
              <div className={styles.artistRole}>Main artist</div>
              <div className={styles.artistName}>{artistName}</div>
            </div>
          </div>

          {artistData?.bio && (
            <div className={styles.bioBlock}>
              <p className={styles.truncatedBio}>{artistData.bio}</p>
              <button
                type="button"
                className={`${styles.readMoreBtn} pressable`}
                onClick={() => setShowBioModal(true)}
              >
                Read more
              </button>
            </div>
          )}

          {groupedCredits.length > 0 && (
            <div className={styles.creditRows}>
              {groupedCredits.map((group) => (
                <div className={styles.creditRow} key={group.role}>
                  <span className={styles.creditRoleLabel}>{group.role}</span>
                  <span className={styles.creditNames}>{group.names.join(", ")}</span>
                </div>
              ))}
            </div>
          )}

          {samples.length > 0 && (
            <div className={styles.sampleGroup}>
              <div className={styles.sampleGroupLabel}>Samples</div>
              {samples.map((sample, i) => (
                <div className={styles.sampleRow} key={`sample-${i}`}>
                  <div className={styles.sampleTitle}>{sample.trackTitle}</div>
                  <div className={styles.sampleMeta}>
                    {sample.sampleType} by {sample.artistName || "Unknown"}
                  </div>
                </div>
              ))}
            </div>
          )}

          {sampledBy.length > 0 && (
            <div className={styles.sampleGroup}>
              <div className={styles.sampleGroupLabel}>Sampled in</div>
              {sampledBy.map((sample, i) => (
                <div className={styles.sampleRow} key={`sampledBy-${i}`}>
                  <div className={styles.sampleTitle}>{sample.trackTitle}</div>
                  <div className={styles.sampleMeta}>
                    {sample.sampleType} by {sample.artistName || "Unknown"}
                  </div>
                </div>
              ))}
            </div>
          )}

          {!hasMore && !artistData?.bio && (
            <div className={styles.noExtra}>No further credit details for this track yet.</div>
          )}
        </div>
      )}

      {showBioModal && artistData?.bio && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalContent}>
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>About {artistName}</h2>
              <button
                type="button"
                className={`${styles.modalCloseBtn} pressable`}
                onClick={() => setShowBioModal(false)}
                aria-label="Close bio"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  width="20"
                  height="20"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className={styles.modalBody} data-lenis-prevent>
              {artistData.imageUrl && (
                <img
                  src={artistData.imageUrl}
                  alt={artistName}
                  className={styles.modalImage}
                  referrerPolicy="no-referrer"
                />
              )}
              <p className={styles.fullBio}>{artistData.bio}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
