// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  backfillIndexHistory,
  failedIndexData,
  fetchIndexData,
  INDEX_SOURCES,
  mergeIndexData,
  validateIndexData,
} from './data.ts';
import type { IndexDataFile, IndexObservation } from './types.ts';

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const NSE = fixture('ind_close_all_22102026.csv');
const BSE = fixture('allindices_22102026.csv');

/** Answers the 22 October files; every other day has none. */
function files(extra: Record<string, string | Error> = {}) {
  const asked: string[] = [];
  const table: Record<string, string | Error> = {
    [INDEX_SOURCES.nse.url('2026-10-22')]: NSE,
    [INDEX_SOURCES.bse.url('2026-10-22')]: BSE,
    ...extra,
  };
  const read = async (url: string) => {
    asked.push(url);
    const v = table[url];
    if (v instanceof Error) throw v;
    return v;
  };
  return { read, asked };
}

const obs = (id: string, date: string, close: number): IndexObservation => ({
  id,
  provider: id.startsWith('bse') ? 'bse' : 'nse',
  name: id,
  basis: 'price',
  currency: 'INR',
  date,
  close,
});

describe('fetchIndexData', () => {
  it('reads each exchange’s newest file, going back past days with none', async () => {
    const { read, asked } = files();
    const data = await fetchIndexData(read, '2026-10-24');
    expect(asked).toEqual([
      INDEX_SOURCES.nse.url('2026-10-23'),
      INDEX_SOURCES.bse.url('2026-10-23'),
      INDEX_SOURCES.nse.url('2026-10-22'),
      INDEX_SOURCES.bse.url('2026-10-22'),
    ]);
    expect(data.date).toBe('2026-10-24');
    expect(data.sources).toEqual([
      { provider: 'nse', url: INDEX_SOURCES.nse.url('2026-10-22'), date: '2026-10-22' },
      { provider: 'bse', url: INDEX_SOURCES.bse.url('2026-10-22'), date: '2026-10-22' },
    ]);
    expect(data.series).toHaveLength(29);
    expect(data.history).toEqual({});
  });

  it('keeps one exchange when the other refuses, and says why', async () => {
    const { read } = files({ [INDEX_SOURCES.bse.url('2026-10-22')]: new Error('Refused') });
    const data = await fetchIndexData(read, '2026-10-22');
    expect(data.series.every((s) => s.provider === 'nse')).toBe(true);
    expect(data.sources[1]).toEqual({
      provider: 'bse',
      url: INDEX_SOURCES.bse.url('2026-10-22'),
      failure: 'Refused',
    });
  });

  it('stops at a file with changed headings instead of reading an older one', async () => {
    const { read, asked } = files({ [INDEX_SOURCES.nse.url('2026-10-22')]: 'Name,Value\nx,1' });
    const data = await fetchIndexData(read, '2026-10-22');
    expect(data.sources[0]!.failure).toBe('NSE index file headings have changed');
    expect(asked.filter((u) => u.includes('nseindia'))).toHaveLength(1);
  });

  it('fails only when neither exchange has a file this week', async () => {
    await expect(fetchIndexData(async () => undefined, '2026-11-02')).rejects.toThrow(
      'No NSE index file in the last week; No BSE index file in the last week',
    );
  });

  it('leaves out rows dated after today', async () => {
    const [head] = NSE.split('\n');
    const { read } = files({
      [INDEX_SOURCES.nse.url('2026-10-21')]: [
        head,
        'Nifty 50,21-10-2026,-,-,-,22811.35,-,-,-,-,-,-,-',
        'Nifty Early,23-10-2026,-,-,-,100,-,-,-,-,-,-,-',
      ].join('\n'),
    });
    const data = await fetchIndexData(read, '2026-10-21');
    expect(data.series.map((s) => [s.id, s.date])).toEqual([['nse:nifty-50', '2026-10-21']]);
    expect(data.warnings).toEqual(['NSE: Nifty Early is dated after today']);
  });
});

describe('mergeIndexData', () => {
  const day1: IndexDataFile = {
    version: 1,
    date: '2026-10-21',
    sources: [
      { provider: 'nse', url: 'n21', date: '2026-10-21' },
      { provider: 'bse', url: 'b21', date: '2026-10-21' },
    ],
    series: [obs('nse:a', '2026-10-21', 100), obs('bse:b', '2026-10-21', 50)],
    history: {},
  };

  it('adds each refresh’s closes to the saved history', () => {
    const first = mergeIndexData(day1, undefined);
    expect(first.history).toEqual({
      'nse:a': [['2026-10-21', 100]],
      'bse:b': [['2026-10-21', 50]],
    });
    const second = mergeIndexData(
      {
        ...day1,
        date: '2026-10-22',
        sources: [
          { provider: 'nse', url: 'n22', date: '2026-10-22' },
          { provider: 'bse', url: 'b22', failure: 'Refused' },
        ],
        series: [obs('nse:a', '2026-10-22', 101)],
      },
      first,
    );
    expect(second.history['nse:a']).toEqual([
      ['2026-10-21', 100],
      ['2026-10-22', 101],
    ]);
    // A failed exchange keeps its earlier levels and the date of its last file.
    expect(second.series).toEqual([
      obs('nse:a', '2026-10-22', 101),
      obs('bse:b', '2026-10-21', 50),
    ]);
    expect(second.sources[1]).toEqual({
      provider: 'bse',
      url: 'b21',
      date: '2026-10-21',
      failure: 'Refused',
    });
  });

  it('never lets an older file replace a newer level', () => {
    const merged = mergeIndexData(
      { ...day1, date: '2026-10-22', series: [obs('nse:a', '2026-10-20', 90)] },
      mergeIndexData(day1, undefined),
    );
    expect(merged.series[0]).toEqual(obs('nse:a', '2026-10-21', 100));
    expect(merged.history['nse:a']).toEqual([
      ['2026-10-20', 90],
      ['2026-10-21', 100],
    ]);
  });

  it('keeps saved data when a whole refresh fails', () => {
    const saved = mergeIndexData(day1, undefined);
    const merged = mergeIndexData(failedIndexData('offline', '2026-10-23'), saved);
    expect(merged.series).toEqual(saved.series);
    expect(merged.history).toEqual(saved.history);
    expect(merged.sources.map((s) => [s.date, s.failure])).toEqual([
      ['2026-10-21', 'offline'],
      ['2026-10-21', 'offline'],
    ]);
  });
});

describe('validateIndexData', () => {
  const good = mergeIndexData(
    {
      version: 1,
      date: '2026-10-22',
      sources: [{ provider: 'nse', url: 'https://nsearchives.nseindia.com/x.csv' }],
      series: [obs('nse:nifty-50', '2026-10-22', 22687.65)],
      history: {},
    },
    undefined,
  );

  it('accepts what the relay and feed send', () => {
    expect(validateIndexData(JSON.parse(JSON.stringify(good)))).toEqual(good);
  });

  it.each([
    ['an HTML page', '<html></html>'],
    ['another version', { ...good, version: 2 }],
    ['a zero level', { ...good, series: [{ ...good.series[0], close: 0 }] }],
    ['a text level', { ...good, series: [{ ...good.series[0], close: '1' }] }],
    ['a future level', { ...good, series: [{ ...good.series[0], date: '2026-10-23' }] }],
    ['an unknown basis', { ...good, series: [{ ...good.series[0], basis: 'gross' }] }],
    ['a mislabelled provider', { ...good, series: [{ ...good.series[0], provider: 'bse' }] }],
    ['a duplicate series', { ...good, series: [good.series[0], good.series[0]] }],
    [
      'unsorted history',
      {
        ...good,
        history: {
          'nse:nifty-50': [
            ['2026-10-22', 1],
            ['2026-10-21', 1],
          ],
        },
      },
    ],
    ['an impossible history date', { ...good, history: { 'nse:nifty-50': [['2026-02-30', 1]] } }],
    ['an unknown source', { ...good, sources: [{ provider: 'msci', url: 'x' }] }],
  ])('rejects %s', (_, value) => {
    expect(() => validateIndexData(value)).toThrow('Unexpected index data');
  });
});

describe('backfillIndexHistory', () => {
  it('fills missing weekdays from the daily archives, newest first and within a limit', async () => {
    const saved = mergeIndexData(
      {
        version: 1,
        date: '2026-10-23',
        sources: [
          { provider: 'nse', url: 'n', date: '2026-10-23' },
          { provider: 'bse', url: 'b', failure: 'Refused' },
        ],
        series: [obs('nse:nifty-50', '2026-10-23', 22700)],
        history: {},
      },
      undefined,
    );
    const { read, asked } = files();
    const filled = await backfillIndexHistory(saved, read, '2026-10-23', 3);
    // Only the exchange that answered today is asked, and only for series still listed.
    expect(asked).toEqual(
      ['2026-10-22', '2026-10-21', '2026-10-20'].map((d) => INDEX_SOURCES.nse.url(d)),
    );
    expect(filled.history).toEqual({
      'nse:nifty-50': [
        ['2026-10-22', 22687.65],
        ['2026-10-23', 22700],
      ],
    });
    expect(filled.series).toEqual(saved.series);
  });
});
