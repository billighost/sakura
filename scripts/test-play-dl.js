const play = require('play-dl');

async function testPlayDl() {
  const url = 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M';
  try {
    if (play.is_spotify_url(url)) {
      console.log("Fetching playlist with play-dl...");
      const playlistData = await play.spotify(url);
      console.log(`Playlist Name: ${playlistData.name}`);
      
      const allTracks = await playlistData.all_tracks();
      console.log(`Tracks count: ${allTracks.length}`);
      
      if (allTracks.length > 0) {
        console.log(`First track:`, allTracks[0]);
      }
    } else {
      console.log("Not a Spotify URL");
    }
  } catch (error) {
    console.error("Error fetching playlist:", error);
  }
}

testPlayDl();
