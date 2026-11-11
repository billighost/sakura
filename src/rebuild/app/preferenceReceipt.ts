import {preferenceFieldRevisions,preferenceRevision,settingsFields} from "./preferences";
import type {UserSettings} from "./types";

/** A successful HTTP response alone cannot retire durable preference changes. */
export function validPreferenceReceipt(value:unknown,sent:Partial<UserSettings>,expectedRevision?:number){
  if(!value||typeof value!=="object"||Array.isArray(value))return false;
  const response=value as Record<string,unknown>,revision=preferenceRevision(response);
  if(revision===undefined||expectedRevision!==undefined&&revision<expectedRevision)return false;
  const raw=response.settings??response,settings=settingsFields(raw),fields=preferenceFieldRevisions(response);
  return Object.entries(sent).every(([key,choice])=>
    Object.prototype.hasOwnProperty.call(settings,key)&&
    JSON.stringify(settings[key as keyof UserSettings])===JSON.stringify(choice)&&
    Object.prototype.hasOwnProperty.call(fields,key)&&fields[key]<=revision
  );
}
