import { jsonBody, productResponse } from "@/rebuild/data/http";
import { clearPersonalizationData, exportPersonalizationData } from "@/rebuild/data/personalization";
export async function GET(request:Request){return productResponse(request,account=>exportPersonalizationData(account.id));}
export async function DELETE(request:Request){return productResponse(request,async account=>clearPersonalizationData(account.id,await jsonBody(request)));}
