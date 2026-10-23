// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from '@playwright/test';

test('analytics shows allocations, and planning lives on Plan', async ({ page }, info) => {
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
  ]) {
    await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
  }

  await expect(
    page.getByText('No identified stocks in this selection. Fund disclosures may be missing.'),
  ).toBeVisible();

  for (const title of ['Allocation planner', 'Access to your money', 'Maturity ladder']) {
    await expect(page.getByText(title, { exact: true })).toHaveCount(0);
  }

  await expect(page.getByRole('link', { name: 'Plan', exact: true }).first()).toBeAttached();
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
