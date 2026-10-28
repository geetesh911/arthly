// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from '@playwright/test';

import { breakdown } from './screens.ts';

test('insights shows allocations, and planning lives on Plan', async ({ page }, info) => {
  const errors: string[] = [];

  page.on('pageerror', (error) => errors.push(error.message));
  await page.route(/github\.io|frankfurter|\/api\/prices\//, (route) => route.abort());
  await page.goto('/');
  await page.getByRole('button', { name: 'Try with sample data' }).click();
  await expect(page.getByTestId('net-worth')).toBeVisible();
  await page.getByRole('link', { name: 'Your mix, see Insights' }).click();
  await expect(page.getByRole('heading', { name: 'Insights', exact: true })).toBeVisible();
  await expect(page.getByText('Most of your money is in debt.')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Sectors and market cap' })).toContainText(
    'Not available yet',
  );

  for (const title of [
    'Asset split',
    'Sector allocation',
    'Market cap split',
    'Active / passive split',
  ]) {
    await expect(await breakdown(page, title)).toBeVisible();
  }

  await expect(
    (await breakdown(page, 'Stock concentration')).getByText(
      'No identified stocks in this selection. Fund disclosures may be missing.',
    ),
  ).toBeVisible();

  for (const title of ['Allocation planner', 'Access to your money', 'Maturity ladder']) {
    await expect(page.getByText(title, { exact: true })).toHaveCount(0);
  }

  await expect(page.getByRole('link', { name: 'Set targets' })).toHaveAttribute('href', '#/plan');
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
  await page.getByRole('heading', { name: 'Insights', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `/tmp/arthly-insights-${info.project.name}.png` });
});
