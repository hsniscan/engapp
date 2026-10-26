// One JSON line per log entry, tagged with the function name. Kept apart from setup.ts so a
// function that is not an AI task does not pull the AI providers (and their SDK) in.

export function log(fn: string) {
  return (msg: string, data?: Record<string, unknown>) =>
    console.log(JSON.stringify({ fn, msg, ...(data ?? {}) }));
}
