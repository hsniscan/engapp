// Shared parts library of style B (decision 0029, docs/image-style.md): small, reusable pieces in
// stored format (light palette hex only). The image-v1 system prompt lists them; a test checks
// that each one passes the sanitizer inside a picture and that docs/image-style.md shows it.

export interface ImagePart {
  name: string;
  use: string;
  svg: string;
}

export const IMAGE_PARTS: readonly ImagePart[] = [
  {
    name: 'backdrop',
    use: 'Always the first element: the soft circle every picture sits on.',
    svg: '<circle cx="128" cy="128" r="114" fill="#e6edf5"/>',
  },
  {
    name: 'ground',
    use: 'A faint floor line under standing things.',
    svg: '<rect x="34" y="202" width="188" height="8" rx="4" fill="#b8ae9f"/>',
  },
  {
    name: 'person',
    use: 'A standing figure, front view: skin head, blue body and near limbs, dark-blue far limbs. Move the limb paths for actions.',
    svg: '<circle cx="128" cy="62" r="15" fill="#e9b98c"/><path d="M128 140 L116 186 M128 140 L140 186" fill="none" stroke="#1d5490" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/><path d="M128 86 V140" fill="none" stroke="#2a6fb0" stroke-width="18" stroke-linecap="round"/><path d="M128 94 L104 124 M128 94 L152 124" fill="none" stroke="#2a6fb0" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>',
  },
  {
    name: 'face',
    use: "Feelings and states: a big round face in the feeling's colour; features in ink-on-red on red, ink on other colours.",
    svg: '<circle cx="128" cy="134" r="80" fill="#e69f00"/><circle cx="104" cy="126" r="7.5" fill="#2b2824"/><circle cx="152" cy="126" r="7.5" fill="#2b2824"/><path d="M100 160 C 112 176, 144 176, 156 160" fill="none" stroke="#2b2824" stroke-width="9" stroke-linecap="round"/>',
  },
  {
    name: 'arrow',
    use: 'Direction, movement into or out of something, cause → effect. Faint, never the main shape.',
    svg: '<path d="M128 108 V 142 M116 131 L128 143 L140 131" fill="none" stroke="#b8ae9f" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>',
  },
  {
    name: 'motion',
    use: 'Speed or a quick movement: three short faint strokes behind the moving thing.',
    svg: '<path d="M52 110 H84 M44 128 H80 M52 146 H84" fill="none" stroke="#b8ae9f" stroke-width="6" stroke-linecap="round"/>',
  },
  {
    name: 'water',
    use: 'Water, rivers, the sea: blue wave lines.',
    svg: '<path d="M70 202 q 14 -9 28 0 t 28 0 t 28 0 t 28 0" fill="none" stroke="#2a6fb0" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>',
  },
  {
    name: 'raindrop',
    use: 'Rain, wetness, liquid.',
    svg: '<path d="M64 27 C 67 34, 71 38, 71 43 A 7 7 0 0 1 57 43 C 57 38, 61 34, 64 27 Z" fill="#56b4e9"/>',
  },
  {
    name: 'sun',
    use: 'Sun, heat, daytime, summer.',
    svg: '<circle cx="128" cy="128" r="40" fill="#e69f00"/><path d="M128 64 V76 M128 180 V192 M64 128 H76 M180 128 H192 M83 83 L91 91 M165 165 L173 173 M83 173 L91 165 M165 91 L173 83" fill="none" stroke="#e69f00" stroke-width="8" stroke-linecap="round"/>',
  },
  {
    name: 'tree',
    use: 'Trees, forests, nature, plants.',
    svg: '<rect x="120" y="138" width="16" height="64" rx="4" fill="#6b4a2b"/><circle cx="128" cy="104" r="44" fill="#009e73"/><circle cx="98" cy="128" r="26" fill="#009e73"/><circle cx="158" cy="128" r="26" fill="#009e73"/>',
  },
  {
    name: 'house',
    use: 'Home, building, living somewhere.',
    svg: '<path d="M72 120 L128 74 L184 120 Z" fill="#d55e00"/><rect x="84" y="118" width="88" height="80" fill="#cdbfa8"/><rect x="116" y="150" width="24" height="48" rx="3" fill="#6b4a2b"/>',
  },
  {
    name: 'highlight',
    use: 'A shine on round or glossy things. White with opacity, only on top of another shape.',
    svg: '<path d="M84 112 C 86 98, 96 90, 106 88" fill="none" stroke="#ffffff" stroke-width="8" stroke-linecap="round" opacity="0.55"/>',
  },
  {
    name: 'emphasis',
    use: 'Anger, shock, pain, a loud moment: a small red burst mark beside the subject.',
    svg: '<g fill="none" stroke="#d55e00" stroke-width="6" stroke-linecap="round"><path d="M186 40 C 188 50, 192 54, 202 56"/><path d="M218 40 C 216 50, 212 54, 202 56"/><path d="M186 72 C 188 62, 192 58, 202 56"/><path d="M218 72 C 216 62, 212 58, 202 56"/></g>',
  },
  {
    name: 'no',
    use: 'Forbidden, not allowed, without: a red ring with a bar, drawn over the thing.',
    svg: '<circle cx="128" cy="128" r="72" fill="none" stroke="#d55e00" stroke-width="14"/><path d="M77 77 L179 179" fill="none" stroke="#d55e00" stroke-width="14" stroke-linecap="round"/>',
  },
];
