import { useEffect, useState } from "react";
import styles from "./CreditsSection.module.css";

interface CreditsSectionProps {
  trackId: string;
  artistName: string;
  artistId?: string;
}

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
          artistId ? fetch(`/api/artists/${artistId}`) : Promise.resolve(null)
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
              const match = (searchJson.artists || []).find(
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

  return (
    <div className={styles.container} data-block-drag>
      <div className={styles.header}>
        <span>Credits</span>
      </div>

      {loading ? (
        <div className={styles.loading}>Loading credits...</div>
      ) : (
        <div className={styles.content}>
          {/* Main Artist Card */}
          <div className={styles.artistCard}>
            {artistData?.imageUrl ? (
              <img src={artistData.imageUrl} alt={artistName} className={styles.artistImage} referrerPolicy="no-referrer" />
            ) : (
              <div className={`${styles.artistImage} ${styles.artistFallback}`}>
                <svg viewBox="0 0 24 24" fill="currentColor" width="48" height="48">
                  <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
                </svg>
              </div>
            )}
            <div className={styles.artistOverlay} />
            <div className={styles.artistInfo}>
              <span className={styles.artistRole}>Main Artist</span>
              <h3 className={styles.artistName}>{artistName}</h3>
              {artistData?.bio ? (
                <>
                  <p className={styles.truncatedBio}>{artistData.bio}</p>
                  <button className={styles.readMoreBtn} onClick={() => setShowBioModal(true)}>Read more</button>
                </>
              ) : null}
            </div>
          </div>

          {/* Other Credits */}
          {(creditsData?.credits?.length > 0 || creditsData?.samples?.length > 0 || creditsData?.sampledBy?.length > 0) && (
            <div className={styles.otherCredits}>
              <h3 className={styles.sectionTitle}>Track Credits</h3>
              
              {creditsData?.credits?.map((credit: any, i: number) => (
                <div key={`${credit.id || i}`} className={styles.creditRow}>
                  <div className={styles.creditAvatar}>
                    <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                      <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
                    </svg>
                  </div>
                  <div className={styles.creditDetails}>
                    <div className={styles.creditName}>{credit.name}</div>
                    <div className={styles.creditRole}>{credit.role}</div>
                  </div>
                </div>
              ))}

              {creditsData?.samples?.map((sample: any, i: number) => (
                <div key={`sample-${i}`} className={styles.creditRow}>
                   <div className={styles.creditAvatar}>
                    <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 14.5c-2.49 0-4.5-2.01-4.5-4.5S9.51 7.5 12 7.5s4.5 2.01 4.5 4.5-2.01 4.5-4.5 4.5zm0-5.5c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1z" />
                    </svg>
                  </div>
                  <div className={styles.creditDetails}>
                    <div className={styles.creditName}>{sample.trackTitle}</div>
                    <div className={styles.creditRole}>{sample.sampleType} by {sample.artistName || "Unknown"}</div>
                  </div>
                </div>
              ))}
              
              {creditsData?.sampledBy?.map((sample: any, i: number) => (
                <div key={`sampledBy-${i}`} className={styles.creditRow}>
                   <div className={styles.creditAvatar}>
                    <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 14.5c-2.49 0-4.5-2.01-4.5-4.5S9.51 7.5 12 7.5s4.5 2.01 4.5 4.5-2.01 4.5-4.5 4.5zm0-5.5c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1z" />
                    </svg>
                  </div>
                  <div className={styles.creditDetails}>
                    <div className={styles.creditName}>{sample.trackTitle}</div>
                    <div className={styles.creditRole}>Sampled in ({sample.sampleType}) by {sample.artistName || "Unknown"}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Bio Modal */}
      {showBioModal && artistData?.bio && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalContent}>
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>About {artistName}</h2>
              <button className={styles.modalCloseBtn} onClick={() => setShowBioModal(false)} aria-label="Close bio">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className={styles.modalBody}>
               {artistData.imageUrl && (
                  <img src={artistData.imageUrl} alt={artistName} className={styles.modalImage} referrerPolicy="no-referrer" />
               )}
              <p className={styles.fullBio}>{artistData.bio}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
