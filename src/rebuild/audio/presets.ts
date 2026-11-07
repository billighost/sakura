/** Tasteful playback processing; these modes do not reconstruct lost recording data. */
export type AudioTechnology = "none" | "clarity" | "warmth" | "punch" | "night" | "headphones";

export interface AudioFilter {
  type: "lowshelf" | "highshelf" | "peaking";
  frequency: number;
  gain: number;
  q?: number;
}
export interface AudioPreset {
  id: AudioTechnology;
  name: string;
  description: string;
  detail: string;
  preampDb: number;
  filters: readonly AudioFilter[];
  dynamics?: { threshold: number; knee: number; ratio: number; attack: number; release: number; makeupDb: number };
  crossfeed?: { amount: number; frequency: number; delay: number };
}

export const AUDIO_TECHNOLOGIES: readonly AudioPreset[] = [
  { id: "none", name: "None", description: "The original recording, untouched.", detail: "Hear the song as it was delivered.", preampDb: 0, filters: [] },
  { id: "clarity", name: "Clarity", description: "Clearer voices. A little more air.", detail: "Gently opens the upper mids and softens low-mid muddiness. Try it with dense mixes or vocals.", preampDb: -4.8, filters: [
    { type: "lowshelf", frequency: 120, gain: -1 },
    { type: "peaking", frequency: 320, gain: -1.8, q: 0.7 },
    { type: "peaking", frequency: 2600, gain: 2.2, q: 0.6 },
    { type: "highshelf", frequency: 9000, gain: 1.2 },
  ] },
  { id: "warmth", name: "Warmth", description: "Fuller lows. Softer edges.", detail: "Adds a gentle low-end shelf and eases bright treble. Try it when a recording sounds thin or sharp.", preampDb: -4.5, filters: [
    { type: "lowshelf", frequency: 160, gain: 2.5 },
    { type: "peaking", frequency: 400, gain: -0.7, q: 0.65 },
    { type: "highshelf", frequency: 6500, gain: -2 },
  ] },
  { id: "punch", name: "Punch", description: "More body in the beat.", detail: "Shapes the bass and gently compresses sustained peaks with a slower attack, keeping the front of the beat alive.", preampDb: -5.5, filters: [
    { type: "lowshelf", frequency: 100, gain: 3.3 },
    { type: "peaking", frequency: 300, gain: -1.6, q: 0.8 },
    { type: "highshelf", frequency: 6500, gain: 0.7 },
  ], dynamics: { threshold: -14, knee: 6, ratio: 2, attack: 0.025, release: 0.16, makeupDb: 0.8 } },
  { id: "night", name: "Night", description: "Quiet details, fewer sudden peaks.", detail: "Narrows the gap between quiet passages and loud moments. Useful at a low listening volume; the song loses some of its original dynamics.", preampDb: -3.5, filters: [
    { type: "lowshelf", frequency: 90, gain: -1 },
    { type: "peaking", frequency: 1600, gain: 1, q: 0.7 },
    { type: "highshelf", frequency: 8000, gain: -0.7 },
  ], dynamics: { threshold: -27, knee: 12, ratio: 3.5, attack: 0.004, release: 0.22, makeupDb: 3 } },
  { id: "headphones", name: "Headphones", description: "A gentler stereo image.", detail: "Blends a little low-frequency sound between ears to soften hard-panned stereo. Best with headphones; centered sounds stay centered.", preampDb: -2, filters: [], crossfeed: { amount: 0.18, frequency: 700, delay: 0.00028 } },
];

export function audioTechnology(value: unknown): AudioTechnology {
  return AUDIO_TECHNOLOGIES.some(preset => preset.id === value) ? value as AudioTechnology : "none";
}
export function audioPreset(mode: AudioTechnology): AudioPreset {
  return AUDIO_TECHNOLOGIES.find(preset => preset.id === mode) || AUDIO_TECHNOLOGIES[0];
}
export function dbToGain(db: number): number { return 10 ** (db / 20); }
