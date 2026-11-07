import { auth } from "@/lib/auth";
import { readAccountById } from "./data/db";
export interface RebuildAccount {id:string;username:string;email:string;avatarUrl:string|null}
/** The signed session must still refer to an existing account. */
export async function requireRebuildAccount():Promise<RebuildAccount|null>{
 const session=await auth();const id=session?.user?.id;if(!id)return null;
 return readAccountById(id);
}
