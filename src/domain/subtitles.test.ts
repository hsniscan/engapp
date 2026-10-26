import { describe, expect, it } from 'vitest';
import {
  cleanCueLine,
  detectSubtitleFormat,
  parseSubtitles,
  parseTimestamp,
  subtitleTitle,
} from './subtitles';

const FILES = import.meta.glob<string>('../../tests/fixtures/subtitles/*', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const file = (name: string) => FILES[`../../tests/fixtures/subtitles/${name}`]!;

describe('parseTimestamp', () => {
  it('reads SRT and VTT forms', () => {
    expect(parseTimestamp('00:00:01,000')).toBe(1000);
    expect(parseTimestamp('01:02:03.450')).toBe(3_723_450);
    expect(parseTimestamp('02:03.4')).toBe(123_400);
    expect(parseTimestamp('1:00:00')).toBe(3_600_000);
  });
});

describe('cleanCueLine', () => {
  it.each([
    ['<i>Hello there.</i>', 'Hello there.'],
    ['<font color="#fff">Hi</font>', 'Hi'],
    ['{\\an8}Top line', 'Top line'],
    ['- Where are you?', 'Where are you?'],
    ['JOHN: I am here.', 'I am here.'],
    ['DR. SMITH: Sit down.', 'Sit down.'],
    ['>> next speaker', 'next speaker'],
    ['[DOOR SLAMS]', ''],
    ['(LAUGHS)', ''],
    ['(laughs)', ''],
    ['♪ la la la ♪', 'la la la'],
    ['We met (in London) here.', 'We met (in London) here.'],
    ['Note: keep this.', 'Note: keep this.'],
    ['Tom &amp; Jerry &#39;s', "Tom & Jerry 's"],
    ['so<00:00:00.640><c> today</c>', 'so today'],
    ['<v Roger Bingham>We are here', 'We are here'],
    ['...', ''],
  ])('%s → %s', (input, want) => {
    expect(cleanCueLine(input)).toBe(want);
  });
});

describe('detectSubtitleFormat', () => {
  it('knows SRT and VTT by content or name', () => {
    expect(detectSubtitleFormat(file('basic.srt'))).toBe('srt');
    expect(detectSubtitleFormat(file('styled.vtt'))).toBe('vtt');
    expect(detectSubtitleFormat('\ufeffWEBVTT\n\n')).toBe('vtt');
    expect(detectSubtitleFormat('hello world', 'notes.txt')).toBeNull();
  });
});

describe('parseSubtitles fixtures', () => {
  it('SRT: no indices or timings, cues merged into sentences, paragraph at a pause', () => {
    const r = parseSubtitles(file('basic.srt'), 'Why.The.Sky.Is.Blue.2024.1080p.WEB.en.srt');
    expect(r.title).toBe('Why The Sky Is Blue 2024');
    expect(r.cues).toBe(7);
    expect(r.body).not.toMatch(/-->|^\d+$|<[a-z/]/m);
    expect(r.body.split('\n\n')).toEqual([
      'Have you ever wondered why the sky is blue? Most people never ask. Sunlight looks white, but it is a mix of colours. Blue light is scattered more than red light by the tiny molecules in the air.',
      'That is why, at sunset, the sky turns orange and red. The light travels through more air.',
    ]);
  });

  it('SDH: sound descriptions, speaker labels, lyrics marks and positioning go', () => {
    const r = parseSubtitles(file('sdh.srt'), 'sdh.srt');
    expect(r.body).not.toMatch(/MUSIC|SIGHS|laughs|SARAH|TOM:|♪|\{|font/);
    expect(r.body).toContain("Did you finish the report? Not yet. I'll do it after lunch.");
    expect(r.body).toContain('We met in 2019 (in London) at a conference.');
    expect(r.body).toContain('Note: the meeting starts at nine.');
    expect(r.body).toContain('Here comes the sun');
  });

  it('YouTube auto-captions: rolling repeats kept once, inline timestamps removed', () => {
    const r = parseSubtitles(file('youtube-auto.vtt'), 'talk.en.vtt');
    expect(r.body).toBe(
      "so today we're going to talk about how to learn words that actually stick.\n\nthe first trick is to read every day.",
    );
  });

  it('VTT: header, STYLE, NOTE and REGION blocks, cue ids, voices and settings go', () => {
    const r = parseSubtitles(file('styled.vtt'), 'interview.vtt');
    expect(r.body).toBe(
      "We are in New York City and we're actually at the Lucerne Hotel, just down the street. Tom & Jerry was filmed near here.",
    );
  });

  it('copes with a BOM and Windows line ends', () => {
    const crlf = '\ufeff' + file('basic.srt').replace(/\n/g, '\r\n');
    expect(parseSubtitles(crlf, 'a.srt').body).toBe(
      parseSubtitles(file('basic.srt'), 'a.srt').body,
    );
  });

  it('refuses a file without cue text', () => {
    expect(() => parseSubtitles('WEBVTT\n\nNOTE nothing here\n', 'x.vtt')).toThrow();
    expect(() => parseSubtitles('just some words', 'x.txt')).toThrow();
    expect(() => parseSubtitles('1\n00:00:01,000 --> 00:00:02,000\n[MUSIC]\n', 'x.srt')).toThrow();
  });
});

describe('subtitleTitle', () => {
  it('keeps the show and episode, drops release tags', () => {
    expect(subtitleTitle('The_Office.S02E01.720p.HDTV.x264.eng.srt')).toBe('The Office S02E01');
    expect(subtitleTitle('C:\\subs\\lecture-3.vtt')).toBe('lecture-3');
    expect(subtitleTitle('.srt')).toBe('');
  });
});
