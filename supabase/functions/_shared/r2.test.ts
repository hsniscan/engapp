// Signing and the R2 client (decision 0053), against AWS's published SigV4 examples and a
// mocked fetch. No network.
import { describe, expect, it } from 'vitest';
import {
  amzDate,
  EMPTY_SHA256,
  parseListObjectsV2,
  R2Client,
  r2ConfigFromEnv,
  sha256Hex,
  signV4,
  uriEncode,
} from './r2.ts';
import { audioObjectUrl, parseAudioBaseUrl, ttsAudioUrls } from './tts-contract.ts';

// The example credentials of the AWS S3 SigV4 documentation ("Examples of signature
// calculations", header-based authentication).
const AWS = {
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  region: 'us-east-1',
  service: 's3',
  now: new Date('2013-05-24T00:00:00Z'),
};

function sigOf(h: Record<string, string>): string {
  return /Signature=([0-9a-f]{64})$/.exec(h.authorization!)![1]!;
}

describe('signV4 (AWS documentation examples)', () => {
  it('GET object with a Range header', async () => {
    const h = await signV4({
      ...AWS,
      method: 'GET',
      url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'),
      headers: { Range: 'bytes=0-9' },
      payloadHash: EMPTY_SHA256,
    });
    expect(h.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, ' +
        'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, ' +
        'Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    );
    expect(h['x-amz-date']).toBe('20130524T000000Z');
  });

  it('GET bucket (list objects) with a query string, sorted', async () => {
    const h = await signV4({
      ...AWS,
      method: 'GET',
      url: new URL('https://examplebucket.s3.amazonaws.com/?prefix=J&max-keys=2'),
      payloadHash: EMPTY_SHA256,
    });
    expect(sigOf(h)).toBe('34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7');
  });

  it('PUT object with a body hash and extra headers', async () => {
    const body = 'Welcome to Amazon S3.';
    const h = await signV4({
      ...AWS,
      method: 'PUT',
      url: new URL('https://examplebucket.s3.amazonaws.com/test%24file.text'),
      headers: {
        Date: 'Fri, 24 May 2013 00:00:00 GMT',
        'x-amz-storage-class': 'REDUCED_REDUNDANCY',
      },
      payloadHash: await sha256Hex(body),
    });
    expect(h['x-amz-content-sha256']).toBe(
      '44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072',
    );
    expect(sigOf(h)).toBe('98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd');
  });
});

describe('helpers', () => {
  it('encodes like RFC 3986 and keeps slashes only in paths', () => {
    expect(uriEncode('en-US/ab_c.~x.mp3', true)).toBe('en-US/ab_c.~x.mp3');
    expect(uriEncode('a b/ç+$')).toBe('a%20b%2F%C3%A7%2B%24');
  });

  it('formats the request date', () => {
    expect(amzDate(new Date('2026-11-01T09:08:07.654Z'))).toBe('20261101T090807Z');
  });

  it('reads the config only when all four values are set', () => {
    const all: Record<string, string> = {
      R2_ACCOUNT_ID: 'acc',
      R2_ACCESS_KEY_ID: 'id',
      R2_SECRET_ACCESS_KEY: 'secret',
      R2_BUCKET: 'engapp-audio',
    };
    expect(r2ConfigFromEnv((k) => all[k])).toEqual({
      accountId: 'acc',
      accessKeyId: 'id',
      secretAccessKey: 'secret',
      bucket: 'engapp-audio',
    });
    for (const k of Object.keys(all)) {
      expect(r2ConfigFromEnv((x) => (x === k ? '' : all[x]))).toBeNull();
    }
  });

  it('accepts only an https base URL', () => {
    expect(parseAudioBaseUrl('https://pub-abc.r2.dev/')).toBe('https://pub-abc.r2.dev');
    expect(parseAudioBaseUrl(' https://audio.example.com/tts ')).toBe(
      'https://audio.example.com/tts',
    );
    expect(parseAudioBaseUrl('http://pub-abc.r2.dev')).toBeNull();
    expect(parseAudioBaseUrl('https://x.dev/?a=1')).toBeNull();
    expect(parseAudioBaseUrl('not a url')).toBeNull();
    expect(parseAudioBaseUrl(undefined)).toBeNull();
    expect(parseAudioBaseUrl('')).toBeNull();
    expect(audioObjectUrl('https://pub-abc.r2.dev/', 'en-US/ab.mp3')).toBe(
      'https://pub-abc.r2.dev/en-US/ab.mp3',
    );
  });

  it('lists R2 before Supabase Storage, and only what is configured', () => {
    const path = 'en-US/ab.mp3';
    const supa = 'https://p.supabase.co/storage/v1/object/public/tts/en-US/ab.mp3';
    expect(
      ttsAudioUrls(path, {
        audioBaseUrl: 'https://pub-abc.r2.dev',
        supabaseUrl: 'https://p.supabase.co',
      }),
    ).toEqual(['https://pub-abc.r2.dev/en-US/ab.mp3', supa]);
    expect(
      ttsAudioUrls(path, { audioBaseUrl: null, supabaseUrl: 'https://p.supabase.co/' }),
    ).toEqual([supa]);
    expect(ttsAudioUrls(path, { audioBaseUrl: null, supabaseUrl: null })).toEqual([]);
  });

  it('parses a ListObjectsV2 page', () => {
    const p = parseListObjectsV2(
      `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><IsTruncated>true</IsTruncated>
       <Contents><Key>en-US/a.mp3</Key><Size>7001</Size></Contents>
       <Contents><Key>en-GB/b&amp;c.wav</Key><LastModified>x</LastModified><Size>12</Size></Contents>
       <NextContinuationToken>tok+/=&amp;</NextContinuationToken></ListBucketResult>`,
    );
    expect(p).toEqual({
      objects: [
        { key: 'en-US/a.mp3', size: 7001 },
        { key: 'en-GB/b&c.wav', size: 12 },
      ],
      truncated: true,
      next: 'tok+/=&',
    });
  });
});

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Uint8Array | null;
}

function mockFetch(answer: (c: Call) => Response) {
  const calls: Call[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const c: Call = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers: { ...(init?.headers as Record<string, string>) },
      body: init?.body ? new Uint8Array(init.body as ArrayBuffer | Uint8Array) : null,
    };
    calls.push(c);
    return answer(c);
  }) as typeof fetch;
  return { f, calls };
}

const CFG = {
  accountId: 'acc123',
  accessKeyId: 'AKID',
  secretAccessKey: 'SECRET',
  bucket: 'engapp-audio',
};
const NOW = () => new Date('2026-11-01T00:00:00Z');

describe('R2Client', () => {
  it('PUTs a signed object with its type, cache header and body hash', async () => {
    const { f, calls } = mockFetch(() => new Response(null, { status: 200 }));
    const c = new R2Client(CFG, { fetch: f, now: NOW });
    const mp3 = new Uint8Array([1, 2, 3]);
    await c.put('en-US/ab.mp3', mp3, {
      contentType: 'audio/mpeg',
      cacheControl: 'public, max-age=31536000, immutable',
    });
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.method).toBe('PUT');
    expect(call.url).toBe('https://acc123.r2.cloudflarestorage.com/engapp-audio/en-US/ab.mp3');
    expect(call.headers['content-type']).toBe('audio/mpeg');
    expect(call.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(call.headers['x-amz-content-sha256']).toBe(await sha256Hex(mp3));
    expect(call.headers['x-amz-date']).toBe('20261101T000000Z');
    expect(call.headers.host).toBeUndefined();
    expect(call.headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKID\/20261101\/auto\/s3\/aws4_request, SignedHeaders=cache-control;content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
    );
    expect([...call.body!]).toEqual([1, 2, 3]);
    // Deterministic: the same request signs the same way.
    const again = mockFetch(() => new Response(null, { status: 200 }));
    await new R2Client(CFG, { fetch: again.f, now: NOW }).put('en-US/ab.mp3', mp3, {
      contentType: 'audio/mpeg',
      cacheControl: 'public, max-age=31536000, immutable',
    });
    expect(again.calls[0]!.headers.authorization).toBe(call.headers.authorization);
  });

  it('throws on a failed PUT with the S3 error code', async () => {
    const { f } = mockFetch(
      () => new Response('<Error><Code>AccessDenied</Code></Error>', { status: 403 }),
    );
    await expect(
      new R2Client(CFG, { fetch: f, now: NOW }).put('en-US/a.mp3', new Uint8Array([1]), {
        contentType: 'audio/mpeg',
      }),
    ).rejects.toThrow('PUT en-US/a.mp3: HTTP 403 AccessDenied');
  });

  it('HEAD: size, null on 404, error otherwise', async () => {
    let status = 200;
    const { f, calls } = mockFetch(
      () => new Response(null, { status, headers: { 'content-length': '7001' } }),
    );
    const c = new R2Client(CFG, { fetch: f, now: NOW });
    expect(await c.head('en-GB/x.mp3')).toEqual({ size: 7001 });
    expect(calls[0]!.method).toBe('HEAD');
    status = 404;
    expect(await c.head('en-GB/x.mp3')).toBeNull();
    status = 500;
    await expect(c.head('en-GB/x.mp3')).rejects.toThrow('HTTP 500');
  });

  it('DELETE ignores a missing object', async () => {
    let status = 204;
    const { f, calls } = mockFetch(() => new Response(null, { status }));
    const c = new R2Client(CFG, { fetch: f, now: NOW });
    await c.delete('en-US/a.wav');
    status = 404;
    await c.delete('en-US/a.wav');
    expect(calls.map((x) => x.method)).toEqual(['DELETE', 'DELETE']);
    status = 403;
    await expect(c.delete('en-US/a.wav')).rejects.toThrow('HTTP 403');
  });

  it('lists every page with the continuation token', async () => {
    const { f, calls } = mockFetch((c) => {
      const u = new URL(c.url);
      const tok = u.searchParams.get('continuation-token');
      return new Response(
        tok
          ? '<ListBucketResult><IsTruncated>false</IsTruncated><Contents><Key>en-US/b.mp3</Key><Size>2</Size></Contents></ListBucketResult>'
          : '<ListBucketResult><IsTruncated>true</IsTruncated><Contents><Key>en-US/a.mp3</Key><Size>1</Size></Contents><NextContinuationToken>t+1/=</NextContinuationToken></ListBucketResult>',
        { status: 200 },
      );
    });
    const objs = await new R2Client(CFG, { fetch: f, now: NOW }).list('en-US/');
    expect(objs).toEqual([
      { key: 'en-US/a.mp3', size: 1 },
      { key: 'en-US/b.mp3', size: 2 },
    ]);
    expect(calls).toHaveLength(2);
    const second = new URL(calls[1]!.url);
    expect(second.pathname).toBe('/engapp-audio');
    expect(second.searchParams.get('list-type')).toBe('2');
    expect(second.searchParams.get('prefix')).toBe('en-US/');
    expect(second.searchParams.get('continuation-token')).toBe('t+1/=');
    expect(calls[1]!.url).toContain('continuation-token=t%2B1%2F%3D');
  });

  it('throws when listing fails', async () => {
    const { f } = mockFetch(() => new Response('<Error/>', { status: 403 }));
    await expect(new R2Client(CFG, { fetch: f, now: NOW }).list('en-US/')).rejects.toThrow(
      'LIST en-US/: HTTP 403',
    );
  });
});
