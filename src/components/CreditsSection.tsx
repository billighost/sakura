import { useEffect, useState } from "react";
import styles from "./CreditsSection.module.css";

interface CreditsSectionProps {
  trackId: string;
  artistName: string;
  artistId?: string;
  onClose: () => void;
}

export function CreditsSection({ trackId, artistName, artistId, onClose }: CreditsSectionProps) {
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
  }, [trackId, artistId]);

  return (
    <div className={styles.container} data-block-drag>
      <div className={styles.header}>
        <span>Credits</span>
        <button className={styles.closeBtn} onClick={onClose} aria-label="Close credits">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {loading ? (
        <div className={styles.loading}>Loading credits...</div>
      ) : (
        <div className={styles.content}>
          {/* Main Artist Card */}
          <div className={styles.artistCard}>
            {artistData?.imageUrl ? (
              <img src={artistData.imageUrl} alt={artistName} className={styles.artistImage} />
            ) : (
              <div className={`${styles.artistImage} ${styles.artistFallback}`}>
                <svg viewBox="0 0 24 24" fill="currentColor" width="32" height="32">
                  <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
                </svg>
              </div>
            )}
            <div className={styles.artistInfo}>
              <div className={styles.artistRole}>Main Artist</div>
              <div className={styles.artistName}>{artistName}</div>
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
                  <img src={artistData.imageUrl} alt={artistName} className={styles.modalImage} />
               )}
              <p className={styles.fullBio}>{artistData.bio}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
