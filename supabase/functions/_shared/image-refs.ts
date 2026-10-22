// The six approved style-B samples (decision 0029, docs/image-style.md) in stored format: light
// palette hex values only, viewBox 0 0 256 256, already normalised by sanitizeSvg (a test checks
// it). Few-shot examples of the image-v1 system prompt and sanitizer fixtures. Viewable copies:
// docs/image-style/refs/*.svg (a test keeps them identical). Source: the owner's style pick
// (gorseller/draw.mjs, style B). "climb" clipped its mountain to the backdrop with <clipPath>,
// which is not allowed, so the clipped outline is drawn as one path.

export interface ImageRef {
  slug: string;
  lemma: string;
  /** Lexicon part of speech. */
  pos: string;
  gloss_tr: string;
  visual_hint: string | null;
  /** One line on the composition, for the prompt. */
  idea: string;
  alt_tr: string;
  svg: string;
}

// prettier-ignore
export const IMAGE_REFS: readonly ImageRef[] = [
  {
    slug: 'apple',
    lemma: 'apple',
    pos: 'noun',
    gloss_tr: 'elma',
    visual_hint: null,
    idea: 'One whole object, centred and large: red body, green leaf, brown stem, a translucent white highlight.',
    alt_tr: 'Yeşil yapraklı kırmızı bir elma',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="#2b2824"><circle cx="128" cy="128" r="114" fill="#e6edf5"/><path d="M128 86 C 108 70, 62 72, 58 122 C 54 170, 92 214, 116 207 C 123 205, 133 205, 140 207 C 164 214, 202 170, 198 122 C 194 72, 148 70, 128 86 Z" fill="#d55e00"/><path d="M84 112 C 86 98, 96 90, 106 88" fill="none" stroke="#ffffff" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" opacity="0.55"/><path d="M128 88 C 128 72, 131 60, 138 48" fill="none" stroke="#6b4a2b" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/><path d="M136 66 C 146 46, 172 42, 184 50 C 174 68, 152 76, 136 66 Z" fill="#009e73"/></svg>',
  },
  {
    slug: 'bridge',
    lemma: 'bridge',
    pos: 'noun',
    gloss_tr: 'köprü',
    visual_hint: null,
    idea: 'The object in its minimal setting: a stone arch with a railing over two blue water lines.',
    alt_tr: 'Suyun üzerinde taş kemerli bir köprü',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="#2b2824"><circle cx="128" cy="128" r="114" fill="#e6edf5"/><path d="M30 110 H226 V180 H202 C 202 146, 170 124, 128 124 C 86 124, 54 146, 54 180 H30 Z" fill="#cdbfa8"/><path d="M30 110 H226 V122 H30 Z" fill="#a8977c"/><path d="M34 84 H222 M40 84 V110 M72 84 V110 M104 84 V110 M152 84 V110 M184 84 V110 M216 84 V110" fill="none" stroke="#a8977c" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/><path d="M70 202 q 14 -9 28 0 t 28 0 t 28 0 t 28 0" fill="none" stroke="#2a6fb0" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/><path d="M96 224 q 14 -9 28 0 t 28 0" fill="none" stroke="#2a6fb0" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  },
  {
    slug: 'climb',
    lemma: 'climb',
    pos: 'verb',
    gloss_tr: 'tırmanmak',
    visual_hint: 'a person going up a steep mountain',
    idea: 'An action: a small figure (skin head, blue limbs, darker far-side limbs, orange backpack) mid-step on a slope that ends at a flag on the summit; the slope is cut to the backdrop circle.',
    alt_tr: 'Sırt çantalı biri dik bir dağa tırmanıyor',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="#2b2824"><circle cx="128" cy="128" r="114" fill="#e6edf5"/><path d="M43.7 204.7 L200 64 L241.9 122.3 A114 114 0 0 1 43.7 204.7 Z" fill="#cdbfa8"/><path d="M200 64 L186 79 L194 77 L199 85 L206 76 L214 80 Z" fill="#ffffff"/><path d="M200 66 V30" fill="none" stroke="#5a5249" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><path d="M200 31 L226 38 L200 45 Z" fill="#d55e00"/><path d="M118 90 L134 127" fill="none" stroke="#6b4a2b" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><rect x="77" y="92" width="18" height="28" rx="5" transform="rotate(22 86 106)" fill="#e69f00"/><path d="M92 126 L 86 150 L 79 172" fill="none" stroke="#1d5490" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/><path d="M102 100 L 92 114" fill="none" stroke="#1d5490" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/><path d="M92 126 L 112 125 L 113 145" fill="none" stroke="#2a6fb0" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/><path d="M92 126 L 104 95" fill="none" stroke="#2a6fb0" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/><path d="M104 96 L 116 108 L 123 106" fill="none" stroke="#2a6fb0" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/><circle cx="111" cy="78" r="13" fill="#e9b98c"/></svg>',
  },
  {
    slug: 'angry',
    lemma: 'angry',
    pos: 'adjective',
    gloss_tr: 'kızgın',
    visual_hint: null,
    idea: 'A feeling as a face: a red round face with dark slanted brows and a downturned mouth, a red anger mark and two steam curls.',
    alt_tr: 'Kaşları çatık, kızgın kırmızı bir yüz',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="#2b2824"><circle cx="128" cy="128" r="114" fill="#e6edf5"/><circle cx="128" cy="134" r="80" fill="#d55e00"/><path d="M86 104 L 114 118 M170 104 L 142 118" fill="none" stroke="#3a1a08" stroke-width="9" stroke-linecap="round"/><circle cx="104" cy="136" r="7.5" fill="#3a1a08"/><circle cx="152" cy="136" r="7.5" fill="#3a1a08"/><path d="M100 184 C 112 168, 144 168, 156 184" fill="none" stroke="#3a1a08" stroke-width="9" stroke-linecap="round"/><g fill="none" stroke="#d55e00" stroke-width="6" stroke-linecap="round"><path d="M186 40 C 188 50, 192 54, 202 56"/><path d="M218 40 C 216 50, 212 54, 202 56"/><path d="M186 72 C 188 62, 192 58, 202 56"/><path d="M218 72 C 216 62, 212 58, 202 56"/></g><path d="M46 70 c -8 -10 6 -18 0 -28 M62 58 c -8 -10 6 -18 0 -28" fill="none" stroke="#b8ae9f" stroke-width="5" stroke-linecap="round"/></svg>',
  },
  {
    slug: 'between',
    lemma: 'between',
    pos: 'preposition',
    gloss_tr: 'arasında',
    visual_hint: 'an object in the middle of two others',
    idea: 'A relation: two identical blue blocks with an orange ball in the gap, a faint arrow pointing into the gap, a faint ground line.',
    alt_tr: 'İki mavi blok arasında turuncu bir top',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="#2b2824"><circle cx="128" cy="128" r="114" fill="#e6edf5"/><rect x="34" y="202" width="188" height="8" rx="4" fill="#b8ae9f"/><rect x="30" y="86" width="52" height="116" rx="8" fill="#2a6fb0"/><rect x="174" y="86" width="52" height="116" rx="8" fill="#2a6fb0"/><circle cx="128" cy="178" r="22" fill="#e69f00"/><path d="M116 170 a 14 14 0 0 1 10 -8" fill="none" stroke="#ffffff" opacity="0.55" stroke-width="5" stroke-linecap="round"/><g fill="none" stroke="#b8ae9f" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><path d="M128 108 V 142 M116 131 L128 143 L140 131"/></g></svg>',
  },
  {
    slug: 'umbrella',
    lemma: 'umbrella',
    pos: 'noun',
    gloss_tr: 'şemsiye',
    visual_hint: null,
    idea: 'The object with one cue of its use: an open blue umbrella with darker panels, a dark handle and a few sky-blue raindrops.',
    alt_tr: 'Yağmurda açık mavi bir şemsiye',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="#2b2824"><circle cx="128" cy="128" r="114" fill="#e6edf5"/><path d="M64 27 C 67 34, 71 38, 71 43 A 7 7 0 0 1 57 43 C 57 38, 61 34, 64 27 Z" fill="#56b4e9"/><path d="M200 17 C 203 24, 207 28, 207 33 A 7 7 0 0 1 193 33 C 193 28, 197 24, 200 17 Z" fill="#56b4e9"/><path d="M36 81.6 C 38.4 87.2, 41.6 90.4, 41.6 94.4 A 5.6000000000000005 5.6000000000000005 0 0 1 30.4 94.4 C 30.4 90.4, 33.6 87.2, 36 81.6 Z" fill="#56b4e9"/><path d="M222 75.6 C 224.4 81.2, 227.6 84.4, 227.6 88.4 A 5.6000000000000005 5.6000000000000005 0 0 1 216.4 88.4 C 216.4 84.4, 219.6 81.2, 222 75.6 Z" fill="#56b4e9"/><path d="M128 52 V 194 C 128 214, 102 214, 102 196" fill="none" stroke="#5a5249" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/><path d="M36 134 C 36 82, 80 52, 128 52 C 176 52, 220 82, 220 134 Q 197 116 174 134 Q 151 116 128 134 Q 105 116 82 134 Q 59 116 36 134 Z" fill="#2a6fb0"/><path d="M82 132 C 84 92, 104 62, 128 54 C 104 70, 92 100, 92 126 Z" fill="#1d5490"/><path d="M174 132 C 172 92, 152 62, 128 54 C 152 70, 164 100, 164 126 Z" fill="#1d5490"/><path d="M128 52 V 38" fill="none" stroke="#5a5249" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  },
];
