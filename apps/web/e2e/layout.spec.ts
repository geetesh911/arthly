// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route(/github\.io|frankfurter|\/api\/prices\//, (route) => route.abort());
  await page.goto('/');
  await page.getByRole('button', { name: 'Try with sample data' }).click();
  await expect(page.getByTestId('net-worth')).toBeVisible();
});

async function fitsWidth(page: Page) {
  const [scroll, width] = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    window.innerWidth,
  ]);
  expect(scroll).toBeLessThanOrEqual(width);
  // Cards clip their content, so a too-wide row would hide numbers without widening the page.
  const clipped = await page.evaluate(() =>
    [...document.querySelectorAll('[data-slot=card]')]
      .filter((c) => c.scrollWidth > c.clientWidth + 1)
      .map((c) => c.textContent?.trim().slice(0, 40)),
  );
  expect(clipped).toEqual([]);
  const cut = await page.evaluate(() =>
    [...document.querySelectorAll('[data-slot=stat-value]')]
      .filter((s) => s.scrollWidth > s.clientWidth + 1)
      .map((s) => s.textContent),
  );
  expect(cut).toEqual([]);
}

test('each main screen fits the width, with the right navigation', async ({ page }, info) => {
  const phone = info.project.name === 'phone';
  const tabs = page.getByRole('navigation', { name: 'Screens' });
  const sidebar = page.getByRole('navigation', { name: 'Sections' });
  await expect(phone ? tabs : sidebar).toBeVisible();
  await expect(phone ? sidebar : tabs).toBeHidden();

  const nav = phone ? tabs : sidebar;
  for (const name of ['Home', 'Holdings', 'Add', 'Checks', phone ? 'More' : 'Settings']) {
    await nav.getByRole('link', { name, exact: true }).click();
    await expect(nav.getByRole('link', { name, exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await fitsWidth(page);
  }

  await nav.getByRole('link', { name: 'Holdings', exact: true }).click();
  await page.getByRole('link', { name: /Flexi Cap/ }).click();
  await expect(page.getByRole('heading', { name: /Flexi Cap/ })).toBeVisible();
  await fitsWidth(page);
});
