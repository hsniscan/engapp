import { describe, expect, it } from 'vitest';
import { ErrorCode } from '@capawesome/capacitor-google-sign-in';
import { classifySignInError, googleWebClientId } from './auth';

describe('native sign-in setup', () => {
  it('reads the web client id from the build environment only', () => {
    expect(googleWebClientId({})).toBeNull();
    expect(googleWebClientId({ VITE_GOOGLE_WEB_CLIENT_ID: '  ' })).toBeNull();
    expect(
      googleWebClientId({ VITE_GOOGLE_WEB_CLIENT_ID: ' 123-abc.apps.googleusercontent.com ' }),
    ).toBe('123-abc.apps.googleusercontent.com');
  });

  it('treats a closed sheet as no error and names the setup problems', () => {
    expect(classifySignInError({ code: ErrorCode.SignInCanceled })).toBe('canceled');
    expect(classifySignInError({ code: ErrorCode.NoCredentialAvailable })).toBe('no_account');
    expect(classifySignInError({ code: ErrorCode.ProviderConfigurationError })).toBe(
      'play_services',
    );
    expect(classifySignInError(new Error('boom'))).toBe('failed');
    expect(classifySignInError(null)).toBe('failed');
  });
});
