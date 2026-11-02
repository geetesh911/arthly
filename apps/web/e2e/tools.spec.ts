// SPDX-License-Identifier: AGPL-3.0-only
import { expect, type Page, test } from '@playwright/test';

/** Opens Tools on sample data, and collects the page's errors. */
async function openTools(page: Page, phone: boolean): Promise<string[]> {
  const errors: string[] = [];

  page.on('pageerror', (error) => errors.push(error.message));
  await page.route(/github\.io|frankfurter|\/api\/prices\//, (route) => route.abort());
  await page.goto('/');
  await page.getByRole('button', { name: 'Try with sample data' }).click();
  await expect(page.getByTestId('net-worth')).toBeVisible();

  if (phone) {
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

  return errors;
}

test('tools list the bond calculator, which matches SEBI and compares with an FD', async ({
  page,
}, info) => {
  const errors = await openTools(page, info.project.name === 'phone');

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

test('the average NAV calculator takes units or an amount on either side', async ({
  page,
}, info) => {
  const errors = await openTools(page, info.project.name === 'phone');

  await page.getByRole('link', { name: /^Average NAV/ }).click();
  await expect(page.getByRole('heading', { name: 'Average NAV', exact: true })).toBeVisible();

  // 100 units at ₹50, and ₹4,000 more at ₹40 buys 100 units: ₹9,000 over 200 units.
  await expect(page.getByTestId('new-average')).toHaveText('₹45.00');
  await expect(page.getByTestId('average-change')).toHaveText('-10.00%');
  await expect(page.getByTestId('return-before')).toHaveText('-20.00%');
  await expect(page.getByTestId('return-after')).toHaveText('-11.11%');
  await expect(page.getByText('It buys 100 units.')).toBeVisible();

  // Switching to the other kind keeps the same units, and pressing it again keeps it chosen.
  const held = page.getByRole('group', { name: 'Enter what you hold as' });

  await held.getByRole('radio', { name: 'Amount' }).click();
  await held.getByRole('radio', { name: 'Amount' }).click();
  await expect(held.getByRole('radio', { name: 'Amount' })).toBeChecked();
  await expect(page.getByRole('spinbutton', { name: 'Amount invested (₹)' })).toHaveValue('5000');
  await expect(page.getByTestId('new-average')).toHaveText('₹45.00');
  await held.getByRole('radio', { name: 'Units' }).click();

  // A fund's NAV has 4 decimals: ₹10,000 at ₹125.50 buys 79.681 units.
  await page.getByRole('spinbutton', { name: 'Average NAV (₹)' }).fill('142.3456');
  await page.getByRole('spinbutton', { name: 'Units you hold' }).fill('352.817');
  await page.getByRole('spinbutton', { name: 'Buying NAV (₹)' }).fill('125.5');
  await page.getByRole('spinbutton', { name: 'Amount to invest (₹)' }).fill('10000');
  await expect(page.getByTestId('average-summary')).toHaveText(
    'Your average NAV goes down from ₹142.3456 to ₹139.2421.',
  );
  await expect(page.getByTestId('total-units')).toHaveText('432.498');
  await expect(page.getByTestId('total-invested')).toHaveText('₹60,221.95');

  // Units to buy, above the average, bring it up.
  await page
    .getByRole('group', { name: 'Enter what you buy as' })
    .getByRole('radio', { name: 'Units' })
    .click();
  await expect(page.getByRole('spinbutton', { name: 'Units to buy' })).toHaveValue('79.681');
  await page.getByRole('spinbutton', { name: 'Buying NAV (₹)' }).fill('160');
  await expect(page.getByTestId('average-summary')).toContainText('goes up from ₹142.3456');

  await page.getByRole('spinbutton', { name: 'Units to buy' }).fill('');
  await expect(page.getByText('Enter the units to buy.')).toBeVisible();
  await expect(page.getByTestId('new-average')).toHaveCount(0);

  expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
