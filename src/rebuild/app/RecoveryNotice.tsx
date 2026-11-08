"use client";
import Link from "next/link";
import { useState } from "react";
import { userIssue, type ErrorContext } from "./errors";
import { Blossom } from "./Brand";
import { Icon } from "./Icon";
import s from "./recovery.module.css";
export function RecoveryNotice({error,retry,context="page",compact=false,href,linkLabel,onDismiss,dismissible=compact||context==="download"}:{error:unknown;retry?:()=>void;context?:ErrorContext;compact?:boolean;href?:string;linkLabel?:string;onDismiss?:()=>void;dismissible?:boolean}) {
 const [dismissed,setDismissed]=useState<{error:unknown}|null>(null);
 const issue=userIssue(error,context);const target=href||issue.href;
 if(dismissed?.error===error)return null;
 return <div className={`${s.notice} ${compact?s.compact:""}`} role="alert"><Blossom/><div className={s.copy}><h3>{issue.title}</h3><p>{issue.message}</p><div className={s.actions}>{retry&&issue.kind!=="session"&&<button type="button" onClick={retry}>{issue.action}</button>}{target&&<Link href={target}>{linkLabel||issue.linkLabel||"Return to music"}<Icon name="external" size={14}/></Link>}</div></div>{(dismissible||onDismiss)&&<button type="button" className={s.dismiss} aria-label="Dismiss notice" onClick={()=>{setDismissed({error});onDismiss?.();}}><Icon name="close" size={16}/></button>}</div>;
}
