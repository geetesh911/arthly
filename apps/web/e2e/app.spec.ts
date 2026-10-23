// SPDX-License-Identifier: AGPL-3.0-only
import { expect, type Page, type Route, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const fixtures = join(import.meta.dirname, '../../../packages/core/src/plugins/importers');
const MF = join(fixtures, 'groww-mf-holdings/fixtures/holdings.xlsx');
const STOCKS = join(fixtures, 'groww-stock-holdings/fixtures/holdings.xlsx');
const PPF = join(fixtures, 'bob-ppf-statement/fixtures/statement.xlsx');
const EPF = join(fixtures, 'epfo-passbook/fixtures/passbook.pdf');
// Both Groww files, zipped by macOS (so with __MACOSX copies and a .DS_Store).
const ZIP = join(import.meta.dirname, '../../../packages/core/src/import/fixtures/statements.zip');
const PASSPHRASE = 'correct horse battery staple';
const PRICES = join(import.meta.dirname, '../../../packages/core/src/plugins/prices/feed/fixtures');
const CAPS = join(PRICES, '../../caps/fixtures/AverageMarketCapitalization30Jun2026.xlsx');
const CAPS_URL = 'https://portal.amfiindia.com/spages/AverageMarketCapitalization30Jun2026.xlsx';

test.beforeEach(async ({ page }) => {
  // No price relay or feed in tests; values come from the imported files.
  await page.route(/github\.io|frankfurter|\/api\/prices\//, (route) => route.abort());
});

async function createVault(page: Page, name = 'Family') {
  if (
    !(await page
      .getByLabel('Name of this portfolio')
      .isVisible()
      .catch(() => false))
  ) {
    await page.goto('/');
  }

  await page.getByLabel('Name of this portfolio').fill(name);
  await page.getByLabel(/Your name/).fill('Asha');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel('Passphrase (at least 10 characters)').fill(PASSPHRASE);
  await page.getByLabel('Type it again').fill(PASSPHRASE);
  await page.getByRole('button', { name: 'Create' }).click();
  const code = (await page.getByTestId('recovery-code').textContent())!.trim();

  await page.getByLabel(/Type the code/).fill(code);
  await page.getByRole('button', { name: "I've saved it" }).click();
  const later = page.getByRole('button', { name: /Not now|Continue/ });

  await later.click();
  await expect(page.getByRole('heading', { name: 'Add', exact: true })).toBeVisible();

  return code;
}

// Desktop has Settings in the sidebar; phones reach it through More.
async function openSettings(page: Page) {
  const direct = page.getByRole('navigation', { name: 'Sections' }).getByRole('link', {
    name: 'Settings',
  });
  const more = page.getByRole('navigation', { name: 'Screens' }).getByRole('link', {
    name: 'More',
  });

  await expect(direct.or(more)).toBeVisible();

  if (await direct.isVisible()) {
    return direct.click();
  }

  await more.click();
  await page.getByRole('link', { name: /Settings, backup/ }).click();
}

async function netWorth(page: Page) {
  await page.getByRole('link', { name: 'Home' }).click();

  return (await page.getByTestId('net-worth').textContent())!.trim();
}

test('create a vault, import the Groww files and see the totals', async ({ page }) => {
  await createVault(page);
  await page.getByTestId('import-input').setInputFiles(MF);
  await expect(page.getByText('The file’s totals match its lines')).toBeVisible();
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await page.getByTestId('import-input').setInputFiles(STOCKS);
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  expect(await netWorth(page)).toBe('₹12,91,439');
  await page.getByRole('link', { name: 'Holdings' }).click();
  await expect(page.getByText('Parag Parikh ELSS Tax Saver Fund Direct Growth')).toBeVisible();
  await expect(page.getByText('2.50%GOLDBONDS2032SR-IV')).toBeVisible();
});

test('refresh prices through the relay', async ({ page }) => {
  const relayed = (name: string, source: string) => async (route: Route) =>
    route.fulfill({
      body: await readFile(join(PRICES, name)),
      headers: { 'x-relay-source': source },
    });

  await page.route('**/api/prices/amfi', relayed('NAVAll.txt', 'amfi'));
  await page.route('**/api/prices/exchange', relayed('nse-bhavcopy.csv.zip', 'nse'));
  await page.route('**/api/prices/nse-reference', (route) =>
    route.fulfill({
      json: {
        date: '2026-10-21',
        rows: [
          {
            symbol: 'RELIANCE',
            isin: 'INE002A01018',
            industry: 'Oil, Gas & Consumable Fuels',
            marketCap: 'large',
          },
        ],
        stale: [],
      },
      headers: { 'x-relay-source': 'nse-reference' },
    }),
  );
  await page.route('**/api/prices/amfi-caps', async (route) =>
    route.fulfill({
      body: await readFile(CAPS),
      headers: { 'x-relay-source': 'amfi-caps', 'x-source-url': CAPS_URL },
    }),
  );
  await page.route(/frankfurter/, (route) =>
    route.fulfill({ json: { date: '2026-10-21', rates: { INR: 88.12 } } }),
  );
  await createVault(page);
  await page.getByTestId('import-input').setInputFiles(STOCKS);
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await page.getByRole('link', { name: 'Holdings' }).click();
  await page.getByRole('button', { name: 'Refresh prices' }).click();
  await expect(page.getByText('Prices updated')).toBeVisible();
  await expect(page.getByText('Prices: stocks 21 Oct')).toBeVisible();
  await page.getByRole('link', { name: 'Home', exact: true }).click();
  await page.getByRole('link', { name: 'Explore analytics' }).click();
  const sectors = page
    .locator('[data-slot=card]')
    .filter({ has: page.getByText('Sector allocation', { exact: true }) });

  await expect(sectors.getByText('Oil, Gas & Consumable Fuels', { exact: true })).toBeVisible();
  await expect(sectors.getByText(/classified/, { exact: false }).first()).toBeVisible();
  const concentration = page
    .locator('[data-slot=card]')
    .filter({ has: page.getByText('Stock concentration', { exact: true }) });

  await expect(concentration.getByText('RELIANCE INDUSTRIES LTD', { exact: true })).toBeVisible();
  await expect(page.getByText('Large cap', { exact: true })).toBeVisible();
  await expect(
    page.getByText(/AMFI cap list: six months to 30 Jun 2026, 9 companies/),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Official file' }).last()).toHaveAttribute(
    'href',
    CAPS_URL,
  );
  await expect(page.getByRole('heading', { name: 'Analytics', exact: true })).toBeVisible();
});

test('fund disclosures update stock exposure and show searchable underlying weights', async ({
  page,
}, info) => {
  const errors: string[] = [];

  page.on('pageerror', (error) => errors.push(error.message));
  const sourceUrl =
    'https://amc.ppfas.com/downloads/portfolio-disclosure/2026/PPFAS_Monthly_Portfolio_Report_September_30_2026.xls';
  // Later, HDFC's list and PPFAS's workbook stop answering.
  let sourcesUp = true;

  await page.route('**/api/prices/amfi', async (route) =>
    route.fulfill({
      body: await readFile(join(PRICES, 'NAVAll.txt')),
      headers: { 'x-relay-source': 'amfi' },
    }),
  );
  await page.route('**/api/prices/exchange', async (route) =>
    route.fulfill({
      body: await readFile(join(PRICES, 'nse-bhavcopy.csv.zip')),
      headers: { 'x-relay-source': 'nse' },
    }),
  );
  await page.route('**/api/prices/fund-disclosures', (route) =>
    route.fulfill({
      json: {
        version: 1,
        date: '2026-10-23',
        files: [{ source: 'ppfas', url: sourceUrl, name: 'ppfas.xls' }],
        failures: sourcesUp ? [] : [{ source: 'hdfc', message: 'Source returned 403' }],
      },
      headers: { 'x-relay-source': 'fund-disclosures' },
    }),
  );
  await page.route('**/api/prices/fund-workbook?*', async (route) =>
    sourcesUp
      ? route.fulfill({
          body: await readFile(join(PRICES, '../../fund-holdings/fixtures/ppfas.xls')),
          headers: { 'x-relay-source': 'fund-workbook' },
        })
      : route.fulfill({ status: 502, body: 'The fund portfolio workbook is unavailable' }),
  );
  await page.route('**/api/prices/nse-reference', (route) =>
    route.fulfill({
      json: {
        date: '2026-10-23',
        rows: [
          {
            symbol: 'HDFCBANK',
            isin: 'INE040A01034',
            industry: 'Financial Services',
            marketCap: 'large',
          },
        ],
        stale: [],
      },
      headers: { 'x-relay-source': 'nse-reference' },
    }),
  );
  await createVault(page);
  await page.getByTestId('import-input').setInputFiles(MF);
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await page.getByRole('link', { name: 'Home', exact: true }).click();
  await page.getByRole('link', { name: 'Explore analytics' }).click();
  await page.getByRole('button', { name: 'Refresh data' }).click();
  await expect(page.getByRole('button', { name: 'Refresh data' })).toBeEnabled();
  const fundCard = page
    .locator('[data-slot=card]')
    .filter({ has: page.getByText('Fund underlying holdings', { exact: true }) });

  await fundCard
    .getByRole('combobox', { name: 'Fund portfolio' })
    .selectOption({ label: 'Parag Parikh ELSS Tax Saver Fund Direct Growth' });
  await expect(fundCard.getByText(/Portfolio as of 30 Sept? 2026/)).toBeVisible();
  await expect(fundCard.getByRole('link', { name: 'Official disclosure' })).toHaveAttribute(
    'href',
    sourceUrl,
  );
  const search = fundCard.getByRole('searchbox', { name: 'Search underlying holdings' });

  await search.fill('INE040A01034');
  const row = fundCard.getByRole('row').filter({ hasText: 'HDFC Bank Limited' });

  await expect(row.getByText('7.57%', { exact: true })).toBeVisible();
  await expect(row.getByText('₹3,501', { exact: true })).toBeVisible();
  await expect(row.getByText('INE040A01034', { exact: true })).toBeVisible();
  await search.fill('missing-security');
  await expect(fundCard.getByText('No matching securities.')).toBeVisible();
  await search.fill('');
  await fundCard.getByRole('button', { name: /Show all \d+ holdings/ }).click();
  await expect(fundCard.getByRole('button', { name: 'Show largest 20' })).toBeVisible();
  await fundCard.getByRole('button', { name: 'Show largest 20' }).click();
  const stocks = page
    .locator('[data-slot=card]')
    .filter({ has: page.getByText('Stock concentration', { exact: true }) });

  await expect(stocks.getByText('HDFC Bank Limited', { exact: true })).toBeVisible();
  await expect(stocks.getByText('Direct / via funds', { exact: true })).toBeVisible();
  await fundCard
    .getByRole('combobox', { name: 'Fund portfolio' })
    .selectOption({ label: 'Tata Nifty Next 50 Index Direct' });
  await expect(fundCard.getByText('Disclosure unavailable', { exact: true })).toBeVisible();
  // That fund counts by its type in the asset split; PPFAS's report gives its stocks' sectors.
  const card = (title: string) =>
    page.locator('[data-slot=card]').filter({ has: page.getByText(title, { exact: true }) });

  await expect(card('Underlying asset split').getByText(/\d+% by fund type/)).toBeVisible();
  await expect(
    card('Sector allocation').getByText('Information Technology', { exact: true }),
  ).toBeVisible();
  await fundCard
    .getByRole('combobox', { name: 'Fund portfolio' })
    .selectOption({ label: 'Parag Parikh ELSS Tax Saver Fund Direct Growth' });
  await search.fill('HDFC');
  await expect(page.getByText('Imported holdings.xlsx', { exact: true })).toBeHidden({
    timeout: 10_000,
  });
  await fundCard.evaluate((card) =>
    window.scrollBy(0, card.getBoundingClientRect().top - (window.innerWidth < 1024 ? 72 : 24)),
  );
  await page.screenshot({ path: `/tmp/arthly-fund-holdings-${info.project.name}.png` });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(await fundCard.evaluate((card) => card.scrollWidth <= card.clientWidth + 1)).toBe(true);
  expect(
    await fundCard
      .getByRole('table')
      .evaluate((table) => table.scrollWidth <= table.clientWidth + 1),
  ).toBe(true);

  // A refresh that falls short keeps the saved report and says which AMCs failed.
  sourcesUp = false;
  await page.getByRole('button', { name: 'Refresh data' }).click();
  await expect(page.getByRole('button', { name: 'Refresh data' })).toBeEnabled();
  await fundCard
    .getByRole('combobox', { name: 'Fund portfolio' })
    .selectOption({ label: 'Parag Parikh ELSS Tax Saver Fund Direct Growth' });
  await expect(fundCard.getByText('Saved earlier', { exact: true })).toBeVisible();
  await expect(fundCard.getByText(/Portfolio as of 30 Sept? 2026/)).toBeVisible();
  const sources = page
    .locator('[data-slot=card]')
    .filter({ has: page.getByText('Data behind the analysis', { exact: true }) });

  await expect(
    sources.getByText('Some fund reports couldn’t be refreshed.', { exact: false }),
  ).toBeVisible();
  await expect(sources.getByRole('listitem').filter({ hasText: 'HDFC:' })).toContainText(
    'Source returned 403',
  );
  await expect(sources.getByRole('listitem').filter({ hasText: 'PPFAS:' })).toContainText(
    'ppfas.xls: The fund portfolio workbook is unavailable',
  );
  await sources.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `/tmp/arthly-fund-failures-${info.project.name}.png` });
  await fundCard.evaluate((card) =>
    window.scrollBy(0, card.getBoundingClientRect().top - (window.innerWidth < 1024 ? 72 : 24)),
  );
  await page.screenshot({ path: `/tmp/arthly-fund-saved-${info.project.name}.png` });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(errors).toEqual([]);
});

test('a fund report added by hand fills in for one the relay can’t fetch', async ({
  page,
}, info) => {
  const errors: string[] = [];

  page.on('pageerror', (error) => errors.push(error.message));
  await createVault(page);
  await page.getByTestId('import-input').setInputFiles(MF);
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await page.getByRole('link', { name: 'Home', exact: true }).click();
  await page.getByRole('link', { name: 'Explore analytics' }).click();
  const fundCard = page
    .locator('[data-slot=card]')
    .filter({ has: page.getByText('Fund underlying holdings', { exact: true }) });
  const pick = () =>
    fundCard
      .getByRole('combobox', { name: 'Fund portfolio' })
      .selectOption({ label: 'Parag Parikh ELSS Tax Saver Fund Direct Growth' });

  await pick();
  await expect(fundCard.getByText('Disclosure unavailable', { exact: true })).toBeVisible();

  await fundCard
    .getByTestId('fund-report-input')
    .setInputFiles(join(PRICES, '../../fund-holdings/fixtures/ppfas.xls'));
  await expect(fundCard.getByRole('status')).toContainText(
    /Added \d+ schemes as of 30 Sept? 2026\. Now used for Parag Parikh ELSS Tax Saver Fund Direct Growth\./,
  );
  await pick();
  await expect(fundCard.getByText('Added by you', { exact: true })).toBeVisible();
  await expect(fundCard.getByText(/Portfolio as of 30 Sept? 2026/)).toBeVisible();
  await expect(fundCard.getByRole('link', { name: 'Official disclosure' })).toBeHidden();
  await expect(fundCard.getByText(/Added on this device: \d+ schemes/)).toBeVisible();
  await fundCard.getByTestId('fund-report-input').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `/tmp/arthly-fund-added-${info.project.name}.png` });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );

  // Another file is turned down with a reason, and the added report stays.
  await fundCard.getByTestId('fund-report-input').setInputFiles(STOCKS);
  await expect(fundCard.getByRole('status')).toHaveText(
    'holdings.xlsx isn’t a monthly portfolio report the app can read',
  );
  await fundCard.getByRole('button', { name: 'Remove added reports' }).click();
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(fundCard.getByRole('status')).toHaveText('Removed the reports you added.');
  await pick();
  await expect(fundCard.getByText('Disclosure unavailable', { exact: true })).toBeVisible();
  await expect(fundCard.getByRole('button', { name: 'Remove added reports' })).toBeHidden();
  expect(errors).toEqual([]);
});

test('import a PPF statement once', async ({ page }) => {
  await createVault(page);
  await page.getByTestId('import-input').setInputFiles(PPF);
  // An account, the PPF, 9 entries and the closing balance.
  await expect(page.getByText('12 new, 0 changed.')).toBeVisible();
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await page.getByTestId('import-input').setInputFiles(PPF);
  await expect(page.getByText('Already up to date')).toBeVisible();
  await page.getByRole('link', { name: 'Holdings' }).click();
  await expect(page.getByText('PPF (Bank of Baroda ••••2345)')).toBeVisible();
});

test('update a bank balance from its holding, typing only the date and amount', async ({
  page,
}) => {
  await createVault(page);
  await page.getByRole('link', { name: 'PPF, EPF or cash' }).click();
  await page.getByLabel('Account type').selectOption('cash');
  await page.getByLabel('Bank', { exact: true }).fill('Example Bank');
  await page.getByLabel('Account number').fill('000123456789');
  await page.getByLabel('Balance (₹)').fill('50,000');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('link', { name: 'Holdings' }).click();
  await page.getByRole('link', { name: /Example Bank savings/ }).click();
  await page.getByRole('link', { name: 'Update balance' }).click();
  await expect(page.getByTestId('balance-holding')).toContainText('Example Bank savings ••••6789');
  await expect(page.getByLabel('Bank', { exact: true })).toBeHidden();
  await page.getByLabel('Balance (₹)').fill('62,500');
  await page.getByRole('button', { name: 'Save' }).click();
  // Back on the holding, valued at the new balance.
  await expect(page.getByRole('heading', { name: 'Example Bank savings' })).toBeVisible();
  await expect(page.getByTestId('holding-value')).toHaveText('₹62,500');

  // A PPF with recorded deposits and interest is valued from those, so it has no such button.
  await page.locator('a[href="#/add"]:visible').click();
  await page.getByTestId('import-input').setInputFiles(PPF);
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await page.getByRole('link', { name: 'Holdings' }).click();
  await page.getByRole('link', { name: /PPF \(Bank of Baroda/ }).click();
  await expect(page.getByRole('heading', { name: /PPF \(Bank of Baroda/ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Update balance' })).toBeHidden();
});

test('import an EPF passbook PDF', async ({ page }) => {
  await createVault(page);
  await page.getByTestId('import-input').setInputFiles(EPF);
  // The account, EPF and EPS, 38 entries and the opening and closing balances of each.
  await expect(page.getByText('45 new, 0 changed.')).toBeVisible();
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await page.getByRole('link', { name: 'Holdings' }).click();
  await expect(page.getByText('EPF (Acme Software Private Limited ••••8765)')).toBeVisible();
  await expect(page.getByText('EPS (Acme Software Private Limited ••••8765)')).toBeVisible();
});

test('import a zip of statements', async ({ page }) => {
  await createVault(page);
  await page.getByTestId('import-input').setInputFiles(ZIP);

  for (const name of ['stocks.xlsx', 'mf.xlsx']) {
    await expect(page.getByText(name, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Import', exact: true }).click();
  }

  expect(await netWorth(page)).toBe('₹12,91,439');
});

test('index levels load with nothing held, are searchable and survive a failed exchange', async ({
  page,
}, info) => {
  const errors: string[] = [];

  page.on('pageerror', (error) => errors.push(error.message));
  const series = (id: string, name: string, close: number, extra = {}) => ({
    id,
    provider: id.slice(0, 3),
    name,
    basis: 'price',
    currency: 'INR',
    date: '2026-10-22',
    close,
    changeRatio: -0.0054,
    ...extra,
  });
  const nse = [
    series('nse:nifty-50', 'Nifty 50', 22687.65),
    series('nse:india-vix', 'India VIX', 15.76, { basis: 'volatility', changeRatio: 0.0056 }),
    ...Array.from({ length: 12 }, (_, i) =>
      series(`nse:nifty-sector-${i}`, `Nifty Sector ${i}`, 1000 + i),
    ),
  ];
  const sensex = series('bse:sensex', 'BSE SENSEX', 73249.39, { changeRatio: -0.0062 });
  let bseUp = true;

  await page.route('**/api/prices/index-data', (route) =>
    route.fulfill({
      json: {
        version: 1,
        date: '2026-10-23',
        sources: [
          {
            provider: 'nse',
            url: 'https://nsearchives.nseindia.com/content/indices/ind_close_all_22102026.csv',
            date: '2026-10-22',
          },
          bseUp
            ? {
                provider: 'bse',
                url: 'https://www.bseindia.com/downloads/allindices/allindices_22102026.csv',
                date: '2026-10-22',
              }
            : {
                provider: 'bse',
                url: 'https://www.bseindia.com/downloads/allindices/allindices_23102026.csv',
                failure: 'The site refused the request',
              },
        ],
        series: bseUp ? [...nse, sensex] : nse,
        // The feed's history: a close a month earlier gives Nifty 50 a 1-month change.
        history: { 'nse:nifty-50': [['2026-09-22', 23000]] },
      },
      headers: { 'x-relay-source': 'index-data' },
    }),
  );
  await createVault(page);
  const direct = page.getByRole('navigation', { name: 'Sections' }).getByRole('link', {
    name: 'Analytics',
  });

  if (await direct.isVisible()) {
    await direct.click();
  } else {
    await page
      .getByRole('navigation', { name: 'Screens' })
      .getByRole('link', { name: 'More' })
      .click();
    await page.getByRole('link', { name: /Portfolio analytics/ }).click();
  }

  await expect(page.getByText('Your portfolio analysis starts here')).toBeVisible();
  await page.getByRole('button', { name: 'Refresh data' }).click();
  await expect(page.getByRole('button', { name: 'Refresh data' })).toBeEnabled();
  const card = page
    .locator('[data-slot=card]')
    .filter({ has: page.getByText('Indices and benchmarks', { exact: true }) });

  await expect(card.getByRole('listitem').filter({ hasText: 'NSE:' })).toContainText(
    '14 indices, 22 Oct 2026',
  );
  const nifty = card.getByRole('row').filter({ hasText: 'Nifty 50' });

  await expect(nifty.getByText('22,687.65', { exact: true })).toBeVisible();
  await expect(nifty.getByText('-1.4%', { exact: true })).toBeVisible();
  await expect(card.getByRole('row').filter({ hasText: 'India VIX' })).toContainText(
    'NSE · Volatility',
  );
  // Headline indices come first; the rest wait behind a button.
  await expect(card.getByText('Nifty Sector 11', { exact: true })).toBeHidden();
  await card.getByRole('button', { name: 'Show all 15 indices' }).click();
  await expect(card.getByText('Nifty Sector 11', { exact: true })).toBeVisible();
  const search = card.getByRole('searchbox', { name: 'Search indices' });

  await search.fill('sensex');
  await expect(card.getByRole('row')).toHaveCount(2);
  await expect(card.getByText('BSE SENSEX', { exact: true })).toBeVisible();
  await search.fill('no such index');
  await expect(card.getByText('No matching indices.')).toBeVisible();
  await search.fill('');

  // BSE stops answering: its saved levels stay, with the date they are from.
  bseUp = false;
  await page.getByRole('button', { name: 'Refresh data' }).click();
  await expect(page.getByRole('button', { name: 'Refresh data' })).toBeEnabled();
  await expect(card.getByRole('listitem').filter({ hasText: 'BSE:' })).toContainText(
    'Couldn’t refresh (The site refused the request). Showing levels from 22 Oct 2026.',
  );
  await expect(card.getByText('BSE SENSEX', { exact: true })).toBeVisible();
  await card.evaluate((c) =>
    window.scrollBy(0, c.getBoundingClientRect().top - (window.innerWidth < 1024 ? 72 : 24)),
  );
  await page.screenshot({ path: `/tmp/arthly-indices-${info.project.name}.png` });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(await card.evaluate((c) => c.scrollWidth <= c.clientWidth + 1)).toBe(true);
  expect(errors).toEqual([]);
});

test('rename and remove members and accounts', async ({ page }) => {
  await createVault(page);
  await page.getByTestId('import-input').setInputFiles(STOCKS);
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await openSettings(page);

  const members = page.getByRole('list', { name: 'Members' });

  await page.getByLabel('New member').fill('Ravi');
  await page.getByLabel('New member').press('Enter');
  await expect(page.getByRole('status')).toContainText('Member added');
  await members.getByRole('button', { name: 'Rename Ravi' }).click();
  await page.getByLabel('New name for Ravi').fill('Ravi K');
  await page.getByLabel('New name for Ravi').press('Enter');
  await expect(members.getByText('Ravi K')).toBeVisible();
  await members.getByRole('button', { name: 'Remove Asha' }).click();
  await expect(page.getByRole('status')).toContainText('Remove Asha’s accounts first');
  await members.getByRole('button', { name: 'Remove Ravi K' }).click();
  await expect(members.getByText('Ravi K')).toBeHidden();

  const accounts = page.getByRole('list', { name: 'Accounts' });

  await accounts.getByRole('button', { name: /^Rename Groww demat/ }).click();
  await page.getByLabel(/^New name for Groww demat/).fill('My stocks');
  await accounts.getByRole('button', { name: 'Save', exact: true }).click();
  await accounts.getByRole('button', { name: 'Remove My stocks' }).click();
  const dialog = page.getByRole('alertdialog');

  await expect(dialog).toContainText('This also removes its 6 statement balances.');
  await dialog.getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByText('No accounts yet.')).toBeVisible();
  await page.getByRole('link', { name: 'Home' }).click();
  await expect(page.getByText('Welcome')).toBeVisible();
});

test('lock and unlock', async ({ page }) => {
  const code = await createVault(page);

  await page.getByRole('button', { name: 'Lock', exact: true }).click();
  await page.getByLabel('Passphrase').fill('wrong passphrase');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('status')).toContainText('Wrong passphrase');
  await page.getByLabel('Passphrase').fill(PASSPHRASE);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('button', { name: 'Lock', exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: /recovery code/ }).click();
  await page.getByLabel('Recovery code').fill(code.toLowerCase());
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('button', { name: 'Lock', exact: true })).toBeVisible();
});

test('opens offline once loaded, even where _headers is refused', async ({ page, context }) => {
  // Like the relay, which answers 502 for Cloudflare's _headers file.
  await context.route('**/_headers', (route) => route.fulfill({ status: 502 }));
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Try with sample data' })).toBeVisible();
});

test('switches to a new version when asked, not only after every tab closes', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.getByRole('button', { name: 'Try with sample data' }).click();
  // The same worker at another address stands in for a new release: Playwright can't rewrite
  // the worker's own script.
  await page.evaluate(() => navigator.serviceWorker.register('service-worker.js?next'));
  await expect(page.getByText('A new version is ready.')).toBeVisible();
  await page.getByRole('button', { name: 'Update now' }).click();
  // The page reloads under the new version, which locks the app.
  await expect(page.getByRole('button', { name: 'Try with sample data' })).toBeVisible();
  expect(
    await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL.endsWith('?next')),
  ).toBe(true);
});

test('export to Excel and re-import into another portfolio', async ({ page }) => {
  await createVault(page);
  await page.getByTestId('import-input').setInputFiles(MF);
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  const before = await netWorth(page);

  await openSettings(page);
  await page.getByRole('button', { name: 'Export to Excel' }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('alertdialog').getByRole('button', { name: 'Export' }).click(),
  ]);
  const bytes = await readFile((await download.path())!);

  await page.getByRole('button', { name: 'Lock', exact: true }).click();
  await page.getByRole('button', { name: 'New portfolio' }).click();
  await createVault(page, 'Copy');
  await page.getByTestId('import-input').setInputFiles({
    name: 'export.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: bytes,
  });
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  expect(await netWorth(page)).toBe(before);
});

test('restore a backup file', async ({ page }) => {
  await createVault(page);
  await page.getByTestId('import-input').setInputFiles(STOCKS);
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  const before = await netWorth(page);

  await openSettings(page);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Save an encrypted backup' }).click(),
  ]);
  const bytes = await readFile((await download.path())!);

  await page.getByRole('button', { name: 'Remove this portfolio from this device' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Remove' }).click();

  await page.getByRole('button', { name: 'Restore a backup file' }).click();
  await page
    .getByLabel('Backup file (.pvault)')
    .setInputFiles({ name: 'backup.pvault', mimeType: 'application/octet-stream', buffer: bytes });
  await page.getByLabel('Passphrase or recovery code').fill(PASSPHRASE);
  await page.getByRole('button', { name: 'Restore' }).click();
  await expect(page.getByRole('button', { name: 'Lock', exact: true })).toBeVisible();
  expect(await netWorth(page)).toBe(before);
});

test('choose the dark theme, and it stays after a reload', async ({ page }) => {
  await createVault(page);
  await openSettings(page);
  await page.getByRole('radio', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveClass(/\bdark\b/);
  await page.reload();
  await page.getByLabel('Passphrase').fill(PASSPHRASE);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.locator('html')).toHaveClass(/\bdark\b/);
  await openSettings(page);
  await page.getByRole('radio', { name: 'System' }).click();
  await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);
});
