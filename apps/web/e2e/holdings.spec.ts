// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from '@playwright/test';

test('tapping the figures’ name moves through current, returns, XIRR and share', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'phone', 'Wide screens show every figure in its own column.');
  await page.route(/github\.io|frankfurter|\/api\/prices\//, (route) => route.abort());
  await page.goto('/');
  await page.getByRole('button', { name: 'Try with sample data' }).click();
  await page
    .getByRole('navigation', { name: 'Screens' })
    .getByRole('link', { name: 'Holdings', exact: true })
    .click();

  const fund = page.getByRole('link', { name: /Sample Flexi Cap/ });
  // Each row also holds the wide screen's columns, hidden here.
  const shows = (text: string) => fund.getByText(text, { exact: true }).filter({ visible: true });
  const next = page.getByRole('button', { name: /^Showing/ });

  for (const [label, figure] of [
    ['Current (Invested)', '₹1,50,000'],
    ['Returns (%)', '+₹31,068'],
    ['XIRR', '15.22%'],
    ['Share (Current)', '19.6%'],
  ] as const) {
    await expect(next).toContainText(label);
    await expect(shows(figure)).toHaveCount(1);
    await next.click();
  }

  // And round again.
  await expect(next).toContainText('Current (Invested)');
});
