// SPDX-License-Identifier: AGPL-3.0-only
// Ways into screens that keep detail out of the way: Insights' rows, Home's net worth panel and
// More on phones.
import type { Locator, Page } from '@playwright/test';

/** Opens a row under More breakdowns on Insights, and gives its section. */
export async function breakdown(page: Page, title: string): Promise<Locator> {
  const more = page.getByRole('button', { name: 'More breakdowns' });

  if ((await more.getAttribute('aria-expanded')) !== 'true') {
    await more.click();
  }

  const row = page.getByRole('button', { name: title, exact: true });

  if ((await row.getAttribute('aria-expanded')) !== 'true') {
    await row.click();
  }

  return page.getByRole('region', { name: title, exact: true });
}

/** Opens Home's net worth panel, and gives the row for one part of it. */
export async function netWorthPart(page: Page, label: string): Promise<Locator> {
  const parts = page.getByTestId('net-worth-parts');

  if (!(await parts.isVisible())) {
    await page.getByRole('button', { name: /^Net worth/ }).click();
  }

  return parts.getByRole('listitem').filter({ hasText: label });
}

/** Lock is in the sidebar on desktop, and on More on phones. */
export async function lock(page: Page): Promise<void> {
  const tabs = page.getByRole('navigation', { name: 'Screens' });

  if (await tabs.isVisible()) {
    await tabs.getByRole('link', { name: 'More', exact: true }).click();
  }

  await page.getByRole('button', { name: 'Lock', exact: true }).click();
}

/** The app's navigation, there only once it's unlocked. */
export const unlocked = (page: Page) =>
  page
    .getByRole('navigation', { name: 'Screens' })
    .or(page.getByRole('navigation', { name: 'Sections' }));

/** Plan is in the sidebar on desktop, and on More on phones. */
export async function openPlan(page: Page): Promise<void> {
  const tabs = page.getByRole('navigation', { name: 'Screens' });

  if (await tabs.isVisible()) {
    await tabs.getByRole('link', { name: 'More', exact: true }).click();
    await page.getByRole('main').getByRole('link', { name: /^Plan/ }).click();
  } else {
    await page
      .getByRole('navigation', { name: 'Sections' })
      .getByRole('link', { name: 'Plan', exact: true })
      .click();
  }
}
