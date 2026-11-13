"use client";
import { useState } from "react";
import { SelectPopover } from "./SelectPopover";
import { useMusic } from "./MusicContext";
import { useResource, invalidateResources } from "./resources";
import { invalidateRecommendationResources } from "./recommendationResources";
import { useScreenActions } from "./screenActions";
import { requestJson, readJsonResponse,userMessage } from "./errors";
import { musicTrack } from "./types";
import { Button, LoadError } from "./Elements";
import { Blossom } from "./Brand";
import { Icon } from "./Icon";
import { PlayerButton, PlayerDialog } from "../player/CommonPrimitives";
import { requestDialogClose } from "./dialogLifecycle";
import type { TasteFeedback } from "../recommendations/personalization";
import s from "./listening-profile.module.css";

type Scope = "history" | "feedback" | "all";
type Period = "week" | "month" | "all";
interface Feedback { target: "recording" | "artist"; targetId: string; kind: "love" | "less" | "block" | "snooze"; expiresAt?: string | null; updatedAt?: string; track?: Record<string, unknown>; name?: string; active?: boolean }
const scopes: Record<Scope, string> = { history: "Listening history", feedback: "Taste adjustments", all: "History & taste adjustments" };
const periods: Record<Period, string> = { week: "The last 7 days", month: "The last 30 days", all: "All time" };
function feedbackTitle(item: Feedback) {
  if (item.name) return item.name;
  try { if (item.track) return musicTrack(item.track).title; } catch {}
  return item.target === "artist" ? "An artist" : "A song";
}
function feedbackDescription(item: Feedback, timeZone?: string) {
  if (item.active === false) return "This exclusion has expired";
  if (item.kind === "love") return "Recommended more often";
  if (item.kind === "less") return "Recommended less often";
  if (item.expiresAt) return `Excluded until ${new Date(item.expiresAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone })}`;
  return "Excluded from recommendations";
}

export function PersonalizationDataControls() {
  const { account } = useMusic();
  return <DataControls key={account?.id || "guest"}/>;
}

function DataControls() {
  const music = useMusic(), accountId = music.account?.id || null;
  const resource = useResource<{ feedback: Feedback[] }>(accountId, "/api/v2/taste");
  const actions = useScreenActions(accountId, "personalization-data");
  const [scope, setScope] = useState<Scope>("history"), [period, setPeriod] = useState<Period>("all");
  const [confirmation, setConfirmation] = useState(false), [busy, setBusy] = useState(false), [exporting, setExporting] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null), [error, setError] = useState<string | null>(null), [showAll, setShowAll] = useState(false);
  async function restore(item: Feedback) {
    if (!accountId) return;
    const controller = actions.begin("restore"); if (!controller) return;
    setRestoring(item.target + item.targetId); setError(null);
    try {
      const result=await requestJson<{mutationAt?:string}>("/api/v2/taste", { method: "DELETE", signal: controller.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ target: item.target, targetId: item.targetId }) }, { context: "save", accountId });
      if (!actions.current("restore", controller)) return;
      invalidateRecommendationResources(accountId); window.dispatchEvent(new CustomEvent("sakura-taste-updated", { detail: { accountId, removedTargetId: item.targetId, target: item.target,mutationAt:result.mutationAt } }));
      music.notify("This recommendation choice has been removed.");
    } catch (failure) { if (actions.current("restore", controller)) setError(userMessage(failure, "save")); }
    finally { if (actions.finish("restore", controller)) setRestoring(null); }
  }
  async function clear() {
    if (!accountId) return;
    const controller = actions.begin("clear"); if (!controller) return;
    setBusy(true); setError(null);
    try {
      const result = await requestJson<{ cutoff?: string; tasteFeedback?: TasteFeedback[]; feedbackAuthoritative?: boolean }>("/api/v2/personalization/data", { method: "DELETE", signal: controller.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope, period }) }, { context: "save", accountId });
      if (!actions.current("clear", controller)) return;
      const detail = { accountId, scope, period, cutoff: result.cutoff, tasteFeedback: result.tasteFeedback, feedbackAuthoritative: result.feedbackAuthoritative };
      if (scope === "history" || scope === "all") window.dispatchEvent(new CustomEvent("sakura-history-cleared", { detail }));
      window.dispatchEvent(new CustomEvent("sakura-personalization-cleared", { detail }));
      if(scope === "history" || scope === "all")invalidateResources(accountId, "/api/v2/", true);
      else for(const prefix of ["/api/v2/taste","/api/v2/feed","/api/v2/home","/api/v2/mixes","/api/v2/search/suggestions"])invalidateResources(accountId,prefix);
      music.notify(`${scopes[scope]} cleared. Your liked songs, playlists, and downloads are kept.`);
      requestDialogClose(() => setConfirmation(false));
    } catch (failure) { if (actions.current("clear", controller)) setError(userMessage(failure, "save")); }
    finally { if (actions.finish("clear", controller)) setBusy(false); }
  }
  async function exportData() {
    if (!accountId) return;
    const controller = actions.begin("export"); if (!controller) return;
    setExporting(true); setError(null);
    const transfer=new AbortController(),abort=()=>transfer.abort(controller.signal.reason);
    controller.signal.addEventListener("abort",abort,{once:true});
    if(controller.signal.aborted)abort();
    const timeout=setTimeout(()=>transfer.abort(new DOMException("Export timed out","TimeoutError")),300000);
    try {
      const response=await fetch("/api/v2/personalization/data",{credentials:"same-origin",signal:transfer.signal,headers:{"X-Sakura-Account":accountId,"X-Sakura-DTO":"3"}});
      if(!response.ok)await readJsonResponse(response,{context:"save"});
      // Keep the complete file in native Blob storage. Parsing and pretty
      // stringifying every measurement creates two unnecessary JS copies.
      const file=await response.blob();
      if (!actions.current("export", controller)) return;
      const url = URL.createObjectURL(file);
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = `sakura-my-listening-data-${new Date().toISOString().slice(0, 10)}.json`; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000); music.notify("Your data export is ready.");
    } catch (failure) { if (actions.current("export", controller)) setError(userMessage(failure, "save")); }
    finally { clearTimeout(timeout);controller.signal.removeEventListener("abort",abort);if (actions.finish("export", controller)) setExporting(false); }
  }
  const feedback = resource.data?.feedback || [], displayed = showAll ? feedback : feedback.slice(0, 5);
  return <section className={s.dataControls} id="listening-data" aria-label="Your listening data">
    <div className={s.sectionPrelude}><Icon name="read"/><span>Your data, your choice</span></div>
    <h2>Your history.<br/><em>Your choice.</em></h2>
    <p className={s.sectionDescription}>View the data used for recommendations, export a copy, or clear what you choose.</p>
    <details className={s.adjustments}>
      <summary><span>Taste choices & song exclusions</span><small>{feedback.filter(item => item.active !== false).length} active</small><Icon name="chevron" size={15}/></summary>
      {resource.loading && !resource.data ? <p className={s.smallNote} role="status">Loading taste choices…</p> : resource.error && !resource.data ? <LoadError message={resource.error} retry={resource.retry}/> : <>
        {!feedback.length && <p className={s.smallNote}>No exclusions or taste choices yet. Manage a song&apos;s influence through its options.</p>}
        <ul className={s.feedbackList}>{displayed.map(item => <li key={item.target + item.targetId}><span><b dir="auto">{feedbackTitle(item)}</b><small>{feedbackDescription(item, music.settings.timeZone)}</small></span><button type="button" disabled={restoring !== null || busy} aria-label={`Remove taste adjustment for ${feedbackTitle(item)}`} onClick={() => void restore(item)}>{restoring === item.target + item.targetId ? "Restoring…" : "Undo"}<Icon name="back" size={14}/></button></li>)}</ul>
        {feedback.length > 5 && <button type="button" className={s.textButton} aria-expanded={showAll} onClick={() => setShowAll(value => !value)}>{showAll ? "Show fewer adjustments" : `See all ${feedback.length} adjustments`}</button>}
      </>}
    </details>
    <div className={s.dataSelects}><label>What to clear<SelectPopover label="What to clear" value={scope} onChange={setScope} options={Object.entries(scopes).map(([value,label])=>({value:value as Scope,label}))}/></label><label>Time period<SelectPopover label="Time period" value={period} onChange={setPeriod} options={Object.entries(periods).map(([value,label])=>({value:value as Period,label}))}/></label></div>
    <div className={s.dataActions}><Button secondary icon="download" disabled={exporting || busy || !accountId} onClick={() => void exportData()}>{exporting ? "Preparing your data…" : "Export my data"}</Button><button className={s.clearButton} type="button" disabled={busy || !accountId} onClick={() => { setError(null); setConfirmation(true); }}><Icon name="trash" size={17}/>Clear selected data</button></div>
    {error && !confirmation && <p className={s.error} role="alert">{error}</p>}
    <p className={s.smallNote}>Your listening record includes audible time, song positions, finishes, skips, and listening hours. Published genre tags help describe the music. You can pause learning in your feed settings.</p>
    {confirmation && <PlayerDialog subtitle="YOUR DATA, YOUR CHOICE" title="Clear selected data?" appearance="note" closeDisabled={busy} className={s.clearDialog} onClose={() => setConfirmation(false)} footer={<div className={s.dialogActions}><PlayerButton secondary autoFocus disabled={busy} onClick={() => requestDialogClose(() => setConfirmation(false))}>Keep my data</PlayerButton><PlayerButton className={s.confirmClear} disabled={busy} onClick={() => void clear()}>{busy ? "Clearing your data…" : "Clear this data"}</PlayerButton></div>}>
      <div className={s.clearSummary}><Blossom/><div><b>{scopes[scope]}</b><span>{periods[period]}</span></div></div>
      <p className={s.clearDescription}>{scope === "feedback" ? "This removes the selected taste choices and song exclusions. Excluded songs can appear in recommendations again." : `This removes ${period === "all" ? "all recorded listening sessions" : "whole listens that overlap the selected period"}${scope === "all" ? " and the selected taste choices and song exclusions" : ""}. Listening totals and recommendations will use the history you keep. Your saved listening stories are cleared too.`}</p>
      <p className={s.keepNote}>Clearing this data cannot be undone. Your likes, playlists, preferences, and downloaded songs stay with you.</p>
      {scope !== "feedback" && period !== "all" && <p className={s.smallNote}>Older imported listening totals can lack session dates. Choose “All time” to clear those totals completely.</p>}
      {error && <p className={s.error} role="alert">{error}</p>}
    </PlayerDialog>}
  </section>;
}
