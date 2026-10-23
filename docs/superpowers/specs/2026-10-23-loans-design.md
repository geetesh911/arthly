# Loans: money owed to you and money you owe

- **Status:** approved on 2026-10-23.
- **Scope:** track personal loans in both directions and count them in net worth.

## What it is

- **Owed to you (debtors):** money you lent, for example to a friend or relative. An asset.
- **You owe (creditors):** money you borrowed, for example from family. A liability.

You add, edit, repay and close each loan in the app. Loans are interest-free amounts: interest, if any, can be added as an extra amount owed. Amounts are in INR.

## Decisions

| Topic | Decision |
|---|---|
| Interest | None. Amounts only. |
| Due date | Optional. It shows in **Coming up** on Home, and as a check once overdue. |
| Closing | Repay in part or in full (**Settle** repays the whole balance), or **Write off** what's left. **Delete** removes the loan and its history, as if it never existed. |
| Name | The screen is **Loans**, with sections **Owed to you** and **You owe**. |
| Net worth | Investments + owed to you − you owe. |
| Invested, gain, XIRR | Investments only. Loans aren't investments: a 0% loan would drag XIRR down and a loan you took would distort it. |
| Value chart | Investments only, as before. With loans, a note says so. |
| Charts | What you're owed is a positive slice where it fits. What you owe is never a slice. |

**Why net invested and gain leave loans out:** when you lend ₹1L from a bank balance you track, the balance falls by ₹1L and Arthly counts that as money taken out of investments. The loan adds the ₹1L back to net worth, so net worth stays the same and gain doesn't move. A net-worth line next to the investments-only "Invested" line would show false jumps every time money moves between a bank account and a loan, which is why the Value chart stays on investments.

## Data

Two new log entities, so backups, sync, undo-by-delete and the JSON export carry them like everything else.

```ts
Loan      { id, memberId, direction: 'lent' | 'borrowed', party, due?, note? }
LoanEntry { id, loanId, date, type: 'advance' | 'repayment' | 'write-off', amount }
```

- `lent`: they owe you. `borrowed`: you owe them. `party` is the person or party.
- `advance` is money handed over: lent, or borrowed. The first one is written with the loan. More can be added later ("Lent more", "Borrowed more").
- `amount` is always positive, in INR. IDs are random (`loan_…`, `lne_…`), since loans are only entered by hand.
- Entries are separate records so that repayments added on two devices at once both survive. A single record holding a list would keep only the later save.
- Each loan belongs to a member, like an account does. A member with loans can't be removed until the loans are.

**Data format version 2.** The upgrade from version 1 changes nothing. An older build that sees a version 2 event opens read-only instead of failing on the new entities.

## Engine

`packages/core/src/engine/loans.ts`, plain functions over the replayed state:

- **Balance on a date:** advances − repayments − write-offs, counting entries dated on or before it. Entries dated later don't count yet.
- **Open or settled:** a loan with a balance above half a paisa is open; otherwise it's settled, on the date of its last entry.
- **Overdue:** open, with a due date before the day.
- **Totals:** owed to you and you owe, from open loans only. A balance pushed below zero (two devices settling the same loan at once) counts as zero, and the loan's page says it was overpaid.
- **Filters:** a member filter keeps that member's loans. A group or asset-class filter leaves loans out, since loans are in neither.
- **Rules for new entries:** amounts above zero; a repayment or write-off can't exceed the balance (all entries counted); no entry before the loan's first advance; a due date can't be before the loan started. An entry can't be deleted if that would leave the balance below zero.

**`summary()`** gains `investments` (what net worth used to be) and `loans: { owedToYou, youOwe, owedToYouByMember }`. `netWorth` becomes investments + owed to you − you owe. Net invested, total gain, absolute return, XIRR, weights and history stay on investments.

**Analytics** take what's owed to you as an extra input:

- **Asset split** and **Access to your money** add an **Owed to you** slice.
- Investment vehicles, sectors, market cap, active/passive, underlying split, currency, concentration, the maturity ladder and the allocation planner leave loans out. They describe investments, and rebalancing into a friend's loan makes no sense.
- Analytics returns both loan totals, so the screen can note what you owe without charting it.

**Checks:** `loan.overdue` warns about each overdue loan, with a fix that opens the loan. Its key includes the due date, so a new due date raises it again. The backup reminder also counts loans as data worth backing up.

**Coming up:** open loans due within the window, with the balance as the amount.

## Screens

- **Loans** (`#/loans`): in the desktop sidebar, and under More on phones.
  - A summary: Owed to you, You owe, and Net.
  - **Owed to you** and **You owe** lists. Each row shows who, whose (when there are several members), the due date or **Overdue**, and the balance. A row opens the loan.
  - A **Settled** list for closed loans.
  - **Add a loan** opens the form.
- **Add a loan** (`#/loans/new`, also from Add → Add by hand → Loan): I lent / I borrowed, who, whose, amount, date, due by (optional), note (optional).
- **A loan** (`#/loans/<id>`):
  - Balance, total lent or borrowed, repaid, and written off.
  - **Record a payment**: Got back / Paid back, or Lent more / Borrowed more, with an amount and date. Part payments are fine.
  - **Settle in full** and **Write off**, each confirmed first.
  - History, oldest first (a day's entries in the order they were recorded), with a delete button on each entry.
  - Details (who, whose, due date, note) to edit, and **Delete loan**.
- **Home:** with loans, the net worth card adds *Investments · Owed to you · You owe* under the total, linking to Loans. The allocation donut adds **Owed to you** by asset class, to its member by member, and to "Not in a group" by group. The Value chart notes that it shows investments only. A portfolio with loans (open or settled) but no holdings shows the dashboard, not the welcome screen.
- **Analytics:** the Asset split and Access to your money notes mention the amount owed to you, and what you owe, which isn't charted.
- **Checks and Coming up:** overdue and upcoming loans, as above.
- **Sample data:** one loan each way, with made-up names.

## Export and import

- **JSON export:** the new entities are included automatically.
- **Excel export:** the Summary tab adds Investments, Owed to you and You owe below Net worth. The Monthly history tab's value column is now called Investments, since it leaves loans out. A **Loans** reading tab lists each loan with its totals. `_loans` and `_loan_entries` data tabs bring them back through the template importer, as with the JSON export.

## Testing

- **Core unit tests:** balances with part repayments, settle, write-off, future-dated entries, overdue, member and group filters, entry rules, summary figures (net worth moves; net invested, gain and XIRR don't), analytics slices (what you owe is never a slice), checks, coming up, the version 1 upgrade, and an Excel and JSON round trip.
- **Data service tests:** adding, repaying, settling, writing off and deleting through the service, the net worth effect on the overview, rules that refuse bad entries, and loans surviving a backup and restore.
- **Playwright, at phone and desktop sizes:** add a loan owed to you, record a part repayment, settle it, add a loan you owe, and check net worth on Home after each step.
