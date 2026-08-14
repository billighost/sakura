import sys
import json
from spotify_scraper import SpotifyClient

def test_playlist(playlist_id_or_url):
    print(f"Testing SpotifyScraper on: {playlist_id_or_url}")
    with SpotifyClient() as client:
        playlist = client.get_playlist(playlist_id_or_url)
        print(f"Playlist Title: {playlist.name}")
        print(f"Total Tracks retrieved: {len(playlist.tracks)}")
        
        t = playlist.tracks[0]
        print("PlaylistTrack attributes:", dir(t))
        print("Track dict/vars:", vars(t) if hasattr(t, '__dict__') else t)
        
        results = []
        for track in playlist.tracks:
            # Let's inspect how artist and name are stored
            title = getattr(track, 'name', None) or getattr(track, 'title', 'Unknown')
            # Check artist / subtitle / artists
            artist = "Unknown"
            if hasattr(track, 'artist') and track.artist:
                artist = track.artist.name if hasattr(track.artist, 'name') else str(track.artist)
            elif hasattr(track, 'artists') and track.artists:
                artist = ", ".join([a.name if hasattr(a, 'name') else str(a) for a in track.artists])
            elif hasattr(track, 'subtitle') and track.subtitle:
                artist = str(track.subtitle)

            duration = int(track.duration_ms / 1000) if hasattr(track, 'duration_ms') and track.duration_ms else 0
            
            cover = None
            if hasattr(track, 'album') and track.album and hasattr(track.album, 'images') and track.album.images:
                cover = track.album.images[0].url
            elif hasattr(track, 'images') and track.images:
                cover = track.images[0].url if hasattr(track.images[0], 'url') else str(track.images[0])
            elif hasattr(track, 'cover_url'):
                cover = track.cover_url
            
            results.append({
                "title": title,
                "artist": artist,
                "duration": duration,
                "coverUrl": cover
            })
            
        print(f"\nSample of first 5 tracks extracted:")
        for r in results[:5]:
            print(f"  🎵 {r['title']} - {r['artist']} ({r['duration']}s)")

if __name__ == "__main__":
    url = sys.argv[1] if len(sys.argv) > 1 else "https://open.spotify.com/playlist/37i9dQZF1DX4JAvHpjipBk"
    test_playlist(url)
