// SPDX-License-Identifier: AGPL-3.0-only
import { expect, type Page, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const ORDERS = join(
  import.meta.dirname,
  '../../../packages/core/src/plugins/importers/groww-mf-orders/fixtures/orders.xlsx',
);

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
  // Nor may a row run into a card's padding, as a button too long to wrap does.
  const squeezed = await page.evaluate(() =>
    [...document.querySelectorAll('[data-slot=card-content]')]
      .filter((c) => {
        const edge = c.getBoundingClientRect().right - parseFloat(getComputedStyle(c).paddingRight);

        return [...c.children].some((k) => k.getBoundingClientRect().right > edge + 1);
      })
      .map((c) => c.textContent?.trim().slice(0, 40)),
  );

  expect(squeezed).toEqual([]);
  const cut = await page.evaluate(() =>
    [...document.querySelectorAll('[data-slot=stat-value]')]
      .filter((s) => s.scrollWidth > s.clientWidth + 1)
      .map((s) => s.textContent),
  );

  expect(cut).toEqual([]);
  // A header's title and description keep the width they need; its buttons wrap below instead.
  const crowded = await page.evaluate(() =>
    [...document.querySelectorAll('main h1')]
      .filter((h) => {
        const title = h.parentElement!;
        const width = title.getBoundingClientRect().width;

        title.style.flex = 'none';
        const needs = Math.min(
          title.getBoundingClientRect().width,
          title.parentElement!.clientWidth,
        );

        title.style.flex = '';

        return width + 1 < needs;
      })
      .map((h) => h.textContent),
  );

  expect(crowded).toEqual([]);
}

test('each main screen fits the width, with the right navigation', async ({ page }, info) => {
  const phone = info.project.name === 'phone';
  const tabs = page.getByRole('navigation', { name: 'Screens' });
  const sidebar = page.getByRole('navigation', { name: 'Sections' });

  await expect(phone ? tabs : sidebar).toBeVisible();
  await expect(phone ? sidebar : tabs).toBeHidden();

  const nav = phone ? tabs : sidebar;

  const screens = phone
    ? ['Home', 'Holdings', 'Insights', 'More']
    : ['Home', 'Holdings', 'Insights', 'Plan', 'Checks', 'Settings'];

  for (const name of screens) {
    await nav.getByRole('link', { name, exact: true }).click();
    await expect(nav.getByRole('link', { name, exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await fitsWidth(page);
  }

  // On phones, Plan and Checks are under More, which stays lit there.
  if (phone) {
    await page.getByRole('main').getByRole('link', { name: /^Plan/ }).click();
    await expect(page.getByRole('heading', { name: 'Plan', exact: true })).toBeVisible();
    await expect(tabs.getByRole('link', { name: 'More', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await fitsWidth(page);
    await tabs.getByRole('link', { name: 'More', exact: true }).click();
    await page
      .getByRole('main')
      .getByRole('link', { name: /^Checks/ })
      .click();
    await expect(page.getByRole('heading', { name: 'Checks', exact: true })).toBeVisible();
    await expect(tabs.getByRole('link', { name: 'More', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await fitsWidth(page);
  }

  // Add isn't a screen: it opens a list of every form, from the header in a panel on phones, and
  // from the sidebar in a menu on desktop.
  if (phone) {
    await page.getByRole('banner').getByRole('button', { name: 'Add', exact: true }).click();
    const panel = page.getByRole('dialog', { name: 'Add' });

    for (const name of ['Import files', 'Transaction', 'Loan', 'Card bill']) {
      await expect(panel.getByRole('link', { name, exact: true })).toBeVisible();
    }

    await fitsWidth(page);
    await panel.getByRole('link', { name: 'Import files' }).click();
    await expect(panel).toBeHidden();
  } else {
    await page.getByRole('complementary').getByRole('button', { name: 'Add' }).click();

    for (const name of ['Import files', 'Transaction', 'Loan', 'Card bill']) {
      await expect(page.getByRole('menuitem', { name, exact: true })).toBeVisible();
    }

    await page.getByRole('menuitem', { name: 'Import files' }).click();
  }

  await expect(page.getByRole('heading', { name: 'Import', exact: true })).toBeVisible();
  await fitsWidth(page);

  // Holdings has its own Add, and a form's back link returns to where it was opened from.
  await nav.getByRole('link', { name: 'Holdings', exact: true }).click();
  await page.getByRole('main').getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Transaction' }).click();
  await expect(page.getByRole('heading', { name: 'Add a transaction' })).toBeVisible();
  await fitsWidth(page);
  await page.getByRole('link', { name: 'Back' }).click();
  await expect(page.getByRole('heading', { name: 'Holdings', exact: true })).toBeVisible();

  await page.getByRole('link', { name: /Flexi Cap/ }).click();
  await expect(page.getByRole('heading', { name: /Flexi Cap/ })).toBeVisible();
  await fitsWidth(page);
});

// A card's bank and due date beside Add a bill are too wide for a narrow phone.
test('a header with a description and a button keeps its title readable', async ({
  page,
}, info) => {
  const phone = info.project.name === 'phone';

  if (phone) {
    await page.setViewportSize({ width: 360, height: 780 });
    await page
      .getByRole('navigation', { name: 'Screens' })
      .getByRole('link', { name: 'More', exact: true })
      .click();
    await page.getByRole('link', { name: /^Cards/ }).click();
  } else {
    await page
      .getByRole('navigation', { name: 'Sections' })
      .getByRole('link', { name: 'Cards' })
      .click();
  }

  await page.getByTestId('card-row').filter({ hasText: 'Shopping card' }).click();
  await expect(page.getByRole('heading', { name: 'Shopping card' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Add a bill' })).toBeVisible();
  await fitsWidth(page);
});

// A grid column as wide as its longest line would widen the page, and phones then push the fixed
// tab bar past the right and bottom edges.
test('a long file name on a narrow phone keeps every screen to the width', async ({
  page,
}, info) => {
  const phone = info.project.name === 'phone';
  const nav = page.getByRole('navigation', { name: phone ? 'Screens' : 'Sections' });

  if (phone) {
    await page.setViewportSize({ width: 360, height: 780 });
  }

  if (phone) {
    await page.getByRole('banner').getByRole('button', { name: 'Add', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Add' })
      .getByRole('link', { name: 'Import files' })
      .click();
  } else {
    await page.getByRole('complementary').getByRole('button', { name: 'Add' }).click();
    await page.getByRole('menuitem', { name: 'Import files' }).click();
  }

  await page.getByTestId('import-input').setInputFiles({
    name: 'Mutual_Funds_Order_History_01-04-2020_27-10-2026_exported_from_Groww_web.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: await readFile(ORDERS),
  });
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Holdings', exact: true })).toBeVisible();
  await fitsWidth(page);

  if (phone) {
    await nav.getByRole('link', { name: 'More', exact: true }).click();
    await page.getByRole('link', { name: /Settings, backup/ }).click();
  } else {
    await nav.getByRole('link', { name: 'Settings', exact: true }).click();
  }

  await expect(page.getByText('History of imports')).toBeVisible();
  await expect(page.getByRole('main').getByText(/exported_from_Groww_web/)).toBeVisible();
  await fitsWidth(page);

  if (phone) {
    const box = (await nav.boundingBox())!;

    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  }
});
