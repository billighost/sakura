import type {MusicTrack} from "./types";

type ArtistCredit=NonNullable<MusicTrack["artistCredits"]>[number];
export function artistCreditHref(credit:Pick<ArtistCredit,"artistId"|"reference"|"name">):string {
 return credit.artistId?"/artist/"+encodeURIComponent(credit.artistId):credit.reference?.provider==="deezer"?"/artist/"+encodeURIComponent(credit.reference.id):credit.reference?.provider==="spotify"?"/artist/"+encodeURIComponent("spotify:"+credit.reference.id):"/search?q="+encodeURIComponent(credit.name)+"&tab=Artists";
}
/** A linked guest must not become an unlinked lead artist's destination. */
export function primaryArtistHref(track:Pick<MusicTrack,"artistCredits"|"artists"|"artistId">):string {
 const credits=track.artistCredits||[],primary=credits.find(credit=>credit.role==="primary");
 return artistCreditHref(primary||{name:track.artists[0]||"",artistId:credits.length?null:track.artistId});
}
