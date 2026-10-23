// SPDX-License-Identifier: AGPL-3.0-only
import { expect, type Page, test } from '@playwright/test';

const rupees = async (page: Page, testid: string) =>
  Number((await page.getByTestId(testid).textContent())!.replace(/[^\d-]/g, ''));

test('plan sets targets, splits new money and checks the emergency fund', async ({
  page,
}, info) => {
  const errors: string[] = [];

  page.on('pageerror', (error) => errors.push(error.message));
  await page.route(/github\.io|frankfurter|\/api\/prices\//, (route) => route.abort());
  await page.goto('/');
  await page.getByRole('button', { name: 'Try with sample data' }).click();
  await expect(page.getByTestId('net-worth')).toBeVisible();

  if (info.project.name === 'phone') {
    await page
      .getByRole('navigation', { name: 'Screens' })
      .getByRole('link', { name: 'More' })
      .click();
    await page.getByRole('link', { name: /^Plan/ }).click();
  } else {
    await page
      .getByRole('navigation', { name: 'Sections' })
      .getByRole('link', { name: 'Plan', exact: true })
      .click();
  }

  await expect(page.getByRole('heading', { name: 'Plan', exact: true })).toBeVisible();

  for (const title of [
    'Allocation planner',
    'Emergency fund',
    'Access to your money',
    'Maturity ladder',
  ]) {
    await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
  }

  const equity = page.getByRole('spinbutton', { name: 'Equity target %' });

  await equity.fill('101');
  await expect(page.getByRole('button', { name: 'Save plan' })).toBeDisabled();
  await expect(page.getByText('Targets must total 100%')).toBeVisible();

  // The sample has no hybrid funds, and hybrid funds are split anyway, so there's no Hybrid row.
  await expect(page.getByRole('spinbutton', { name: 'Hybrid target %' })).toHaveCount(0);

  for (const asset of ['Equity', 'Debt', 'Gold', 'Silver', 'Cash', 'Other']) {
    await page
      .getByRole('spinbutton', { name: `${asset} target %` })
      .fill(asset === 'Equity' ? '60' : asset === 'Debt' ? '40' : '0');
  }

  // New money only: the whole amount goes to classes with a target, none to gold.
  await page.getByRole('spinbutton', { name: 'Amount to invest' }).fill('10000');
  await expect(page.getByTestId('move-gold')).toContainText('₹0');
  expect((await rupees(page, 'move-equity')) + (await rupees(page, 'move-debt'))).toBeCloseTo(
    10_000,
    -1,
  );

  // A band of 0 flags any drift; the sample's gold is 0% of target, so something drifts.
  const band = page.getByRole('spinbutton', { name: 'Drift band' });

  await band.fill('0');
  await expect(page.getByTestId('drift-summary')).toContainText('more than 0 points off target');
  await expect(page.getByTestId('drift-gold')).toContainText('outside the band');
  await band.fill('100');
  await expect(page.getByText('a drift band from 0 to 50')).toBeVisible();
  await band.fill('5');

  // Buy and sell shows the full gap: gold has no target, so all of it is above target.
  await page.getByRole('radio', { name: 'Buy and sell' }).click();
  await expect(page.getByTestId('move-gold')).toContainText('-₹');
  await page.getByRole('button', { name: 'Save plan' }).click();
  await expect(page.getByText('Plan saved for this selection.')).toBeVisible();

  // Member plans don't overwrite the family's.
  const member = page.getByRole('combobox', { name: 'Member', exact: true });

  await member.selectOption('mem_demo1');
  await expect(page.getByRole('spinbutton', { name: 'Debt target %' })).toHaveValue('0');
  await expect(page.getByRole('radio', { name: 'New money only' })).toBeChecked();
  await member.selectOption({ label: 'Everyone' });
  await expect(equity).toHaveValue('60');
  await expect(page.getByRole('spinbutton', { name: 'Amount to invest' })).toHaveValue('10000');
  await expect(page.getByRole('radio', { name: 'Buy and sell' })).toBeChecked();

  // The sample's FD is its only emergency money.
  const fund = page
    .locator('[data-slot=card]')
    .filter({ has: page.getByText('Emergency fund', { exact: true }) });

  await expect(fund.getByText('Enter your monthly expenses')).toBeVisible();
  await fund.getByRole('spinbutton', { name: 'Monthly expenses (₹)' }).fill('100000');
  await expect(page.getByTestId('emergency-months')).toContainText('of 6 you want');
  await expect(fund.getByText(/^Short by/)).toBeVisible();
  await fund.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(fund.getByText('Saved for this selection.')).toBeVisible();
  await expect(page.getByText(/Your emergency fund is short by/)).toBeVisible();

  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const clipped = await page.evaluate(() =>
    [...document.querySelectorAll('[data-slot=card]')]
      .filter((c) => c.scrollWidth > c.clientWidth + 1)
      .map((c) => c.textContent?.slice(0, 50)),
  );

  expect(clipped).toEqual([]);
  await page.getByRole('heading', { name: 'Plan', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `/tmp/arthly-plan-${info.project.name}.png`, fullPage: true });
});
