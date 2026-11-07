import { randomBytes } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
const base=process.env.SAKURA_TEST_URL||"http://localhost:3000";
const file=".local/rebuild-test-account.json";
try{const existing=JSON.parse(await readFile(file,"utf8"));const response=await fetch(base+"/api/v2/profile",{headers:{Cookie:existing.cookie}});if(response.ok){console.log("Existing private test session is valid.");process.exit(0);}}catch{}
const suffix=randomBytes(5).toString("hex");const username="inkcheck_"+suffix;const email=username+"@example.test";const password=randomBytes(24).toString("base64url");
const register=await fetch(base+"/api/auth/register",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username,email,password})});const data=await register.json();if(!register.ok)throw new Error("Test registration failed: "+(data.error||register.status));
const cookies=new Map();function merge(response){for(const entry of response.headers.getSetCookie()){const raw=entry.split(";")[0];const split=raw.indexOf("=");cookies.set(raw.slice(0,split),raw.slice(split+1));}}const cookie=()=>Array.from(cookies,([k,v])=>k+"="+v).join("; ");
const csrf=await fetch(base+"/api/auth/csrf");merge(csrf);const csrfToken=(await csrf.json()).csrfToken;
const login=await fetch(base+"/api/auth/callback/credentials",{method:"POST",headers:{Cookie:cookie(),"Content-Type":"application/x-www-form-urlencoded","X-Auth-Return-Redirect":"1"},body:new URLSearchParams({csrfToken,identifier:username,password,callbackUrl:base+"/home"})});merge(login);
const profile=await fetch(base+"/api/v2/profile",{headers:{Cookie:cookie()}});if(!profile.ok)throw new Error("Test sign-in could not authenticate.");
await mkdir(".local",{recursive:true});await writeFile(file,JSON.stringify({accountId:data.user.id,username,email,password,cookie:cookie()},null,2));console.log("Private synthetic test account/session created in "+file);
