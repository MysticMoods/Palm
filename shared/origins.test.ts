import { describe, expect, it } from 'vitest';
import {
  appIdFromHost,
  appOriginFor,
  baseHostFrom,
  isValidAppId,
  splitHost,
  supportsAppOrigins,
} from './origins.mjs';

describe('splitHost', () => {
  it('splits a plain host and port', () => {
    expect(splitHost('palm.example:4173')).toEqual({ hostname: 'palm.example', port: '4173' });
    expect(splitHost('palm.example')).toEqual({ hostname: 'palm.example', port: '' });
  });

  it('lowercases, because Host headers are not case-normalised by clients', () => {
    expect(splitHost('Palm.Example:80')).toEqual({ hostname: 'palm.example', port: '80' });
  });

  it('keeps a bracketed IPv6 literal intact', () => {
    expect(splitHost('[::1]:4173')).toEqual({ hostname: '[::1]', port: '4173' });
    expect(splitHost('[::1]')).toEqual({ hostname: '[::1]', port: '' });
  });

  it('rejects an unbracketed IPv6 literal rather than mangling it', () => {
    // Splitting this on the first colon would yield hostname "" and route the
    // request as if it were the OS origin.
    expect(splitHost('::1')).toBeNull();
  });

  it('rejects empty input', () => {
    expect(splitHost('')).toBeNull();
    expect(splitHost(undefined)).toBeNull();
  });
});

describe('isValidAppId', () => {
  it('accepts the generated shape', () => {
    expect(isValidAppId('app-7f31c2a4')).toBe(true);
    expect(isValidAppId('app-7f31c2a49b02de11')).toBe(true);
  });

  it('rejects anything that is not a bare lowercase-hex label', () => {
    expect(isValidAppId('app-7F31C2A4')).toBe(false); // uppercase
    expect(isValidAppId('app-7f31')).toBe(false); // too short
    expect(isValidAppId('app-7f31c2a4.evil')).toBe(false); // extra label
    expect(isValidAppId('app-7f31c2a4/../..')).toBe(false); // traversal
    expect(isValidAppId('site-7f31c2a4')).toBe(false); // wrong prefix
    expect(isValidAppId('app-zzzzzzzz')).toBe(false); // not hex
    expect(isValidAppId(null)).toBe(false);
  });
});

describe('appIdFromHost', () => {
  it('finds the id in an application host', () => {
    expect(appIdFromHost('app-7f31c2a4.palm.example')).toBe('app-7f31c2a4');
    expect(appIdFromHost('app-7f31c2a4.localhost:4173')).toBe('app-7f31c2a4');
  });

  it('returns null for the OS host', () => {
    expect(appIdFromHost('palm.example')).toBeNull();
    expect(appIdFromHost('os.palm.example')).toBeNull();
    expect(appIdFromHost('localhost:4173')).toBeNull();
  });

  it('does not treat a lookalike label as an application host', () => {
    // An attacker-controlled name must not be routed as an installed app.
    expect(appIdFromHost('app-7f31c2a4x.palm.example')).toBeNull();
    expect(appIdFromHost('notapp-7f31c2a4.palm.example')).toBeNull();
    expect(appIdFromHost('app-.palm.example')).toBeNull();
  });
});

describe('baseHostFrom', () => {
  it('strips the application label', () => {
    expect(baseHostFrom('app-7f31c2a4.palm.example')).toBe('palm.example');
    expect(baseHostFrom('app-7f31c2a4.localhost:4173')).toBe('localhost:4173');
  });

  it('is idempotent on an OS host', () => {
    expect(baseHostFrom('palm.example')).toBe('palm.example');
    expect(baseHostFrom('localhost:4173')).toBe('localhost:4173');
  });
});

describe('supportsAppOrigins', () => {
  it('accepts names that can carry a subdomain', () => {
    expect(supportsAppOrigins('palm.example')).toBe(true);
    expect(supportsAppOrigins('localhost')).toBe(true);
  });

  it('refuses IP literals, which cannot have subdomains', () => {
    // Reached by IP there is no way to isolate applications, and Palm OS has
    // to disable installation rather than share its own origin.
    expect(supportsAppOrigins('127.0.0.1')).toBe(false);
    expect(supportsAppOrigins('192.168.1.10')).toBe(false);
    expect(supportsAppOrigins('[::1]')).toBe(false);
    expect(supportsAppOrigins('')).toBe(false);
  });
});

describe('appOriginFor', () => {
  it('builds an origin beside the OS origin', () => {
    expect(appOriginFor('app-7f31c2a4', { protocol: 'https:', host: 'palm.example' })).toBe(
      'https://app-7f31c2a4.palm.example',
    );
    expect(appOriginFor('app-7f31c2a4', { protocol: 'http:', host: 'localhost:4173' })).toBe(
      'http://app-7f31c2a4.localhost:4173',
    );
  });

  it('derives the same origin whether called from the OS or from an app', () => {
    const fromOs = appOriginFor('app-9b02de11', { protocol: 'https:', host: 'palm.example' });
    const fromApp = appOriginFor('app-9b02de11', {
      protocol: 'https:',
      host: 'app-7f31c2a4.palm.example',
    });
    expect(fromApp).toBe(fromOs);
  });

  it('returns null when isolation is impossible or the id is malformed', () => {
    expect(appOriginFor('app-7f31c2a4', { protocol: 'http:', host: '127.0.0.1:4173' })).toBeNull();
    expect(appOriginFor('../evil', { protocol: 'https:', host: 'palm.example' })).toBeNull();
  });
});
