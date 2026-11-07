import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { getRebuildPool } from "./data/db";
import { sameRequestOrigin } from "./requestOrigin";
const attempts=new Map<string,{count:number;expires:number}>();
export async function registerAccount(request:Request):Promise<Response>{
 if(!sameRequestOrigin(request))return Response.json({error:"Request origin is not allowed."},{status:403});
 const ip=request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()||"local";const now=Date.now();const entry=attempts.get(ip);
 if(entry&&entry.expires>now&&entry.count>=8)return Response.json({error:"Please wait a little before trying again."},{status:429,headers:{"Retry-After":"900"}});
 attempts.set(ip,{count:entry&&entry.expires>now?entry.count+1:1,expires:now+900000});if(attempts.size>2000)for(const [key,v]of attempts){if(v.expires<=now)attempts.delete(key);}
 const raw=await request.text();if(raw.length>4096)return Response.json({error:"The request is too large."},{status:413});
 let data:Record<string,unknown>;try{data=JSON.parse(raw);}catch{return Response.json({error:"Please send a valid registration."},{status:400});}
 const username=typeof data.username==="string"?data.username.trim().toLowerCase():"";const email=typeof data.email==="string"?data.email.trim().toLowerCase():"";const password=data.password;
 if(!/^[a-z0-9_]{3,30}$/.test(username))return Response.json({error:"Use 3–30 letters, numbers, or underscores for your username."},{status:400});
 if(email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return Response.json({error:"Enter a valid email address."},{status:400});
 if(typeof password!=="string"||password.length<10||password.length>256)return Response.json({error:"Use a password between 10 and 256 characters."},{status:400});
 const hash=await bcrypt.hash(password,12);
 try{const result=await getRebuildPool().query('INSERT INTO public."User" (id,username,email,"passwordHash") VALUES ($1::uuid,$2,$3,$4) RETURNING id, username, email',[randomUUID(),username,email,hash]);return Response.json({user:result.rows[0]},{status:201,headers:{"Cache-Control":"no-store"}});}
 catch(error){if((error as {code?:string}).code==="23505")return Response.json({error:"That username or email already has a home here."},{status:409});console.error("[Sakura] Registration failed");return Response.json({error:"Registration couldn’t finish. Please try again."},{status:503});}
}
