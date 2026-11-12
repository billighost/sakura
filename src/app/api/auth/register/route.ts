import { registerAccount } from "@/rebuild/registration";
import { withApiTiming } from "@/rebuild/server/performance";

export async function POST(request: Request) {
  return withApiTiming("/api/auth/register", request, () => registerAccount(request));
}
