import { jsonBody, productResponse } from "@/rebuild/data/http";
import { removeTaste, setTaste } from "@/rebuild/data/taste";
import { getTasteState } from "@/rebuild/data/tasteState";
export async function GET(request:Request){return productResponse(request,account=>getTasteState(account.id));}
export async function POST(request:Request){return productResponse(request,async account=>setTaste(account.id,await jsonBody(request)));}
export async function DELETE(request:Request){return productResponse(request,async account=>removeTaste(account.id,await jsonBody(request)));}
