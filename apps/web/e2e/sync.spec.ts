// SPDX-License-Identifier: AGPL-3.0-only
import {
  type Browser,
  type BrowserContext,
  expect,
  type Page,
  test,
  type TestInfo,
} from '@playwright/test';

import {
  type FakeGoogle,
  fakeGoogle,
} from '../../../packages/core/src/plugins/storage/google-drive/fake-google.ts';
import { googleToken } from '../../../packages/core/src/plugins/storage/google-drive/token-server.ts';

const PASSPHRASE = 'correct horse battery staple';

// The service worker would answer the app's own files itself; without it every request is routed.
test.use({ serviceWorkers: 'block' });

/** No prices; Google's sign-in page, the app's token function and the Drive API are one fake. */
async function fakeCloud(context: BrowserContext, google: FakeGoogle) {
  await context.route(/github\.io|frankfurter|\/api\/prices\//, (route) => route.abort());
  await context.route('**/api/google/*', async (route) => {
    const r = route.request();
    const res = await googleToken(
      new URL(r.url()).pathname.split('/').at(-1)!,
      new Request(r.url(), {
        method: r.method(),
        headers: await r.allHeaders(),
        ...(r.method() === 'POST' ? { body: r.postData() } : {}),
      }),
      { fetch: google.fetch, clientId: google.clientId, clientSecret: google.clientSecret },
    );

    await route.fulfill({
      status: res.status,
      contentType: 'application/json',
      body: await res.text(),
    });
  });
  await context.route('https://accounts.google.com/**', (route) =>
    route.fulfill({ status: 302, headers: { location: google.authorize(route.request().url()) } }),
  );
  await context.route('https://www.googleapis.com/**', async (route) => {
    const r = route.request();
    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'authorization, content-type',
      'access-control-allow-methods': 'GET, POST, PATCH, DELETE',
    };

    if (r.method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: cors });
    }

    const body = r.postDataBuffer();
    const res = await google.fetch(r.url(), {
      method: r.method(),
      headers: await r.allHeaders(),
      ...(body ? { body: new Uint8Array(body) } : {}),
    });

    await route.fulfill({
      status: res.status,
      headers: { ...Object.fromEntries(res.headers), ...cors },
      body: Buffer.from(await res.arrayBuffer()),
    });
  });
}

async function createVault(page: Page) {
  await page.goto('/');
  await page.getByLabel('Name of this portfolio').fill('Family');
  await page.getByLabel(/Your name/).fill('Asha');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel('Passphrase (at least 10 characters)').fill(PASSPHRASE);
  await page.getByLabel('Type it again').fill(PASSPHRASE);
  await page.getByRole('button', { name: 'Create' }).click();
  const code = (await page.getByTestId('recovery-code').textContent())!.trim();

  await page.getByLabel(/Type the code/).fill(code);
  await page.getByRole('button', { name: "I've saved it" }).click();
  await page.getByRole('button', { name: /Not now|Continue/ }).click();
  await expect(page.getByRole('heading', { name: 'Import', exact: true })).toBeVisible();
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
    await direct.click();
  } else {
    await more.click();
    await page.getByRole('link', { name: /Settings, backup/ }).click();
  }

  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
}

const syncCard = (page: Page) =>
  page.locator('[data-slot=card]').filter({ has: page.getByText('Cloud sync', { exact: true }) });

/**
 * A second device with the same Google account. It's an installed app, so it goes to Google and
 * back in the same window.
 */
async function installedApp(
  browser: Browser,
  info: TestInfo,
  google: FakeGoogle,
  errors: string[],
): Promise<{ context: BrowserContext; page: Page }> {
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = info.project.use;
  const context = await browser.newContext({
    baseURL: 'http://localhost:4180',
    serviceWorkers: 'block',
    ...(viewport ? { viewport } : {}),
    ...(userAgent ? { userAgent } : {}),
    ...(deviceScaleFactor ? { deviceScaleFactor } : {}),
    ...(isMobile ? { isMobile } : {}),
    ...(hasTouch ? { hasTouch } : {}),
  });

  await context.addInitScript(() => {
    const real = window.matchMedia.bind(window);

    window.matchMedia = (query: string) =>
      query === '(display-mode: standalone)'
        ? ({ matches: true, media: query } as MediaQueryList)
        : real(query);
  });
  await fakeCloud(context, google);
  const page = await context.newPage();

  page.on('pageerror', (error) => errors.push(error.message));

  return { context, page };
}

async function fitsWidth(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
}

test('syncs a portfolio through Google Drive to a second device and back', async ({
  page,
  context,
  browser,
}, info) => {
  const google = fakeGoogle();
  const errors: string[] = [];

  page.on('pageerror', (error) => errors.push(error.message));
  await fakeCloud(context, google);
  await createVault(page);
  await openSettings(page);

  // The laptop connects through Google's popup.
  const card = syncCard(page);
  const popup = page.waitForEvent('popup');

  await card.getByRole('button', { name: 'Connect Google Drive' }).click();
  await (await popup).waitForEvent('close');
  await expect(card.getByTestId('sync-status')).toContainText('Google Drive · asha@example.com');
  await expect(card.getByTestId('sync-status')).toContainText('Last synced');
  await fitsWidth(page);

  const { context: phoneContext, page: phone } = await installedApp(browser, info, google, errors);

  await phone.goto('/');
  await phone.getByRole('button', { name: 'Open from Google Drive' }).click();
  await phone.getByRole('button', { name: 'Sign in with Google' }).click();
  await phone.getByLabel('Passphrase or recovery code').fill('not the passphrase');
  await phone.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(phone.getByRole('status')).toBeVisible();
  await phone.getByLabel('Passphrase or recovery code').fill(PASSPHRASE);
  await phone.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(phone.getByText('Welcome', { exact: true })).toBeVisible();
  await openSettings(phone);
  const members = (p: Page) => p.getByRole('list', { name: 'Members' });

  await expect(members(phone)).toContainText('Asha');
  await expect(syncCard(phone).getByTestId('sync-status')).toContainText('Last synced');
  await fitsWidth(phone);

  // A change on the phone reaches the laptop.
  await phone.getByLabel('New member').fill('Ravi');
  await phone.getByLabel('New member').press('Enter');
  await expect(members(phone)).toContainText('Ravi');
  await syncCard(phone).getByRole('button', { name: 'Sync now' }).click();
  await expect(async () => {
    await card.getByRole('button', { name: 'Sync now' }).click();
    await expect(members(page)).toContainText('Ravi', { timeout: 2000 });
  }).toPass();

  const folder = [...google.files.values()].find((f) => f.name.startsWith('vault_'))!;

  expect([...google.folder(folder.id).keys()].filter((k) => k.startsWith('log/'))).toHaveLength(2);
  expect(errors).toEqual([]);
  await phoneContext.close();
});

test('links a new device with the code it shows, without the passphrase', async ({
  page,
  context,
  browser,
}, info) => {
  const google = fakeGoogle();
  const errors: string[] = [];

  page.on('pageerror', (error) => errors.push(error.message));
  await fakeCloud(context, google);
  await createVault(page);
  await openSettings(page);
  const card = syncCard(page);
  const popup = page.waitForEvent('popup');

  await card.getByRole('button', { name: 'Connect Google Drive' }).click();
  await (await popup).waitForEvent('close');
  await expect(card.getByTestId('sync-status')).toContainText('Last synced');

  // The new device signs in to Google and shows a code.
  const { context: phoneContext, page: phone } = await installedApp(browser, info, google, errors);

  await phone.goto('/');
  await phone.getByRole('button', { name: 'Link with another device' }).click();
  await phone.getByRole('button', { name: 'Sign in with Google' }).click();
  await expect(phone.getByRole('img', { name: 'QR code to link this device' })).toBeVisible();
  await expect(phone.getByText(/^Signed in to Google as asha@example\.com\./)).toBeVisible();
  await expect(phone.getByText(/unlocks like any other/)).toBeVisible();
  const code = (await phone.getByTestId('link-code').textContent())!.trim();

  expect(code).toMatch(/^([A-Z2-7]{4}-){3}[A-Z2-7]{4}$/);
  await fitsWidth(phone);

  // The laptop has no camera here, so it types the code.
  await card.getByRole('button', { name: 'Link a device' }).click();
  await card.getByRole('textbox', { name: /^(Or type the )?code$/i }).fill(code.toLowerCase());
  await card.getByRole('button', { name: 'Link', exact: true }).click();
  const confirm = page.getByRole('alertdialog');

  await expect(confirm).toContainText(/^Link .+ on .+\?/);
  await expect(confirm).toContainText('It will open Family');
  await confirm.getByRole('button', { name: 'Link', exact: true }).click();
  await expect(page.getByText(/^Linked\. Family is opening on/)).toBeVisible();

  // Prices are offline here, so their message may take the message line before "Linked" shows.
  await expect(phone.getByText('Welcome', { exact: true })).toBeVisible();
  await openSettings(phone);
  await expect(phone.getByRole('list', { name: 'Members' })).toContainText('Asha');
  await expect(syncCard(phone).getByTestId('sync-status')).toContainText('Last synced');
  expect([...google.files.values()].filter((f) => f.name.startsWith('link-'))).toEqual([]);
  expect(errors).toEqual([]);
  await phoneContext.close();
});

test('opens a portfolio in one tab at a time', async ({ page, context }) => {
  await context.route(/github\.io|frankfurter|\/api\/prices\//, (route) => route.abort());
  await createVault(page);
  const other = await context.newPage();

  await other.goto('/');
  await other.getByLabel('Passphrase', { exact: true }).fill(PASSPHRASE);
  await other.getByRole('button', { name: 'Unlock' }).click();
  await expect(
    other.getByText('This portfolio is open in another tab. It will lock there.'),
  ).toBeVisible();
  await other.getByRole('button', { name: 'Open here' }).click();
  await expect(other.getByText('Welcome', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Unlock' })).toBeVisible();
  await expect(
    page.getByText('The portfolio was opened in another tab, so it locked here.'),
  ).toBeVisible();
});
