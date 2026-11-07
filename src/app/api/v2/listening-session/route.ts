import {jsonBody,productResponse} from "@/rebuild/data/http";
import {getSession,putSession} from "@/rebuild/data/session";
export async function GET(request:Request){return productResponse(request,a=>getSession(a.id));}
export async function PUT(request:Request){return productResponse(request,async a=>putSession(a.id,await jsonBody(request)));}
