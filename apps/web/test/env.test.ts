import { afterEach, describe, expect, it, vi } from 'vitest';
import { readEnv } from '@/server/env';

describe('readEnv (CRUNCH_* → GREENFIELD_* rename, Story 1.1)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('prefers the new name', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(
      readEnv('GREENFIELD_APP_URL', { GREENFIELD_APP_URL: 'new', CRUNCH_APP_URL: 'old' }),
    ).toBe('new');
    expect(warn).not.toHaveBeenCalled();
  });

  it('falls back to the old name with a deprecation warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(readEnv('GREENFIELD_AI_GATEWAY', { CRUNCH_AI_GATEWAY: 'off' })).toBe('off');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('CRUNCH_AI_GATEWAY is deprecated'));
  });

  it('treats empty values as unset', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(
      readEnv('GREENFIELD_AWS_PRINCIPAL_ARN', {
        GREENFIELD_AWS_PRINCIPAL_ARN: '',
        CRUNCH_AWS_PRINCIPAL_ARN: 'arn',
      }),
    ).toBe('arn');
    expect(readEnv('GREENFIELD_AWS_PRINCIPAL_ARN', {})).toBeUndefined();
  });
});
