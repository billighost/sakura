"use client";
import { useRef, useState } from "react";
import { requestJson, UserFacingError, responseIssue } from "./errors";
import { RecoveryNotice } from "./RecoveryNotice";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Blossom, Branch } from "./Brand";
import s from "./ink.module.css";
export function AuthForms({register=false}:{register?:boolean}){
 const router=useRouter();const query=useSearchParams();const form=useRef<HTMLFormElement>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState<unknown>(null);
 async function submit(event:React.FormEvent<HTMLFormElement>){event.preventDefault();setBusy(true);setError(null);const data=new FormData(event.currentTarget);const username=String(data.get("username")||"").trim();const email=String(data.get("email")||"").trim();const password=String(data.get("password")||"");
  try{if(register){await requestJson("/api/auth/register",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username,email,password})},{context:"account"});}
   const result=await signIn("credentials",{identifier:register?username:String(data.get("identifier")||"").trim(),password,redirect:false});if(result?.error)throw new UserFacingError(result.error==="CredentialsSignin"?responseIssue(400,{error:"Invalid credentials"},"account"):responseIssue(503,null,"account"));
   const next=query.get("next");const target=next?.startsWith("/")&&!next.startsWith("//")?next:"/home";router.replace(register?"/onboarding":target);router.refresh();
  }catch(e){setError(e);}finally{setBusy(false);}
 }
 return <div className={s.authRoot}><div className={s.authArtwork}><Link href="/" className={s.brand}><Blossom/><span>sakura<small>your little music world</small></span></Link><Branch className={s.authBranch}/><div><span className={s.eyebrow}>音楽と、ひと息。</span><h2>Music, with<br/><em>room to breathe.</em></h2><p>A quiet place for the songs that feel like you.</p></div></div><form ref={form} className={s.authForm} onSubmit={submit}><span className={s.eyebrow}>{register?"A NEW LITTLE BEGINNING":"YOUR MUSIC HAS A HOME HERE"}</span><h1>{register?<>Make yourself<br/>at home.</>:<>It’s good to<br/>have you back.</>}</h1><p>{register?"A fresh collection. A familiar feeling.":"Come back to your little music world."}</p>{register?<><label>Your username<input name="username" autoComplete="username" pattern="[a-zA-Z0-9_]{3,30}" minLength={3} maxLength={30} placeholder="A name for your music world" required/></label><label>Email<input name="email" type="email" autoComplete="email" maxLength={254} placeholder="you@example.com" required/></label></>:<label>Username or email<input name="identifier" autoComplete="username" maxLength={254} required/></label>}<label>Password<input name="password" type="password" autoComplete={register?"new-password":"current-password"} minLength={register?10:1} maxLength={256} placeholder={register?"At least 10 characters":""} required/></label>{Boolean(error)&&<RecoveryNotice error={error} context="account" retry={()=>form.current?.requestSubmit()}/>}<button className={s.primaryButton} type="submit" disabled={busy}>{busy?"A little moment…":register?"Create your account":"Come on in"}</button><p>{register?"Already have a place here?":"New to Sakura?"} <Link href={register?"/login":"/register"}>{register?"Sign in":"Make yourself at home"}</Link></p><small>Your library and downloads stay private to your account.</small></form></div>;
}
