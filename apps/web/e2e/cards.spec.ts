// SPDX-License-Identifier: AGPL-3.0-only
import { expect, type Page, test } from '@playwright/test';

const PASSPHRASE = 'correct horse battery staple';

test.beforeEach(async ({ page }) => {
  // No price relay or feed in tests.
  await page.route(/github\.io|frankfurter|\/api\/prices\//, (route) => route.abort());
});

/** A date this many days from today, as the date inputs take it. */
function day(offset: number) {
  const d = new Date();

  d.setDate(d.getDate() + offset);

  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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

// Add opens a menu from the sidebar on desktop, and a panel from the tab bar on phones.
async function openAdd(page: Page, name: string) {
  const sidebar = page.getByRole('complementary').getByRole('button', { name: 'Add' });
  const tab = page.getByRole('navigation', { name: 'Screens' }).getByRole('button', {
    name: 'Add',
  });

  await expect(sidebar.or(tab)).toBeVisible();
  await ((await sidebar.isVisible()) ? sidebar : tab).click();
  await page
    .getByRole('menuitem', { name, exact: true })
    .or(page.getByRole('dialog').getByRole('link', { name, exact: true }))
    .click();
}

// Desktop has Cards in the sidebar; phones reach it through More.
async function openCards(page: Page) {
  const direct = page.getByRole('navigation', { name: 'Sections' }).getByRole('link', {
    name: 'Cards',
  });
  const more = page.getByRole('navigation', { name: 'Screens' }).getByRole('link', {
    name: 'More',
  });

  await expect(direct.or(more)).toBeVisible();

  if (await direct.isVisible()) {
    await direct.click();
  } else {
    await more.click();
    await page.getByRole('link', { name: /^Cards/ }).click();
  }

  await expect(page.getByRole('heading', { name: 'Cards', exact: true })).toBeVisible();
}

async function openCard(page: Page, name: string) {
  await openCards(page);
  await page.getByTestId('card-row').filter({ hasText: name }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
}

async function home(page: Page) {
  await page.getByRole('link', { name: 'Home', exact: true }).click();
  await expect(page.getByTestId('net-worth')).toBeVisible();
}

async function fitsWidth(page: Page) {
  const [scroll, width] = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    window.innerWidth,
  ]);

  expect(scroll).toBeLessThanOrEqual(width);
}

test('add a card and its bill, pay the minimum, then the next bill in full, and close it', async ({
  page,
}) => {
  await createVault(page);

  // Add → Card bill asks for the card first.
  await openAdd(page, 'Card bill');
  await expect(page.getByRole('heading', { name: 'Add a bill' })).toBeVisible();
  await page.getByRole('link', { name: 'Add a card' }).click();
  await expect(page.getByRole('heading', { name: 'Add a card' })).toBeVisible();
  await page.getByLabel('Bank', { exact: true }).fill('Sample Bank');
  await page.getByLabel('Name', { exact: true }).fill('Travel card');
  await page.getByLabel('Credit limit (₹, optional)').fill('1,00,000');
  await page.getByLabel('Bill amount (₹)').fill('12,000');
  await page.getByLabel('Minimum due (₹)').fill('600');
  await page.getByLabel('Statement date').fill(day(-40));
  await page.getByLabel('Due date').fill(day(-20));
  await fitsWidth(page);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: 'Travel card' })).toBeVisible();
  await expect(page.getByTestId('card-due')).toHaveText('₹12,000');
  await expect(page.getByTestId('card-status').locator('..')).toContainText('Overdue');

  // Pay the minimum, after the statement date.
  await page.getByRole('radio', { name: 'Pay minimum' }).click();
  await expect(page.getByLabel('Amount (₹)')).toHaveValue('600');
  await page.getByLabel('Paid on').fill(day(-30));
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('card-due')).toHaveText('₹11,400');
  await expect(page.getByTestId('card-payment')).toHaveCount(1);
  await fitsWidth(page);

  // Home takes it off net worth and keeps the missed bill in Coming up.
  await home(page);
  await expect(page.getByTestId('net-worth')).toHaveText('-₹11,400');
  await expect(page.getByTestId('net-worth-parts')).toContainText(
    'Investments ₹0 · card dues ₹11,400',
  );
  const upcoming = page.getByRole('listitem').filter({ hasText: 'Sample Bank Travel card' });

  await expect(upcoming).toContainText('Overdue');
  await expect(upcoming).toContainText('₹11,400');

  // The next bill replaces what was left.
  await openCard(page, 'Travel card');
  await page.getByRole('link', { name: 'Add a bill' }).first().click();
  await expect(page.getByRole('heading', { name: 'Add a bill' })).toBeVisible();
  await page.getByLabel('Bill amount (₹)').fill('13000');
  await page.getByLabel('Minimum due (₹)').fill('650');
  await page.getByLabel('Statement date').fill(day(-10));
  await page.getByLabel('Due date').fill(day(10));
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: 'Travel card' })).toBeVisible();
  await expect(page.getByTestId('card-due')).toHaveText('₹13,000');
  await expect(page.getByTestId('card-bill')).toHaveCount(2);
  await home(page);
  await expect(page.getByTestId('net-worth')).toHaveText('-₹13,000');
  await expect(upcoming).not.toContainText('Overdue');
  await expect(upcoming).toContainText('₹13,000');

  // Pay in full, today.
  await openCard(page, 'Travel card');
  await page.getByRole('radio', { name: 'Pay in full' }).click();
  await expect(page.getByLabel('Amount (₹)')).toHaveValue('13000');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('card-due')).toHaveText('₹0');
  await expect(page.getByTestId('card-status').locator('..')).toContainText('Paid');
  await home(page);
  await expect(page.getByTestId('net-worth')).toHaveText('₹0');
  await expect(upcoming).toHaveCount(0);

  // Closed: it leaves the list and keeps its history.
  await openCard(page, 'Travel card');
  await page.getByRole('button', { name: 'Close card' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Close card' }).click();
  await expect(page.getByRole('button', { name: 'Reopen card' })).toBeVisible();
  await openCards(page);
  await expect(page.getByText('Cards you no longer use. Their history stays.')).toBeVisible();
  await expect(page.getByText('All your cards are closed.')).toBeVisible();
  await fitsWidth(page);
});

test('sample data takes card dues off net worth', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try with sample data' }).click();

  await expect(page.getByTestId('net-worth-parts')).toContainText('card dues ₹9,310');
  await openCards(page);
  await expect(page.getByTestId('card-row')).toHaveCount(2);
  await expect(page.getByTestId('card-dues')).toHaveText('₹9,310');
  await fitsWidth(page);
});
