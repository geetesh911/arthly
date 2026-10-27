// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from '@playwright/test';

test('tools list the bond calculator, which matches SEBI and compares with an FD', async ({
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
    await page.getByRole('link', { name: /^Tools/ }).click();
  } else {
    await page
      .getByRole('navigation', { name: 'Sections' })
      .getByRole('link', { name: 'Tools', exact: true })
      .click();
  }

  await expect(page.getByRole('heading', { name: 'Tools', exact: true })).toBeVisible();
  await page.getByRole('link', { name: /^Bond or FD/ }).click();
  await expect(page.getByRole('heading', { name: 'Bond or FD', exact: true })).toBeVisible();

  // SEBI's calculator gives 8.421% and 9.295% for these.
  await page.getByRole('spinbutton', { name: 'Current price (₹)' }).fill('950');
  await page.getByRole('spinbutton', { name: 'Par value (₹)' }).fill('1000');
  await page.getByRole('spinbutton', { name: 'Coupon rate (%)' }).fill('8');
  await page.getByRole('spinbutton', { name: 'Years to maturity' }).fill('5');
  await expect(page.getByTestId('current-yield')).toHaveText('8.42%');
  await expect(page.getByTestId('ytm')).toHaveText('9.30%');
  // A whole number of years is a coupon date: nothing accrued, and the yield is SEBI's.
  await expect(page.getByTestId('accrued')).toHaveText('₹0.00');
  await expect(page.getByTestId('yield-on-paid')).toHaveText('9.30%');
  await expect(page.getByTestId('bond-units')).toHaveText(
    'Buys 105 bonds for ₹99,750 and the FD gets the same.',
  );
  await expect(page.getByTestId('bond-fd-verdict')).toContainText('The bond returns');

  // Half a year since the last coupon: half a coupon is paid to the seller on top of the price.
  await page.getByRole('spinbutton', { name: 'Current price (₹)' }).fill('980');
  await page.getByRole('spinbutton', { name: 'Coupon rate (%)' }).fill('7.5');
  await page.getByRole('spinbutton', { name: 'Years to maturity' }).fill('2.5');
  await expect(page.getByTestId('accrued')).toHaveText('₹37.50');
  await expect(page.getByTestId('total-price')).toHaveText('₹1,017.50');
  await expect(page.getByTestId('ytm')).toHaveText('8.42%');
  await expect(page.getByTestId('yield-on-paid')).toHaveText('8.39%');
  await expect(page.getByTestId('bond-units')).toHaveText(
    'Buys 98 bonds for ₹99,715, including ₹3,675 of accrued interest, and the FD gets the same.',
  );

  // Wint's way claims the accrued interest back; the capital gains way makes it part of the cost.
  await expect(page.getByTestId('bond-after-tax')).toHaveText('5.77%');
  await expect(page.getByRole('checkbox', { name: 'Listed on a stock exchange' })).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Tax on the bond' }).selectOption('capital-gains');
  await expect(page.getByTestId('bond-after-tax')).toHaveText('5.51%');

  // Below par by more than the accrued interest, an unlisted bond's gain is taxed at the slab.
  await page.getByRole('spinbutton', { name: 'Current price (₹)' }).fill('900');
  const listed = await page.getByTestId('bond-after-tax').textContent();

  await page.getByRole('checkbox', { name: 'Listed on a stock exchange' }).click();
  await expect(page.getByTestId('bond-after-tax')).not.toHaveText(listed!);
  await page.getByRole('combobox', { name: 'Tax on the bond' }).selectOption('section-57');

  // At par, 8% paid once a year is the same as an FD paying 8% yearly.
  await page.getByRole('spinbutton', { name: 'Current price (₹)' }).fill('1000');
  await page.getByRole('spinbutton', { name: 'Coupon rate (%)' }).fill('8');
  await page.getByRole('spinbutton', { name: 'Years to maturity' }).fill('5');
  await page.getByRole('spinbutton', { name: 'Interest rate (%)' }).fill('8');
  await page.getByRole('combobox', { name: 'Interest', exact: true }).selectOption('yearly');
  await expect(page.getByTestId('ytm')).toHaveText('8.00%');
  await expect(page.getByTestId('fd-yield')).toHaveText('8.00%');
  await expect(page.getByTestId('bond-fd-verdict')).toHaveText('Both return the same after tax.');
  await expect(page.getByTestId('fd-match')).toContainText(
    'paying interest yearly would need 8.00%',
  );

  // Wint Wealth's Navi Finserv bond pays monthly: it shows ₹31.04 accrued, ₹9,997.84 and 11%.
  await page.getByRole('spinbutton', { name: 'Current price (₹)' }).fill('9966.80');
  await page.getByRole('spinbutton', { name: 'Par value (₹)' }).fill('10000');
  await page.getByRole('spinbutton', { name: 'Coupon rate (%)' }).fill('10.3');
  await page.getByRole('spinbutton', { name: 'Years to maturity' }).fill('2.0137');
  await page.getByRole('combobox', { name: 'Coupons' }).selectOption('monthly');
  await page.getByRole('spinbutton', { name: 'Days accrued' }).fill('11');
  await page.getByRole('spinbutton', { name: 'Amount (₹)' }).fill('99978.41');
  await expect(page.getByTestId('accrued')).toHaveText('₹31.04');
  await expect(page.getByTestId('total-price')).toHaveText('₹9,997.84');
  await expect(page.getByTestId('yield-on-paid')).toHaveText('11.00%');
  await expect(page.getByTestId('bond-units')).toHaveText(
    'Buys 10 bonds for ₹99,978, including ₹310 of accrued interest, and the FD gets the same.',
  );
  await page.getByRole('spinbutton', { name: 'Days accrued' }).fill('31');
  await expect(
    page.getByText('Days since the last coupon must be from 0 to 30 for monthly coupons.'),
  ).toHaveCount(2);
  await page.getByRole('spinbutton', { name: 'Days accrued' }).fill('');

  await page.getByRole('spinbutton', { name: 'Amount (₹)' }).fill('500');
  await expect(
    page.getByText('The amount must cover at least one bond at its total price.'),
  ).toBeVisible();
  await expect(page.getByTestId('bond-fd-verdict')).toHaveCount(0);
  await page.getByRole('spinbutton', { name: 'Years to maturity' }).fill('');
  await expect(page.getByText('Years to maturity must be above 0 and at most 50.')).toHaveCount(2);

  await page.getByRole('link', { name: 'Tools' }).first().click();
  await expect(page.getByRole('heading', { name: 'Tools', exact: true })).toBeVisible();

  expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
