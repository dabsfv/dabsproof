// Runs the wording lint over every registry entry, and checks how "facilitator" is introduced.
import { checks, FACILITATOR_GLOSS } from '@dabsproof/registry';
import { describe, expect, it } from 'vitest';
import { registryText } from '../src/lint/registry-text.js';
import { lintWording } from '../src/lint/wording.js';

describe('registry wording', () => {
  for (const entry of checks) {
    it(`${entry.id}: passes the wording lint`, () => {
      const found = registryText(entry).flatMap((p) =>
        lintWording(p.text).map((w) => `${p.field}: ${w.rule} "${w.word}"`),
      );
      expect(found).toEqual([]);
    });

    it(`${entry.id}: glosses "facilitator" once, at its first mention after the title`, () => {
      const [title, ...rest] = registryText(entry);
      const body = rest.map((p) => p.text).join('\n');
      expect(title?.text ?? '').not.toMatch(/payment service/i);
      const first = body.search(/facilitator/i);
      const glosses = body.split(FACILITATOR_GLOSS).length - 1;
      if (first === -1) {
        expect(glosses).toBe(0);
      } else {
        expect(body.slice(first).startsWith(`facilitator ${FACILITATOR_GLOSS}`)).toBe(true);
        expect(glosses).toBe(1);
      }
      expect(body.split(FACILITATOR_GLOSS).join('')).not.toMatch(/payment service/i);
    });
  }
});
