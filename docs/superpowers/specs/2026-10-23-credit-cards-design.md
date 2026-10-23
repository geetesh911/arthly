# Credit cards: bills, payments and due dates

- **Status:** approved on 2026-10-23.
- **Scope:** track several credit cards, their bills and payments, and count what's left to pay in net worth.
- **Builds on:** [loans](2026-10-23-loans-design.md). Both change the same files (model, events, summary, analytics, Home, Nav, the Excel export), so cards are built after loans lands.

## What it is

You add each card, type in each bill from the bank's app or SMS, and record what you pay. Arthly shows what's left to pay and when it's due, and counts it against net worth. Amounts are in INR.

Arthly never stores a card number, not even the last four digits. A card is known by its bank and a name you give it.

## Decisions

| Topic | Decision |
|---|---|
| Net worth | Investments + owed to you − you owe − card dues. Card dues are what's left to pay on each card's latest bill. Spends not on a bill yet don't count. |
| Bills | Typed in by hand: amount, minimum due, statement date, due date. No statement import. |
| Payments | Each payment has an amount and a date. Part payments are fine. |
| Carry over | A new bill replaces whatever was left on the last one. The bank's new bill already includes the unpaid part and its interest, so nothing is counted twice. |
| Members | Each card belongs to a member, like a loan. |
| Card details | Bank, name, and an optional credit limit. No card number. |
| Reminders | **Coming up** on Home only. No checks for cards. |
| History | Every bill and payment is kept. **Close** a card you no longer use: it leaves the lists and keeps its history. **Delete** removes the card and its history, as if it never existed. |
| Screen | Its own **Cards** screen, next to Loans. Home shows card dues as their own part of net worth. |
| Invested, gain, XIRR | Investments only, as with loans. |
| Value chart | Investments only, as before. With card dues, a note says so. |
| Charts | Card dues are never a slice, like what you owe. |

**Why net worth stays steady when you pay:** paying a ₹20,000 bill from a bank balance you track lowers the balance by ₹20,000, which Arthly counts as money taken out of investments, and lowers card dues by the same amount. Net worth moves when the bill arrives, since that's when the spending shows up, not when you pay it.

**Why a card isn't a loan you owe:** a loan has one balance and one due date. A card gets a new bill every month, each with its own due date and minimum, and each new bill resets what's owed. Write-off doesn't apply. So cards get their own records, and follow the loans rules for members, filters, net worth and charts.

## Data

Three new log entities, so backups, sync, undo-by-delete and the JSON export carry them like everything else.

```ts
Card        { id, memberId, bank, name, limit?, closed? }
CardBill    { id, cardId, statementDate, dueDate, amount, minimumDue }
CardPayment { id, cardId, date, amount }
```

- `bank` is who issued the card. `name` is what you call it, such as "Travel card". `limit` is the credit limit. `closed` is the date you closed it, for a card you no longer use.
- `amount` is the bill's total due, and `minimumDue` its minimum due. Both are zero or more, in INR. A bill of zero is fine, for a month with no spends.
- A payment's `amount` is above zero, in INR.
- A payment isn't tied to a bill. It counts against the latest bill before it, which is how banks apply it, and it stays right when a bill is edited or deleted.
- IDs are random (`card_…`, `cbl_…`, `cpy_…`), since cards are only entered by hand.
- Bills and payments are separate records so that payments added on two devices at once both survive, as with loan entries.
- A member with cards can't be removed until the cards are.

**Data format version 3.** The upgrade from version 2 changes nothing. An older build that sees a version 3 event opens read-only instead of failing on the new entities. If cards ship in the same release as loans, before any build that writes version 2 is out, they share version 2 instead.

## Engine

`packages/core/src/engine/cards.ts`, plain functions over the replayed state, on a date:

- **Latest bill:** the bill with the latest statement date on or before the date. Bills dated later don't count yet.
- **Paid:** payments dated after the latest bill's statement date, up to the date. A payment on the statement date is already in that bill.
- **Left to pay:** the latest bill's amount less paid. Below zero, the card is **in credit**, and counts as zero.
- **Status of the latest bill:** **Paid** once paid reaches the amount, **Minimum paid** once it reaches the minimum due, **Part paid** when above zero, and **Unpaid** otherwise. **Overdue** as well, when the due date is before the date and something is left to pay.
- **Past bills:** each one's payments are those after its statement date, up to the next bill's statement date. The card page shows each past bill's status from these.
- **Limit used:** the latest bill's amount as a share of the limit, when there is one.
- **Total card dues:** left to pay, summed over all cards. Closed cards count too, so a due can't hide.
- **Filters:** the same rule as loans. A member filter keeps that member's cards. An account, holding, group or asset-class filter leaves cards out, since cards are in none of them.
- **Rules for new records:**
  - A bill's minimum due is no more than its amount, and its due date is after its statement date. No two bills on a card share a statement date. Older bills can be added later, to fill in history.
  - A payment can't be before the card's first bill. Paying more than is left is fine: the card goes into credit.
  - A card needs a bank and a name, and a limit above zero when given. It can be closed only when nothing is left to pay, and reopened any time.
  - Bills and payments can always be deleted.

**`summary()`** gains `cardDues`. `netWorth` becomes investments + owed to you − you owe − card dues. Net invested, total gain, absolute return, XIRR, weights and history stay on investments.

**Analytics** take card dues as an extra input, for the notes only. Analytics returns them next to the loan totals, so the screen can note them without charting them.

**Checks:** none for cards. The backup reminder counts cards as data worth backing up.

**Coming up:** each card whose latest bill has something left to pay and is due within the window, with left to pay as the amount. A bill past its due date with something left to pay stays at the top, marked **Overdue**, until it's paid. Since there are no card checks, this is what keeps a missed bill in view.

## Screens

- **Cards** (`#/cards`): in the desktop sidebar, and under More on phones.
  - A summary: Card dues and the next due date.
  - A list of cards. Each row shows the bank and name, whose (when there are several members), the due date or **Overdue**, left to pay, and the bill's status. A row opens the card.
  - A **Closed** list.
  - **Add a card** opens the form.
- **Add a card** (`#/cards/new`): bank, name, whose, credit limit (optional), and the first bill (optional): amount, minimum due, statement date, due date.
- **Add a bill** (`#/cards/bill`, also from Add → Add by hand → **Card bill**): choose the card, or add one, then the bill's amount, minimum due, statement date and due date.
- **A card** (`#/cards/<id>`):
  - The latest bill: amount, minimum due, statement and due dates, paid so far, left to pay, status, and limit used.
  - **Add a bill**.
  - **Record a payment**: **Pay in full**, **Pay minimum** or **Other amount**, with a date (today by default). Pay in full fills in what's left to pay, and Pay minimum what's left of the minimum due.
  - History: bills and payments, newest first, each bill with its status, and a delete button on each.
  - Details (bank, name, whose, limit) to edit, **Close card** or **Reopen card**, and **Delete card**, each confirmed first.
- **Home:**
  - With card dues, the net worth line adds them: *Investments · Owed to you · You owe · Card dues*, each part only when above zero, with links to Loans and Cards.
  - The Value chart's note says loans and card dues aren't in it.
  - Coming up shows card bills as above.
  - A portfolio with cards but no holdings shows the dashboard, not the welcome screen.
- **Analytics:** the Asset split and Access to your money notes mention card dues, which aren't charted.
- **Sample data:** two cards with made-up names, one paid in full and one with only the minimum paid.

## Export and import

- **JSON export:** the new entities are included automatically.
- **Excel export:** the Summary tab adds Card dues below You owe. A **Cards** reading tab lists each card with whose, bank, name, limit, the latest bill's statement date, due date, amount and minimum due, paid, left to pay and status. `_cards`, `_card_bills` and `_card_payments` data tabs bring them back through the template importer, as with the JSON export.

## Not included

- Single spends, EMIs, reward points, and fees or interest as separate amounts. They're all in the bill.
- Statement imports.
- Card numbers, in full or in part.
- Checks for bills due, overdue or missing.
- Auto-pay.
- Bills in other currencies.

## Testing

- **Core unit tests:** left to pay after part, minimum and full payments; a payment on the statement date; a new bill replacing what was left; paying into credit; future-dated bills and payments; past bill statuses; limit used; member and group filters; the record rules, including closing a card with something left to pay; summary figures (net worth moves; net invested, gain and XIRR don't); analytics (card dues are never a slice); Coming up, including an overdue bill; the backup reminder with only cards; the version 2 upgrade; and an Excel and JSON round trip.
- **Data service tests:** adding a card and its bills, paying in part and in full, closing, reopening and deleting through the service, the net worth effect on the overview, rules that refuse bad records, a member with cards that can't be removed, and cards surviving a backup and restore.
- **Playwright, at phone and desktop sizes:** add a card with its first bill, pay the minimum, check Coming up and net worth on Home, add the next bill, pay it in full, and close the card.
