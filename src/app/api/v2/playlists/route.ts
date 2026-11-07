import { productResponse,jsonBody } from "@/rebuild/data/http";
import { listPlaylists,createPlaylist } from "@/rebuild/data/collections";
export async function GET(request:Request){return productResponse(request,async a=>({playlists:await listPlaylists(a.id)}));}
export async function POST(request:Request){return productResponse(request,async a=>createPlaylist(a.id,await jsonBody(request)));}
