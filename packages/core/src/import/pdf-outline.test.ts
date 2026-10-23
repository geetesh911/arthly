// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { mask, outline } from './pdf-outline.ts';

describe('mask', () => {
  it('keeps labels and punctuation', () => {
    expect(mask('Cont. For Due-Month 052025')).toBe('Cont. For Due-Month 999999');
    expect(mask('1,23,456.00 Cr')).toBe('9,99,999.99 Cr');
  });

  it('hides names, IDs and words in any script', () => {
    expect(mask('RAVI KUMAR')).toBe('ABC ABC');
    expect(mask('Ravi kumar')).toBe('Abc abc');
    expect(mask('MHBAN0012345000')).toBe('ABC9999999999');
    expect(mask('कर्मचारी')).toBe('Abc');
  });
});

describe('outline', () => {
  it('lists each row of a PDF with its text masked', async () => {
    // Printed by Chromium from a made-up passbook header and two table rows.
    const text = await outline(
      new Uint8Array(readFileSync(join(import.meta.dirname, 'fixtures/outline.pdf'))),
    );

    expect(text).toContain('Page 1 (596 × 843)');
    expect(text).toContain('"Member ID/Name: ABC9999999999 / ABC ABC"');
    expect(text).toContain('"Wage Month"');
    expect(text).not.toMatch(/RAVI|KUMAR|1,23,456|1990/);
  });
});
