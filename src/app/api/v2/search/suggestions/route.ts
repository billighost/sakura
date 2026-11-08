import {productResponse} from "@/rebuild/data/http";
import {getSearchSuggestions} from "@/rebuild/recommendations/searchSuggestions";
export async function GET(request:Request){return productResponse(request,account=>getSearchSuggestions(account.id));}
