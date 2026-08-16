import { useEffect, useMemo, useState } from "react";
import { Sheet } from "./Sheet";
import { UserIcon } from "./Icons";
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

/** What /api/tracks/[id]/credits returns, narrowed to what's read here. */
interface CreditsPayload {
  credits?: CreditEntry[];
  samples?: SampleEntry[];
  sampledBy?: SampleEntry[];
}

/**
 * The artist, from /api/artists/[id] or from a name search fallback. Only the
 * two fields this component displays.
 */
interface ArtistPayload {
  imageUrl?: string | null;
  bio?: string | null;
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
  const [creditsData, setCreditsData] = useState<CreditsPayload | null>(null);
  const [artistData, setArtistData] = useState<ArtistPayload | null>(null);
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

        const cData: CreditsPayload | null = creditsRes.ok ? await creditsRes.json() : null;
        let aData: ArtistPayload | null = null;

        if (artistRes && artistRes.ok) {
          aData = await artistRes.json();
        }

        // If artist image or data is missing, perform fallback search by artistName
        if ((!aData || !aData.imageUrl) && artistName) {
          try {
            const searchRes = await fetch(`/api/search?q=${encodeURIComponent(artistName)}&limit=5`);
            if (searchRes.ok) {
              const searchJson = await searchRes.json();
              const candidates: { name: string; imageUrl?: string | null; description?: string | null }[] =
                searchJson.artists ?? [];
              const match =
                candidates.find((a) => a.name?.toLowerCase() === artistName.toLowerCase()) ??
                candidates[0];

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
                <UserIcon size={20} />
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

      {/* <Sheet> rather than a hand-rolled overlay. The previous one trapped no
          focus, ignored Escape, never restored focus on close and unmounted
          instantly so its exit animation had nothing left to animate. */}
      <Sheet
        open={showBioModal && Boolean(artistData?.bio)}
        onClose={() => setShowBioModal(false)}
        title={`About ${artistName}`}
        variant="sheet"
      >
        {artistData?.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={artistData.imageUrl}
            alt=""
            className={styles.modalImage}
            referrerPolicy="no-referrer"
          />
        )}
        <p className={styles.fullBio}>{artistData?.bio}</p>
      </Sheet>
    </div>
  );
}
