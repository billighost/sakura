"use client";
import { LoadError } from "@/rebuild/app/Elements";
export default function ErrorPage({retry}:{error:unknown;retry:()=>void}){return <LoadError message="This page could not open." retry={retry}/>;}
