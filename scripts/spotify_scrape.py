import sys
import json
import io

# Ensure UTF-8 output even on Windows command line
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

try:
    from spotify_scraper import SpotifyClient
except ImportError:
    print(json.dumps({"error": "spotifyscraper library not installed"}))
    sys.exit(1)

def extract_playlist(playlist_url_or_id):
    try:
        with SpotifyClient() as client:
            playlist = client.get_playlist(playlist_url_or_id)
            
            tracks = []
            for item in playlist.tracks:
                # In spotifyscraper, item might be a PlaylistTrack with .track attribute or direct
                t = getattr(item, 'track', item)
                
                title = getattr(t, 'name', None) or getattr(t, 'title', 'Unknown')
                
                # Extract artist names
                artists_list = []
                if hasattr(t, 'artists') and t.artists:
                    for a in t.artists:
                        if hasattr(a, 'name') and a.name:
                            artists_list.append(a.name)
                        elif isinstance(a, str):
                            artists_list.append(a)
                elif hasattr(t, 'artist') and t.artist:
                    if hasattr(t.artist, 'name') and t.artist.name:
                        artists_list.append(t.artist.name)
                    elif isinstance(t.artist, str):
                        artists_list.append(t.artist)
                
                artist_name = ", ".join(artists_list) if artists_list else "Unknown"
                
                # Duration
                duration_ms = getattr(t, 'duration_ms', 0) or 0
                duration_sec = int(duration_ms / 1000) if duration_ms else 0
                
                # Cover art
                cover_url = ""
                album = getattr(t, 'album', None)
                if album and hasattr(album, 'images') and album.images:
                    cover_url = album.images[0].url if hasattr(album.images[0], 'url') else str(album.images[0])
                elif hasattr(t, 'images') and t.images:
                    cover_url = t.images[0].url if hasattr(t.images[0], 'url') else str(t.images[0])
                
                tracks.append({
                    "title": title,
                    "artist": artist_name,
                    "duration": duration_sec,
                    "coverUrl": cover_url,
                    "messageId": 0
                })
            
            return {
                "name": getattr(playlist, 'name', 'Imported Playlist'),
                "total": len(tracks),
                "tracks": tracks
            }
    except Exception as e:
        return {"error": str(e)}

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No URL provided"}))
        sys.exit(1)
        
    url = sys.argv[1]
    result = extract_playlist(url)
    print(json.dumps(result))
