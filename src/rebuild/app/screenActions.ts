"use client";
import { useEffect, useMemo } from "react";

/** A screen action belongs to the account and screen that started it. */
export class ScreenActionScope {
 constructor(readonly accountId:string|null|undefined=null,readonly screen=""){}
 private active=true;
 private operations=new Map<string,AbortController>();
 begin(key:string){
  if(!this.active||this.operations.has(key))return null;
  const controller=new AbortController();this.operations.set(key,controller);return controller;
 }
 current(key:string,controller:AbortController){return this.active&&!controller.signal.aborted&&this.operations.get(key)===controller;}
 finish(key:string,controller:AbortController){
  if(this.operations.get(key)!==controller)return false;
  this.operations.delete(key);return this.active;
 }
 cancel(key:string){this.operations.get(key)?.abort();}
 activate(){this.active=true;}
 dispose(){this.active=false;for(const controller of this.operations.values())controller.abort();this.operations.clear();}
}

export function useScreenActions(accountId:string|null|undefined,screen=""){
 const scope=useMemo(()=>new ScreenActionScope(accountId,screen),[accountId,screen]);
 useEffect(()=>{scope.activate();return()=>scope.dispose();},[scope]);
 return scope;
}
