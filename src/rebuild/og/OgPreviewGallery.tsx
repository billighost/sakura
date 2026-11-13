"use client";
/* eslint-disable @next/next/no-img-element -- Compare the exact generated PNGs, including their download URLs. */
import { useEffect, useRef, useState } from "react";
import { Blossom, Branch } from "../app/Brand";
import { OG_DIRECTIONS, OG_PAGES, OG_PREVIEW_ORIGIN, getOgPreviewPage, isOgDirection, isOgFixture, ogPreviewImageUrl, type OgDirection, type OgFixture, type OgGroup, type OgPreviewPage } from "./catalog";
import s from "./preview.module.css";
import { OG_SELECTIONS } from "./selections";

const storageKey = "sakura-og-preview-choices-v1";
const groups: OgGroup[] = ["Start here", "Music & sharing", "Bloom", "Everyday pages", "About & account"];
type Choices = Partial<Record<string, OgDirection>>;
type Zoom = { page: string; direction: OgDirection; fixture: OgFixture };

function SmallIcon({ name }: { name: "arrow" | "check" | "download" | "image" | "chat" | "expand" | "copy" | "close" }) {
  const paths = {
    arrow: <path d="M5 15 15 5M5 5h10v10" />,
    check: <path d="m4 10 4 4 8-8" />,
    download: <><path d="M10 3v10m-4-4 4 4 4-4M4 14v3h12v-3" /></>,
    image: <><rect x="3" y="3" width="14" height="14" rx="3" /><path d="m4 14 4-4 3 3 3-5 3 5" /><circle cx="8" cy="7" r="1" /></>,
    chat: <path d="M17 9a7 7 0 0 1-7 7H5l-3 2V9a7 7 0 1 1 15 0Z" />,
    expand: <path d="M3 8V3h5m4 0h5v5M3 12v5h5m4 0h5v-5" />,
    copy: <><rect x="7" y="7" width="10" height="10" rx="2" /><path d="M13 7V3H3v10h4" /></>,
    close: <path d="m5 5 10 10M15 5 5 15" />,
  };
  return <svg width="19" height="19" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function Png({ page, direction, fixture, className }: { page: OgPreviewPage; direction: OgDirection; fixture: OgFixture; className?: string }) {
  return <img className={className} src={ogPreviewImageUrl(page.id, direction, fixture, "webp")} width="1200" height="630" alt={`${page.label} — ${OG_DIRECTIONS.find(item => item.id === direction)?.name}: ${page.title.replaceAll("\n", " ")}`} />;
}

function WhatsAppCard({ page, direction, fixture, onEnlarge }: { page: OgPreviewPage; direction: OgDirection; fixture: OgFixture; onEnlarge: () => void }) {
  const title = page.kind === "brand" ? "Sakura — your little music world" : page.title.replaceAll("\n", " ") + " · Sakura";
  return <div className={s.chatScreen} data-whatsapp-preview>
    <div className={s.chatHeader}><SmallIcon name="chat" /><span>A LITTLE SOMETHING FOR YOU</span><span className={s.chatDot} /></div>
    <div className={s.message}>
      <button className={s.chatImage} type="button" onClick={onEnlarge} aria-label={`Enlarge ${page.label} option ${direction.toUpperCase()}`}><Png page={page} direction={direction} fixture={fixture} /></button>
      <div className={s.chatCopy}><span>sakura-orcin.vercel.app</span><strong>{title}</strong><p>{page.description}</p></div>
      <div className={s.chatUrl}>{OG_PREVIEW_ORIGIN}</div><div className={s.sentAt}>12:34 <span>✓✓</span></div>
    </div>
    <p className={s.chatNote}>A WhatsApp-style preview at chat size.</p>
  </div>;
}

export function OgPreviewGallery() {
  const [pageId, setPageId] = useState("default");
  const [fixture, setFixture] = useState<OgFixture>("original");
  const [view, setView] = useState<"image" | "chat">("image");
  const [choices, setChoices] = useState<Choices>({ ...OG_SELECTIONS });
  const [status, setStatus] = useState("");
  const [zoom, setZoom] = useState<Zoom | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const page = getOgPreviewPage(pageId, fixture) || OG_PAGES[0];
  const chosenCount = OG_PAGES.filter(item => choices[item.id]).length;

  useEffect(() => {
    let active = true;
    let restored: Choices = { ...OG_SELECTIONS };
    try {
      const raw: unknown = JSON.parse(localStorage.getItem(storageKey) || "{}");
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        const values = raw as Record<string, unknown>;
        restored = { ...OG_SELECTIONS, ...Object.fromEntries(OG_PAGES.flatMap(item => {
          const direction = values[item.id];
          return isOgDirection(direction) ? [[item.id, direction] as const] : [];
        })) };
      }
    } catch { /* Browser storage is optional; choices still work in this visit. */ }
    const hash = location.hash.slice(1);
    queueMicrotask(() => {
      if (!active) return;
      setChoices(restored);
      if (OG_PAGES.some(item => item.id === hash)) setPageId(hash);
    });
    return () => { active = false; };
  }, []);

  function selectPage(id: string) {
    if (!OG_PAGES.some(item => item.id === id)) return;
    setPageId(id);
    history.replaceState(null, "", "#" + id);
  }
  function saveChoices(next: Choices) {
    setChoices(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Export remains available. */ }
  }
  function choose(id: string, direction: OgDirection) {
    saveChoices({ ...choices, [id]: direction });
    setStatus(`${OG_PAGES.find(item => item.id === id)?.label}: option ${direction.toUpperCase()} selected.`);
  }
  function chooseAll(direction: OgDirection) {
    saveChoices(Object.fromEntries(OG_PAGES.map(item => [item.id, direction])));
    setStatus(`Option ${direction.toUpperCase()} selected for all ${OG_PAGES.length} pages. You can change any page separately.`);
  }
  function selectionText() {
    return ["Sakura — my OG image choices", "", ...OG_PAGES.map(item => {
      const direction = OG_DIRECTIONS.find(option => option.id === choices[item.id]);
      return `${item.label} (${item.route}): ${direction ? direction.id.toUpperCase() + " — " + direction.name : "still deciding"}`;
    }), "", "Generated from Sakura’s OG preview gallery."].join("\n");
  }
  function downloadChoices() {
    const url = URL.createObjectURL(new Blob([selectionText()], { type: "text/plain;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = "sakura-og-choices.txt"; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus("Your choices have been saved to a text file.");
  }
  async function copyChoices() {
    try { await navigator.clipboard.writeText(selectionText()); setStatus("Your choices are copied. Paste them into our chat when you’re ready."); }
    catch { setStatus("Use “Save choices” to download your selections in this browser."); }
  }
  function enlarge(direction: OgDirection) {
    setZoom({ page: page.id, direction, fixture });
    dialog.current?.showModal();
  }
  function closeZoom() { dialog.current?.close(); setZoom(null); }
  const zoomPage = zoom && getOgPreviewPage(zoom.page, zoom.fixture);
  const zoomDirection = OG_DIRECTIONS.find(item => item.id === zoom?.direction);

  return <main className={s.root}>
    <header className={s.header}><a className={s.brand} href="/og-preview" aria-label="Sakura OG collection"><Blossom /><span>sakura</span><span className={s.brandDivider} /><small>The sharing collection</small></a><span className={s.previewTag}><span />Design preview</span></header>
    <section className={s.hero}>
      <div><p className={s.eyebrow}>A LITTLE BEAUTY, BEFORE THE FIRST LISTEN</p><h1>Good music deserves<br /><em>a beautiful hello.</em></h1><p className={s.intro}>Three ways to share your little music world.<br className={s.desktopBreak} /> Choose the one you love for each page.</p>
        <div className={s.stats}><span><strong>26</strong> page contexts</span><i /><span><strong>3</strong> art directions</span><i /><span><strong>1200 × 630</strong> PNG</span></div>
      </div>
      <div className={s.heroArtwork} aria-hidden="true"><div className={s.heroDisc}><Blossom /></div><div className={s.heroOrbit} /><Branch className={s.heroBranch} /><span className={s.heroCaption}>music, with a little soul.</span></div>
    </section>
    <div className={s.workspace}>
      <aside className={s.sidebar} aria-label="Preview page navigation">
        <div className={s.sidebarHeading}><span>THE WHOLE LITTLE WORLD</span><span>26</span></div>
        <nav>{groups.map(group => <div className={s.navGroup} key={group}><h2>{group}</h2>{OG_PAGES.filter(item => item.group === group).map(item => <button type="button" key={item.id} onClick={() => selectPage(item.id)} className={pageId === item.id ? s.navSelected : ""} aria-current={pageId === item.id ? "page" : undefined}><span>{item.label}</span>{choices[item.id] ? <span className={s.navChoice}>{choices[item.id]?.toUpperCase()}</span> : <span className={s.navDot} />}</button>)}</div>)}</nav>
        <div className={s.sidebarFoot}><Blossom /><p>A little care for<br />every shared link.</p></div>
      </aside>
      <section className={s.collection} aria-labelledby="og-current-page">
        <div className={s.sectionHeader}><div><p className={s.eyebrow}>THE PREVIEW COLLECTION</p><h2 id="og-current-page">{page.label}</h2><span className={s.route}>{page.route}</span></div><label className={s.pagePicker}><span>Jump to a page</span><select aria-label="Preview page" value={pageId} onChange={event => selectPage(event.target.value)}>{groups.map(group => <optgroup label={group} key={group}>{OG_PAGES.filter(item => item.group === group).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</optgroup>)}</select></label></div>
        <div className={s.toolbar}><div className={s.viewSwitch} role="group" aria-label="Preview format"><button type="button" onClick={() => setView("image")} aria-pressed={view === "image"} className={view === "image" ? s.viewActive : ""}><SmallIcon name="image" />Image</button><button type="button" onClick={() => setView("chat")} aria-pressed={view === "chat"} className={view === "chat" ? s.viewActive : ""}><SmallIcon name="chat" />WhatsApp</button></div><label className={s.fixturePicker}><span>Try it with</span><select aria-label="Preview sample" value={fixture} onChange={event => { if (isOgFixture(event.target.value)) setFixture(event.target.value); }}><option value="original">Original copy</option><option value="long">A long title</option><option value="missing">No artwork</option></select></label></div>
        <div className={s.cards}>{OG_DIRECTIONS.map(direction => {
          const selected = choices[page.id] === direction.id;
          return <article key={direction.id} className={`${s.card} ${selected ? s.cardSelected : ""}`} data-og-option={direction.id}>
            <div className={s.directionTitle}><span className={s.letter} style={{ background: direction.color, color: direction.ink }}>{direction.id.toUpperCase()}</span><h3>{direction.name}</h3>{selected && <span className={s.selectedMark} aria-label="Selected"><SmallIcon name="check" /></span>}</div>
            <p className={s.mood}>{direction.mood}</p>
            {view === "chat" ? <WhatsAppCard page={page} direction={direction.id} fixture={fixture} onEnlarge={() => enlarge(direction.id)} /> : <button className={s.imageButton} type="button" onClick={() => enlarge(direction.id)} aria-label={`Enlarge ${page.label} option ${direction.id.toUpperCase()}`}><Png page={page} direction={direction.id} fixture={fixture} /><span className={s.expandIcon}><SmallIcon name="expand" /></span></button>}
            <p className={s.directionDetail}>{direction.detail}</p>
            <div className={s.cardActions}><button type="button" className={`${s.chooseButton} ${selected ? s.chosenButton : ""}`} onClick={() => choose(page.id, direction.id)} aria-pressed={selected}>{selected ? <><SmallIcon name="check" />Chosen</> : <>Choose {direction.id.toUpperCase()}<SmallIcon name="arrow" /></>}</button><a href={ogPreviewImageUrl(page.id, direction.id, fixture)} download={`sakura-${page.id}-${direction.id}.png`} className={s.downloadImage} aria-label={`Download ${page.label} option ${direction.id.toUpperCase()} PNG`}><SmallIcon name="download" /><span>PNG</span></a></div>
            <button type="button" className={s.applyAll} onClick={() => chooseAll(direction.id)}>Use {direction.id.toUpperCase()} for every page</button>
          </article>;
        })}</div>
        <div className={s.sampleNote}><span className={s.sampleDot} /><p>Illustrative content and catalogue artwork. Every image is generated with code.</p><span>Click an image to see it in full.</span></div>
        <div className={s.selectionBar}><div className={s.selectionCount}><span className={s.countFlower}><Blossom /></span><div><strong>{chosenCount} <span>/ {OG_PAGES.length}</span></strong><p>{chosenCount === OG_PAGES.length ? "Your little collection is ready." : "A beautiful hello, one page at a time."}</p></div></div><div className={s.exportActions}><button type="button" disabled={!chosenCount} onClick={() => void copyChoices()}><SmallIcon name="copy" />Copy choices</button><button type="button" disabled={!chosenCount} onClick={downloadChoices}><SmallIcon name="download" />Save choices</button></div></div>
        <div className={s.status} role="status" aria-live="polite">{status || "Your choices are saved in this browser. Copy or save them when you’re ready."}</div>
        <details className={s.coverage}><summary><span>Every page, at a glance</span><span>{chosenCount} chosen <span className={s.summaryPlus}>+</span></span></summary><div className={s.coverageGrid}>{OG_PAGES.map(item => <button type="button" key={item.id} onClick={() => { selectPage(item.id); document.getElementById("og-current-page")?.scrollIntoView({ block: "start", behavior: "smooth" }); }}><span>{item.label}</span>{choices[item.id] ? <strong className={s.coverageChosen}>{choices[item.id]?.toUpperCase()}</strong> : <span className={s.coverageEmpty}>Still deciding</span>}</button>)}</div></details>
      </section>
    </div>
    <footer className={s.footer}><span>sakura <i>·</i> your little music world</span><span>Made with a little care, down to the last petal.</span></footer>
    <dialog ref={dialog} className={s.dialog} onCancel={() => setZoom(null)} onClick={event => { if (event.target === event.currentTarget) closeZoom(); }} aria-label="Full size OG image preview">
      {zoom && zoomPage && zoomDirection && <><div className={s.dialogHeader}><div><span className={s.eyebrow}>{zoomPage.label} · OPTION {zoom.direction.toUpperCase()}</span><h2>{zoomDirection.name}</h2></div><button type="button" aria-label="Close full size preview" onClick={closeZoom}><SmallIcon name="close" /></button></div><Png page={zoomPage} direction={zoom.direction} fixture={zoom.fixture} className={s.fullImage} /><div className={s.dialogFooter}><div className={s.zoomOptions} role="group" aria-label="Full size preview direction">{OG_DIRECTIONS.map(option => <button key={option.id} type="button" onClick={() => setZoom({ ...zoom, direction: option.id })} className={zoom.direction === option.id ? s.zoomOptionSelected : ""} aria-pressed={zoom.direction === option.id}>{option.id.toUpperCase()}<span>{option.name}</span></button>)}</div><button className={s.dialogChoose} type="button" onClick={() => { choose(zoom.page, zoom.direction); closeZoom(); }}><SmallIcon name="check" />Choose {zoom.direction.toUpperCase()}</button></div></>}
    </dialog>
  </main>;
}
