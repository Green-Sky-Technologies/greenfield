import { describe, expect, it } from 'vitest';
import { normalizeBase } from './api';

describe('normalizeBase', () => {
  it('requires https except for local development', () => {
    expect(normalizeBase('https://greenfield.example.com/')).toBe('https://greenfield.example.com');
    expect(normalizeBase('http://localhost:3000')).toBe('http://localhost:3000');
    expect(normalizeBase('http://127.0.0.1:3015')).toBe('http://127.0.0.1:3015');
    expect(normalizeBase('http://[::1]:3000')).toBe('http://[::1]:3000');
    expect(() => normalizeBase('http://greenfield.example.com')).toThrow(/https/);
    expect(() => normalizeBase('http://localhost.evil.com')).toThrow(/https/);
    expect(() => normalizeBase('http://localhost@evil.com')).toThrow();
    expect(() => normalizeBase('https://host/path')).toThrow();
    expect(() => normalizeBase('ftp://host')).toThrow();
  });
});
