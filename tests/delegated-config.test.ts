import { describe, it, expect } from 'vitest';
import { parseDelegatedConfig } from '../electron/delegated-config';

const file = { delegatedTokenUrl: 'https://relay.example.com/delegated/token' };

describe('parseDelegatedConfig', () => {
  it('reads the url from the config file', () => {
    expect(parseDelegatedConfig(file, {})).toEqual({ tokenUrl: file.delegatedTokenUrl });
  });

  it('returns null when it is missing, so the feature simply stays off', () => {
    expect(parseDelegatedConfig({}, {})).toBeNull();
    expect(parseDelegatedConfig(null, {})).toBeNull();
    expect(parseDelegatedConfig({ delegatedTokenUrl: '   ' }, {})).toBeNull();
  });

  it('lets the environment win, so a local relay can be tested without editing the file', () => {
    expect(
      parseDelegatedConfig(file, { GMAIL_DELEGATED_TOKEN_URL: 'http://localhost:8099/delegated/token' })?.tokenUrl,
    ).toBe('http://localhost:8099/delegated/token');
  });

  it('refuses plain http off-machine: the request carries a live Google token', () => {
    expect(parseDelegatedConfig({ delegatedTokenUrl: 'http://relay.example.com/delegated/token' }, {})).toBeNull();
  });

  it('accepts plain http on loopback, which is what local testing needs', () => {
    for (const url of [
      'http://localhost:8099/delegated/token',
      'http://127.0.0.1:8099/delegated/token',
      'http://[::1]:8099/delegated/token',
    ]) {
      expect(parseDelegatedConfig({ delegatedTokenUrl: url }, {})?.tokenUrl).toBe(url);
    }
  });

  it('refuses something that is not an http url at all', () => {
    expect(parseDelegatedConfig({ delegatedTokenUrl: 'wss://relay.example.com' }, {})).toBeNull();
    expect(parseDelegatedConfig({ delegatedTokenUrl: 'relay.example.com' }, {})).toBeNull();
  });
});
