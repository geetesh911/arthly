// SPDX-License-Identifier: AGPL-3.0-only
import { expect, type Page, test } from '@playwright/test';

const PASSPHRASE = 'correct horse battery staple';

test.beforeEach(async ({ page }) => {
  // No price relay or feed in tests.
  await page.route(/github\.io|frankfurter|\/api\/prices\//, (route) => route.abort());
});

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

// Desktop has Loans in the sidebar; phones reach it through More.
async function openLoans(page: Page) {
  const direct = page.getByRole('navigation', { name: 'Sections' }).getByRole('link', {
    name: 'Loans',
  });
  const more = page.getByRole('navigation', { name: 'Screens' }).getByRole('link', {
    name: 'More',
  });

  await expect(direct.or(more)).toBeVisible();

  if (await direct.isVisible()) {
    await direct.click();
  } else {
    await more.click();
    await page.getByRole('link', { name: /^Loans/ }).click();
  }

  await expect(page.getByRole('heading', { name: 'Loans', exact: true })).toBeVisible();
}

async function openLoan(page: Page, party: string) {
  await openLoans(page);
  await page.getByTestId('loan-row').filter({ hasText: party }).click();
  await expect(page.getByRole('heading', { name: party })).toBeVisible();
}

async function netWorth(page: Page) {
  await page.getByRole('link', { name: 'Home', exact: true }).click();

  return (await page.getByTestId('net-worth').textContent())!.trim();
}

async function fitsWidth(page: Page) {
  const [scroll, width] = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    window.innerWidth,
  ]);

  expect(scroll).toBeLessThanOrEqual(width);
}

test('lend, get part of it back, settle, then borrow, with net worth after each', async ({
  page,
}) => {
  await createVault(page);
  await openAdd(page, 'Loan');
  await expect(page.getByRole('heading', { name: 'Add a loan' })).toBeVisible();
  await page.getByLabel('Who owes you?').fill('Sample friend');
  await page.getByLabel('Amount (₹)').fill('50,000');
  await page.getByLabel('Lent on').fill('2026-09-01');
  await fitsWidth(page);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: 'Sample friend' })).toBeVisible();
  await expect(page.getByTestId('loan-balance')).toHaveText('₹50,000');
  expect(await netWorth(page)).toBe('₹50,000');
  await expect(page.getByTestId('net-worth-parts')).toContainText(
    'Investments ₹0 · owed to you ₹50,000',
  );

  // A part repayment.
  await openLoan(page, 'Sample friend');
  await page.getByLabel('Amount (₹)').fill('20000');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('loan-balance')).toHaveText('₹30,000');
  await expect(page.getByTestId('loan-entry')).toHaveCount(2);
  await fitsWidth(page);
  expect(await netWorth(page)).toBe('₹30,000');

  // Settled in full: it no longer counts.
  await openLoan(page, 'Sample friend');
  await page.getByRole('button', { name: 'Settle in full' }).click();
  await page.getByRole('button', { name: 'Settle', exact: true }).click();
  await expect(page.getByTestId('loan-balance')).toHaveText('₹0');
  await expect(page.getByTestId('loan-entry')).toHaveCount(3);
  expect(await netWorth(page)).toBe('₹0');
  await openLoans(page);
  await expect(page.getByText('Paid back or written off. They no longer count.')).toBeVisible();

  // Money you owe comes off net worth.
  await page.getByRole('link', { name: 'Add a loan' }).click();
  await page.getByLabel('Which way?').selectOption('borrowed');
  await page.getByLabel('Who do you owe?').fill('Sample relative');
  await page.getByLabel('Amount (₹)').fill('10000');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('loan-balance')).toHaveText('₹10,000');
  expect(await netWorth(page)).toBe('-₹10,000');
  await openLoans(page);
  await expect(page.getByTestId('you-owe')).toHaveText('₹10,000');
  await expect(page.getByTestId('owed-to-you')).toHaveText('₹0');
  await fitsWidth(page);
});

test('sample data counts loans in net worth and what you are owed in analytics', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try with sample data' }).click();
  const parts = page.getByTestId('net-worth-parts');

  await expect(parts).toContainText('owed to you ₹25,000');
  await expect(parts).toContainText('you owe ₹75,000');
  await page.getByRole('link', { name: 'Explore analytics' }).click();

  for (const title of ['Asset split', 'Access to your money']) {
    const card = page
      .locator('[data-slot=card]')
      .filter({ has: page.getByText(title, { exact: true }) });

    await expect(card.getByText('Owed to you', { exact: true }).first()).toBeVisible();
  }

  await expect(page.getByText(/The ₹75,000 you owe isn’t charted/)).toBeVisible();
  await openLoans(page);
  await expect(page.getByTestId('loan-row')).toHaveCount(2);
  await fitsWidth(page);
});
