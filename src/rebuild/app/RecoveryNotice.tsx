"use client";
import Link from "next/link";
import { userIssue, type ErrorContext } from "./errors";
import { Blossom } from "./Brand";
import s from "./recovery.module.css";
export function RecoveryNotice({error,retry,context="page",compact=false,href,linkLabel}:{error:unknown;retry?:()=>void;context?:ErrorContext;compact?:boolean;href?:string;linkLabel?:string}) {
 const issue=userIssue(error,context);const target=href||issue.href;
 return <div className={`${s.notice} ${compact?s.compact:""}`} role="alert"><Blossom/><div><h3>{issue.title}</h3><p>{issue.message}</p><div className={s.actions}>{retry&&issue.kind!=="session"&&<button type="button" onClick={retry}>{issue.action}</button>}{target&&<Link href={target}>{linkLabel||issue.linkLabel||"Return to music"} <span aria-hidden="true">↗</span></Link>}</div></div></div>;
}
