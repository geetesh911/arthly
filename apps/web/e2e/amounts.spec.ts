// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from '@playwright/test';

test('the eye hides amounts on every screen, keeps percentages, and remembers', async ({
  page,
}) => {
  await page.route(/github\.io|frankfurter|\/api\/prices\//, (route) => route.abort());
  await page.goto('/');
  await page.getByRole('button', { name: 'Try with sample data' }).click();

  const eye = page.getByRole('button', { name: 'Hide amounts' });
  const netWorth = page.getByTestId('net-worth');

  await expect(netWorth).toHaveText(/^₹[\d,]+$/);
  await expect(eye).toHaveAttribute('aria-pressed', 'false');
  await eye.click();
  await expect(eye).toHaveAttribute('aria-pressed', 'true');
  await expect(netWorth).toHaveText('₹••••');
  await expect(page.getByTestId('gain')).toHaveText('+₹••••');
  await expect(page.getByRole('region', { name: 'Net worth' })).toContainText(/\(\d+(\.\d)?%\)/);

  // Holdings has its own eye, in the summary card, and the same setting.
  await page
    .getByRole('link', { name: 'Holdings', exact: true })
    .filter({ visible: true })
    .first()
    .click();
  await expect(page.getByTestId('holdings-value')).toHaveText('₹••••');
  await expect(eye).toHaveAttribute('aria-pressed', 'true');

  // Still hidden after the app reopens.
  await page.reload();
  await page.getByRole('button', { name: 'Try with sample data' }).click();
  const value = page.getByTestId('holdings-value');

  await expect(value).toHaveText('₹••••');
  await eye.click();
  await expect(value).toHaveText(/^₹[\d,]+$/);
});
