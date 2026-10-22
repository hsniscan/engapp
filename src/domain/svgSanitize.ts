// The picture sanitizer for the client (defence in depth: a picture is sanitised again before it
// is shown, decision 0030). Same code as the server: supabase/functions/_shared/svg-sanitize.ts.
export { sanitizeSvg, svgColors } from '../../supabase/functions/_shared/svg-sanitize';
export type { SanitizeResult } from '../../supabase/functions/_shared/image-contract';
