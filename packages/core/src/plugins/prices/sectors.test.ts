// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { NSE_SECTORS, sectorOfIndustry } from './sectors.ts';

describe('NSE sectors', () => {
  it('has NSE’s 22 sectors and 59 industries, each industry in one sector', () => {
    const industries = Object.values(NSE_SECTORS).flat();
    expect(Object.keys(NSE_SECTORS)).toHaveLength(22);
    expect(industries).toHaveLength(59);
    for (const industry of industries)
      expect(Object.values(NSE_SECTORS).filter((list) => list.includes(industry))).toHaveLength(1);
  });

  it('maps report industries whatever their case, spacing and punctuation', () => {
    expect(sectorOfIndustry('Banks')).toBe('Financial Services');
    expect(sectorOfIndustry('Agricultural Food & Other Products')).toBe(
      'Fast Moving Consumer Goods',
    );
    expect(sectorOfIndustry('Non-Ferrous Metals')).toBe('Metals & Mining');
    expect(sectorOfIndustry('IT-Software')).toBe('Information Technology');
    expect(sectorOfIndustry('Pharmaceuticals and Biotechnology')).toBe('Healthcare');
    expect(sectorOfIndustry(' Petroleum Products ')).toBe('Oil Gas & Consumable Fuels');
  });

  it('leaves names outside NSE’s classification alone', () => {
    expect(sectorOfIndustry('Computer Software: Prepackaged Software ##')).toBeUndefined();
    expect(sectorOfIndustry('SOVEREIGN')).toBeUndefined();
    expect(sectorOfIndustry('')).toBeUndefined();
    expect(sectorOfIndustry(undefined)).toBeUndefined();
  });
});
