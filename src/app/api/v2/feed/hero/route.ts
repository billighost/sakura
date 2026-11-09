import {productResponse} from "@/rebuild/data/http";
import {getPersonalizedHero} from "@/rebuild/recommendations/feed";

export async function GET(request:Request){
 return productResponse(request,account=>getPersonalizedHero(account.id,new URL(request.url)));
}
