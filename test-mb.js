const title = "Blinding Lights";
const artistName = "The Weeknd";

async function fetchMusicBrainz(url) {
  const res = await fetch(`https://musicbrainz.org/ws/2${url}`, {
    headers: {
      "User-Agent": "SakuraMusic/1.0.0 ( github.com/billighost/sakura )",
      "Accept": "application/json"
    }
  });
  if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
  return await res.json();
}

async function test() {
  try {
    const searchQuery = encodeURIComponent(`recording:"${title}" AND artist:"${artistName}"`);
    console.log("Searching:", searchQuery);
    const mbSearch = await fetchMusicBrainz(`/recording?query=${searchQuery}&limit=5&fmt=json`);
    
    if (mbSearch?.recordings?.length) {
      console.log(`Found ${mbSearch.recordings.length} recordings. Best match ID:`, mbSearch.recordings[0].id);
      
      const recordingId = mbSearch.recordings[0].id;
      const mbDetail = await fetchMusicBrainz(
        `/recording/${recordingId}?inc=artist-rels+work-rels+artist-credits&fmt=json`
      );
      
      console.log("Recording details relations:", JSON.stringify(mbDetail.relations, null, 2));

      const workRels = mbDetail.relations?.filter((r) => r['target-type'] === 'work' || r.work);
      if (workRels?.length) {
        console.log("Work relations found:", workRels.length);
        const workId = workRels[0].work?.id;
        console.log("Fetching work ID:", workId);
        if (workId) {
          const workDetail = await fetchMusicBrainz(
            `/work/${workId}?inc=artist-rels&fmt=json`
          );
          console.log("Work detail relations:", JSON.stringify(workDetail.relations, null, 2));
        }
      }
    }
  } catch(e) {
    console.error(e);
  }
}

test();
