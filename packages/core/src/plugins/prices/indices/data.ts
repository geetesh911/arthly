// SPDX-License-Identifier: AGPL-3.0-only
// Fetches, merges and checks index data. Only each exchange's whole daily file is read, so
// nothing about what anyone holds or follows reaches NSE or BSE.
import { addDays, isISODate, weekdaysBack, type ISODate } from '../../../util/dates.ts';
import { addPoint, capSeries, DAILY_DAYS } from '../feed/format.ts';
import { parseBseIndices, parseNseIndices, type ParsedIndices } from './parse.ts';
import type { IndexDataFile, IndexObservation, IndexProvider, IndexSource } from './types.ts';

const ddmmyyyy = (day: ISODate) => `${day.slice(8, 10)}${day.slice(5, 7)}${day.slice(0, 4)}`;

export const INDEX_SOURCES: Record<
  IndexProvider,
  {
    label: string;
    page: string;
    url: (day: ISODate) => string;
    parse: (text: string) => ParsedIndices;
  }
> = {
  nse: {
    label: 'NSE',
    page: 'https://www.niftyindices.com/reports/daily-reports',
    url: (day) =>
      `https://nsearchives.nseindia.com/content/indices/ind_close_all_${ddmmyyyy(day)}.csv`,
    parse: parseNseIndices,
  },
  bse: {
    label: 'BSE',
    page: 'https://www.bseindia.com/indices/IndexArchiveData.html',
    url: (day) => `https://www.bseindia.com/downloads/allindices/allindices_${ddmmyyyy(day)}.csv`,
    parse: parseBseIndices,
  },
};

const PROVIDERS = Object.keys(INDEX_SOURCES) as IndexProvider[];

/** One file's text, or undefined when there is none for that day. Throws when the site refuses. */
export type ReadIndexFile = (url: string) => Promise<string | undefined>;

/** Today's rows of one file; rows dated later than today are left out. */
function readRows(provider: IndexProvider, text: string, today: ISODate): ParsedIndices {
  const { rows, warnings } = INDEX_SOURCES[provider].parse(text);
  const label = INDEX_SOURCES[provider].label;
  for (const r of rows)
    if (r.date > today) warnings.push(`${label}: ${r.name} is dated after today`);
  return { rows: rows.filter((r) => r.date <= today), warnings };
}

/** One exchange's newest file from the last week of weekdays. */
async function latestFile(
  provider: IndexProvider,
  read: ReadIndexFile,
  today: ISODate,
): Promise<ParsedIndices & { source: IndexSource }> {
  const { label, url } = INDEX_SOURCES[provider];
  const days = weekdaysBack(today, 5);
  for (const day of days) {
    const source: IndexSource = { provider, url: url(day) };
    try {
      const text = await read(source.url);
      if (text === undefined) continue;
      const { rows, warnings } = readRows(provider, text, today);
      if (!rows.length) throw new Error(`${label} index file has no usable indices`);
      const date = rows.map((r) => r.date).reduce((a, b) => (a > b ? a : b));
      return { source: { ...source, date }, rows, warnings };
    } catch (error) {
      // A refusal or a changed layout won't be fixed by reading an older day's file.
      return { source: { ...source, failure: (error as Error).message }, rows: [], warnings: [] };
    }
  }
  const failure = `No ${label} index file in the last week`;
  return { source: { provider, url: url(days[0]!), failure }, rows: [], warnings: [] };
}

/** Every index in NSE's and BSE's newest daily files. Fails only when neither can be read. */
export async function fetchIndexData(read: ReadIndexFile, today: ISODate): Promise<IndexDataFile> {
  const results = await Promise.all(PROVIDERS.map((p) => latestFile(p, read, today)));
  if (results.every((r) => r.source.failure))
    throw new Error(results.map((r) => r.source.failure).join('; '));
  const warnings = results.flatMap((r) => r.warnings);
  return {
    version: 1,
    date: today,
    sources: results.map((r) => r.source),
    series: results.flatMap((r) => r.rows),
    history: {},
    ...(warnings.length ? { warnings } : {}),
  };
}

/** A refresh that read nothing, so that merging keeps the saved data and records why. */
export function failedIndexData(message: string, today: ISODate): IndexDataFile {
  return {
    version: 1,
    date: today,
    sources: PROVIDERS.map((provider) => ({
      provider,
      url: INDEX_SOURCES[provider].page,
      failure: message,
    })),
    series: [],
    history: {},
  };
}

/**
 * Adds a refresh to the saved data. Each series keeps its newest level and the date it was
 * published; every close read goes into the history; an exchange that failed keeps the date of
 * its last good file.
 */
export function mergeIndexData(next: IndexDataFile, previous?: IndexDataFile): IndexDataFile {
  const series = new Map<string, IndexObservation>(previous?.series.map((s) => [s.id, s]));
  for (const s of next.series) {
    const old = series.get(s.id);
    if (!old || s.date >= old.date) series.set(s.id, s);
  }
  const history: IndexDataFile['history'] = {};
  for (const [id, points] of Object.entries(previous?.history ?? {}))
    history[id] = points.map(([d, c]) => [d, c]);
  for (const [id, points] of Object.entries(next.history))
    for (const [d, c] of points) addPoint((history[id] ??= []), d, c);
  for (const s of next.series) addPoint((history[s.id] ??= []), s.date, s.close);
  const date = previous && previous.date > next.date ? previous.date : next.date;
  for (const id of Object.keys(history)) history[id] = capSeries(history[id]!, date);
  const sources = PROVIDERS.flatMap((provider) => {
    const now = next.sources.find((s) => s.provider === provider);
    const old = previous?.sources.find((s) => s.provider === provider);
    if (!now) return old ? [old] : [];
    if (now.failure && old?.date) return [{ ...now, url: old.url, date: old.date }];
    return [now];
  });
  return {
    version: 1,
    date,
    sources,
    series: [...series.values()],
    history,
    ...(next.warnings?.length ? { warnings: next.warnings } : {}),
  };
}

/**
 * Fills gaps in the last 400 days of history from the exchanges' daily archives: newest first,
 * at most `limit` files per exchange per run, four at a time. Only series still listed are kept.
 */
export async function backfillIndexHistory(
  data: IndexDataFile,
  read: ReadIndexFile,
  today: ISODate,
  limit = 100,
): Promise<IndexDataFile> {
  const known = new Set(data.series.map((s) => s.id));
  const found: IndexDataFile['history'] = {};
  const cutoff = addDays(today, -DAILY_DAYS);
  const fill = async (provider: IndexProvider) => {
    // An exchange that refused today's file would refuse its archive too.
    if (data.sources.find((s) => s.provider === provider)?.failure) return;
    const have = new Set(
      Object.entries(data.history)
        .filter(([id]) => id.startsWith(`${provider}:`))
        .flatMap(([, points]) => points.map(([d]) => d)),
    );
    const queue = weekdaysBack(today, DAILY_DAYS)
      .filter((d) => d >= cutoff && !have.has(d))
      .slice(0, limit);
    const worker = async () => {
      for (let day = queue.shift(); day; day = queue.shift()) {
        try {
          const text = await read(INDEX_SOURCES[provider].url(day));
          if (text === undefined) continue;
          for (const r of readRows(provider, text, today).rows)
            if (known.has(r.id)) addPoint((found[r.id] ??= []), r.date, r.close);
        } catch {
          // A day that can't be read stays a gap until the next run.
        }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
  };
  await Promise.all(PROVIDERS.map(fill));
  const merged = mergeIndexData(
    { version: 1, date: data.date, sources: [], series: [], history: found },
    data,
  );
  return data.warnings ? { ...merged, warnings: data.warnings } : merged;
}

/** Checks index data from the relay or the price feed before it is saved. */
export function validateIndexData(value: unknown): IndexDataFile {
  const fail = () => {
    throw new Error('Unexpected index data');
  };
  const file = value as IndexDataFile | null;
  if (
    !file ||
    typeof file !== 'object' ||
    file.version !== 1 ||
    !isISODate(file.date) ||
    !Array.isArray(file.sources) ||
    !Array.isArray(file.series) ||
    file.series.length > 3000 ||
    !file.history ||
    typeof file.history !== 'object' ||
    (file.warnings !== undefined &&
      (!Array.isArray(file.warnings) || file.warnings.some((w) => typeof w !== 'string')))
  )
    fail();
  const text = (v: unknown, max: number) =>
    typeof v === 'string' && v.length > 0 && v.length <= max;
  const date = (v: unknown) => typeof v === 'string' && isISODate(v) && v <= file!.date;
  const positive = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0;
  for (const s of file!.sources)
    if (
      !s ||
      !PROVIDERS.includes(s.provider) ||
      !text(s.url, 500) ||
      (s.date !== undefined && !date(s.date)) ||
      (s.failure !== undefined && !text(s.failure, 500))
    )
      fail();
  const optional = ['open', 'high', 'low', 'change', 'changeRatio', 'pe', 'pb', 'dividendYield'];
  const ids = new Set<string>();
  for (const s of file!.series) {
    if (
      !s ||
      !/^(nse|bse):[a-z0-9-]{1,120}$/.test(s.id) ||
      s.id.split(':')[0] !== s.provider ||
      ids.has(s.id) ||
      !text(s.name, 200) ||
      !['price', 'total', 'net-total', 'volatility', 'unknown'].includes(s.basis) ||
      !['INR', 'USD'].includes(s.currency) ||
      !date(s.date) ||
      !positive(s.close) ||
      optional.some((k) => {
        const v = (s as unknown as Record<string, unknown>)[k];
        return v !== undefined && !(typeof v === 'number' && Number.isFinite(v));
      }) ||
      [s.volume, s.turnover].some((v) => v !== undefined && !(Number.isFinite(v) && v >= 0))
    )
      fail();
    ids.add(s.id);
  }
  const histories = Object.entries(file!.history);
  if (histories.length > 3000) fail();
  for (const [id, points] of histories) {
    if (!/^(nse|bse):[a-z0-9-]{1,120}$/.test(id) || !Array.isArray(points) || points.length > 2000)
      fail();
    let last = '';
    for (const p of points) {
      if (!Array.isArray(p) || !date(p[0]) || !positive(p[1]) || p[0] <= last) fail();
      last = p[0];
    }
  }
  return file!;
}
