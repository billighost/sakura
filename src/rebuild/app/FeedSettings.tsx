"use client";
import Link from "next/link";
import { useState } from "react";
import { useMusic } from "./MusicContext";
import { GardenSlider } from "./ListeningControls";
import { Button } from "./Elements";
import { Blossom } from "./Brand";
import { Icon } from "./Icon";
import type { UserSettings } from "./types";
import { FEED_DEFAULTS } from "./feedPreferences";
import s from "./listening-profile.module.css";

const BALANCED = { discovery: FEED_DEFAULTS.discovery, artistVariety: FEED_DEFAULTS.artistVariety, repeatTolerance: FEED_DEFAULTS.repeatTolerance, newReleaseBias: FEED_DEFAULTS.newReleaseBias, deepCutBias: FEED_DEFAULTS.deepCutBias, timeAware: FEED_DEFAULTS.timeAware };
const PRESETS = [
  { name: "Familiar", note: "More songs and artists you know.", values: { ...BALANCED, discovery: .15, artistVariety: .4, repeatTolerance: .7, deepCutBias: .2 } },
  { name: "Balanced", note: "Familiar songs alongside new discoveries.", values: BALANCED },
  { name: "Adventurous", note: "More unheard songs and different artists.", values: { ...BALANCED, discovery: .8, artistVariety: .85, repeatTolerance: .2, deepCutBias: .65 } },
];
const SLIDERS = [
  { key: "discovery", title: "Discovery balance", description: "Balance songs and artists you know with music you have yet to hear.", low: "Familiar", high: "Unfamiliar", fallback: .35 },
  { key: "artistVariety", title: "Artist variety", description: "Choose how widely recommendations are spread across artists.", low: "Fewer artists", high: "More variety", fallback: .65 },
  { key: "repeatTolerance", title: "Recent repeats", description: "Choose how often recently played songs can return.", low: "Fewer repeats", high: "More repeats", fallback: .45 },
  { key: "newReleaseBias", title: "New releases", description: "Give recently released music more priority when release dates are available.", low: "Any era", high: "More recent", fallback: .5 },
  { key: "deepCutBias", title: "More from familiar artists", description: "Favor unheard songs from artists you already listen to.", low: "Songs you know", high: "Unheard songs", fallback: .35 },
] as const;

export function FeedSettings() {
  const music = useMusic();
  const [saving, setSaving] = useState(false);
  const [genre, setGenre] = useState("");
  const [genreNotice, setGenreNotice] = useState("");
  async function change(patch: Partial<UserSettings>) {
    setSaving(true);
    try { await music.updateSettings(patch); }
    catch (error) { music.reportError(error, "save", () => void change(patch)); }
    finally { setSaving(false); }
  }
  const chosen = PRESETS.findIndex(preset => Object.entries(preset.values).every(([key, value]) => {
    const actual = music.settings[key as keyof UserSettings] ?? BALANCED[key as keyof typeof BALANCED];
    return typeof value === "number" ? Math.abs(Number(actual) - value) < .01 : actual === value;
  }));
  function addGenre() {
    const name = genre.trim(), current = music.settings.seedGenres;
    if (!name || saving) return;
    if (current.some(value => value.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      setGenreNotice("This genre is already selected."); return;
    }
    if (current.length >= 12) { setGenreNotice("You can choose up to 12 genres. Remove one to add another."); return; }
    setGenre(""); setGenreNotice(""); void change({ seedGenres: [...current, name] });
  }
  return <section className={s.feedSettings} id="your-feed" aria-label="Personalize your feed">
    <div className={s.sectionPrelude}><Blossom/><span>Your recommendation preferences</span></div>
    <h2>Your music,<br/><em>your way.</em></h2>
    <p className={s.sectionDescription}>Start with a preset or adjust each preference. Sliders change how strongly each preference shapes the mix.</p>
    <div className={s.presets} aria-label="Feed presets">{PRESETS.map((preset, index) => <button key={preset.name} type="button" aria-pressed={chosen === index} disabled={saving} onClick={() => void change(preset.values)}><span>{index === 0 ? <Icon name="home"/> : index === 1 ? <Blossom/> : <Icon name="discover"/>}</span><b>{preset.name}</b><small>{preset.note}</small></button>)}</div>
    <div className={s.feedSliders}>{SLIDERS.map(slider => {
      const value = Number(music.settings[slider.key] ?? slider.fallback);
      return <div className={s.feedSlider} key={slider.key}>
        <div><h3>{slider.title}</h3><span>{Math.round(value * 100)}%</span></div>
        <p>{slider.description}</p>
        <GardenSlider label={slider.title} value={value} valueText={`${Math.round(value * 100)} percent, from ${slider.low.toLowerCase()} to ${slider.high.toLowerCase()}`} onChange={next => void change({ [slider.key]: next })}/>
        <div className={s.sliderEnds}><span>{slider.low}</span><span>{slider.high}</span></div>
      </div>;
    })}</div>
    <div className={s.feedToggle}><div><b>Use my listening rhythm</b><p>Use your recorded listening hours to help shape recommendations for this time of day.</p></div><button type="button" className={s.petalSwitch} aria-label="Use my listening rhythm" aria-pressed={music.settings.timeAware !== false} onClick={() => void change({ timeAware: music.settings.timeAware === false })}><i/></button></div>
    <div className={s.feedToggle}><div><b>Learn from my listening</b><p>Use saved history to refine recommendations and record new listening. Turning this off keeps earlier history.</p></div><button type="button" className={s.petalSwitch} aria-label="Learn from my listening" aria-pressed={music.settings.learnFromListening !== false} onClick={() => void change({ learnFromListening: music.settings.learnFromListening === false })}><i/></button></div>
    <details className={s.chosenGenres}><summary><span>Genres I choose</span><small>{music.settings.seedGenres.length} selected</small><Icon name="chevron" size={15}/></summary>
      <p>Choose genres to guide your recommendations. These are your choices, separate from the genres in your listening history.</p>
      {music.settings.seedGenres.length > 0 && <ul>{music.settings.seedGenres.map(name => <li key={name}><span dir="auto">{name}</span><button type="button" disabled={saving} aria-label={`Remove ${name} from chosen genres`} onClick={() => void change({ seedGenres: music.settings.seedGenres.filter(value => value !== name) })}><Icon name="close" size={15}/></button></li>)}</ul>}
      <form onSubmit={event => { event.preventDefault(); addGenre(); }}><label>Add a genre<input value={genre} maxLength={80} placeholder="For example, Jazz" onChange={event => { setGenre(event.target.value); setGenreNotice(""); }}/></label><button className={s.addGenre} type="submit" disabled={saving || !genre.trim() || music.settings.seedGenres.length >= 12}><Icon name="plus" size={16}/>Add genre</button></form>
      <p className={s.smallNote} role="status">{genreNotice || "Use the genre names you see on songs. Choose up to 12."}</p>
    </details>
    {music.settings.privateSession && <p className={s.smallNote}>Private listening is on. New activity stays out of your listening history while it is enabled.</p>}
    <div className={s.settingsFoot}><Link href="/onboarding">Choose favorite artists <Icon name="arrow" size={15}/></Link><Button secondary icon="repeat" onClick={() => void change(BALANCED)} disabled={saving}>Restore feed defaults</Button></div>
    <p className={s.smallNote} role="status">{saving ? "Saving preferences…" : "These preferences follow your account. Individual songs can be excluded through their options."}</p>
  </section>;
}
