// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from '@playwright/test';

test('analytics shows scoped allocations and validates a saved planning scenario', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route(/github\.io|frankfurter|\/api\/prices\//, (route) => route.abort());
  await page.goto('/');
  await page.getByRole('button', { name: 'Try with sample data' }).click();
  await expect(page.getByTestId('net-worth')).toBeVisible();
  await page.getByRole('link', { name: 'Explore analytics' }).click();
  await expect(page.getByRole('heading', { name: 'Analytics', exact: true })).toBeVisible();
  for (const title of [
    'Asset split',
    'Sector allocation',
    'Market cap split',
    'Active / passive split',
    'Stock concentration',
    'Allocation planner',
  ]) {
    await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
  }
  await expect(
    page.getByText('No identified stocks in this selection. Fund disclosures may be missing.'),
  ).toBeVisible();
  const equity = page.getByRole('spinbutton', { name: 'Equity target %' });
  await equity.fill('101');
  await expect(page.getByRole('button', { name: 'Save targets' })).toBeDisabled();
  await expect(page.getByText('Targets must total 100%')).toBeVisible();
  for (const asset of ['Equity', 'Debt', 'Hybrid', 'Gold', 'Silver', 'Cash', 'Other']) {
    await page
      .getByRole('spinbutton', { name: `${asset} target %` })
      .fill(asset === 'Equity' ? '60' : asset === 'Debt' ? '40' : '0');
  }
  await page.getByRole('spinbutton', { name: 'New contribution' }).fill('10000');
  await page.getByRole('button', { name: 'Save targets' }).click();
  await expect(page.getByText('Targets saved for this selection.')).toBeVisible();
  // Member-specific targets do not overwrite the family scenario.
  const member = page.getByRole('combobox', { name: 'Member', exact: true });
  await member.selectOption('mem_demo1');
  await expect(page.getByRole('spinbutton', { name: 'Debt target %' })).toHaveValue('0');
  await member.selectOption({ label: 'Everyone' });
  await expect(equity).toHaveValue('60');
  await expect(page).toHaveTitle(/Arthly/);
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
  await page.getByRole('heading', { name: 'Analytics', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `/tmp/arthly-analytics-${info.project.name}.png` });
});
