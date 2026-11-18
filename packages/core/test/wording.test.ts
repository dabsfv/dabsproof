import { describe, expect, it } from 'vitest';
import { lintWording } from '../src/lint/wording.js';

const rules = (t: string) => lintWording(t).map((p) => `${p.rule}:${p.word}`);

describe('wording lint finds', () => {
  it('each forbidden word, in any case, as a whole word', () => {
    expect(rules('This is Secure and safe, unhackable, guaranteed, and audited.')).toEqual([
      'forbidden-word:Secure',
      'forbidden-word:safe',
      'forbidden-word:unhackable',
      'forbidden-word:guaranteed',
      'forbidden-word:audited',
    ]);
  });
  it('US spellings from the list, with the UK form', () => {
    const p = lintWording('Check the authorization and its behavior.');
    expect(p.map((x) => [x.word, x.suggestion])).toEqual([
      ['authorization', 'authorisation'],
      ['behavior', 'behaviour'],
    ]);
  });
  it('capitalised severity words', () => {
    expect(rules('Severity: High. Also CRITICAL.')).toEqual([
      'capitalised-severity:High',
      'capitalised-severity:CRITICAL',
    ]);
  });
});

describe('wording lint leaves alone', () => {
  it('words that only contain a forbidden word', () => {
    expect(lintWording('Unsafe, insecure, safeguard, security, auditor')).toEqual([]);
  });
  it('lowercase severity words', () => {
    expect(lintWording('The default severity is high, rising to critical.')).toEqual([]);
  });
  it('text inside backticks', () => {
    expect(lintWording('Send `Cache-Control: no-store` and read `isSafe()` and `color`.')).toEqual([]);
  });
  it('license, which is left to review', () => {
    expect(lintWording('A license file.')).toEqual([]);
  });
});
