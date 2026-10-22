import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CAPACITOR_ANDROID_ORIGIN } from '../../supabase/functions/_shared/http';

describe('Android app origin', () => {
  it('is always added to ALLOWED_ORIGINS by the deploy workflow', () => {
    const workflow = readFileSync('.github/workflows/deploy-supabase.yml', 'utf8');
    const line = workflow.split('\n').find((l) => l.trim().startsWith('ALLOWED_ORIGINS:'));
    expect(line).toContain(CAPACITOR_ANDROID_ORIGIN);
  });

  it('matches the origin Capacitor serves the app from (no custom host, scheme or server)', () => {
    const config = readFileSync('capacitor.config.ts', 'utf8');
    expect(config).not.toMatch(/hostname\s*:/);
    expect(config).not.toMatch(/androidScheme\s*:/);
    expect(config).not.toMatch(/\burl\s*:/);
    expect(CAPACITOR_ANDROID_ORIGIN).toBe('https://localhost');
  });
});
