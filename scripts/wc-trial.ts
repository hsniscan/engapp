// Temporary (never merged): draws a few words with the image-v2 prompt and prints each answer as
// gzip+base64 notice annotations, so the drawings can be reviewed before the bulk run.
import Anthropic from '@anthropic-ai/sdk';
import { gzipSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import { buildImageRequest } from '../supabase/functions/_shared/image-prompt.ts';

const WORDS: [string, string, string, string | null][] = [
  ['apple', 'noun', 'elma', null],
  ['bridge', 'noun', 'köprü', 'a bridge over a river'],
  ['climb', 'verb', 'tırmanmak', 'a person climbing a steep mountain'],
  ['angry', 'adjective', 'kızgın', 'an angry face'],
  ['between', 'preposition', 'arasında', 'a ball between two boxes'],
  ['umbrella', 'noun', 'şemsiye', 'an open umbrella in the rain'],
  ['kitchen', 'noun', 'mutfak', 'a small kitchen with a stove and a pot'],
  ['teacher', 'noun', 'öğretmen', 'a teacher pointing at a board in front of students'],
  ['heavy', 'adjective', 'ağır', 'a person struggling to lift a heavy box'],
  ['rain', 'noun', 'yağmur', 'rain falling from a cloud'],
];
const only = process.env.ONLY || '';
const client = new Anthropic();
const model = process.env.CLAUDE_IMAGE_MODEL || 'claude-sonnet-5-5';
let cost = 0;
const out: Record<string, unknown> = {};
const todo = WORDS.filter((w) => !only || only.split(',').includes(w[0]));
const run = async ([lemma, pos, gloss_tr, visual_hint]: (typeof WORDS)[number]) => {
  const p = buildImageRequest({ sense_id: randomUUID(), lemma, pos, gloss_tr, visual_hint }, { model });
  const m = await client.messages.create(p);
  const u = m.usage;
  cost += ((u.input_tokens + (u.cache_creation_input_tokens ?? 0) * 2) * 2 + (u.cache_read_input_tokens ?? 0) * 0.2 + u.output_tokens * 10) / 1e6;
  const text = m.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('');
  out[lemma] = { text, usage: u };
};
for (let i = 0; i < todo.length; i += 3) await Promise.all(todo.slice(i, i + 3).map(run));
const z = gzipSync(JSON.stringify(out)).toString('base64');
const parts = z.match(/.{1,3900}/g) ?? [];
parts.forEach((part, i) => console.log(`::notice title=wc-${i + 1}of${parts.length}::${part}`));
console.log(`::notice title=cost::${cost.toFixed(4)}`);
