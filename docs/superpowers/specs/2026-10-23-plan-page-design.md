# Plan: targets, new money and an emergency fund

- **Status:** approved on 2026-10-23. Covers options 1, 2 and 4 of the planning shortlist. The open questions use the defaults in **Decisions**; change any of them before building on it.
- **Scope:** a new **Plan** screen for deciding what to do next. Analytics keeps describing what you hold.

## What it is

1. **Planning moves to Plan.** The allocation planner, **Access to your money** and the **Maturity ladder** leave Analytics.
2. **Better rebalancing.** The planner flags asset classes that drift too far from their target, and splits new money across the classes below target without selling anything. A **Buy and sell** mode keeps today's full rebalance.
3. **Emergency fund.** How many months of expenses the money you can reach quickly would cover, against a target number of months.

Out of scope for now: goals, glide paths, projections, finer targets inside equity, tax-aware selling, and a drift check on the Checks screen.

## Decisions

| Topic | Default |
|---|---|
| Where | **Plan** (`#/plan`): in the desktop sidebar after Analytics, and under More on phones. |
| Saved for | Everyone and each member separately, like targets today. Plan follows the member picker. |
| Rebalancing mode | **New money only** by default: never suggests selling. **Buy and sell** shows the full gap to target, as today. |
| Drift band | ±5 percentage points, editable from 0 to 50. A class outside it is flagged. |
| Drift measured on | Today's values, before the new money. |
| Splitting new money | Classes furthest below target are filled first, rising together, so no class goes over its target. |
| Amount to invest | Saved with the plan, so the screen opens with your usual monthly amount. Covers a lump sum or a month's SIPs. |
| What counts toward allocation | All holdings, PPF and EPF included, by each holding's asset class, as today. Money you've lent, what you owe and card dues are left out. |
| Hybrid funds | Split into Equity, Debt, Cash, Gold and Silver by what they hold, so the planner has no Hybrid class. See **Hybrid funds** below. Equity and debt funds keep their own class. |
| Emergency money | Bank balances, funds with asset class **Cash** (liquid, overnight and money market funds get it by default) and fixed deposits. Not counted: other debt funds, bonds, SGBs, PPF, EPF, EPS, stocks, gold, and money you've lent. |
| Emergency target | 6 months of expenses, editable from 1 to 36. |
| Card bills | Not taken off emergency money. Monthly expenses already cover what you spend on cards, so taking the bill off as well would count it twice. |
| Emergency fund and allocation | Emergency money still counts in the allocation. When the emergency fund is short, the planner says so before you invest. |
| Taxes and costs | Not modelled. The planner notes that selling can bring tax, exit loads and lock-ins. |

## Hybrid funds

Agreed on 2026-10-23, after the first version: the planner splits each hybrid fund (a mutual fund or ETF whose asset class is **Hybrid**) into the asset classes it holds.

| Case | How it counts |
|---|---|
| Arbitrage funds | Fully as **Debt**. Their stocks are hedged with futures, so they carry no equity risk. |
| A fund with a holdings report | By the report's stocks, bonds, cash and commodities. The rounding gap and any negative class (such as cash owed) are left out, and the rest scaled to the fund's value. A nested fund with no report is split by type, as below. |
| A fund with no report | A typical split for its type, marked as an estimate: aggressive hybrid 70% equity and 30% debt; conservative hybrid 20/80; balanced advantage and dynamic asset allocation 50/50; balanced hybrid 50/50; equity savings 35/65; multi-asset 50% equity, 30% debt and 20% gold; any other hybrid fund 50/50. |
| Hedged funds with a report | Balanced advantage and equity savings funds hedge part of their stocks with futures, which reports leave out, so their equity can be overstated. The planner says so when you hold one. |
| A fund you've given another class | Not split: the class you chose wins. |

The type comes from the fund's AMFI category and name. Only the planner splits funds; the Home donut and Analytics' Asset split still count hybrid funds as Hybrid, and Analytics' **Underlying asset split** splits every fund by its report.

The **Hybrid** row shows in the planner only while something still counts as Hybrid (such as a holding of another kind marked Hybrid) or a saved target gives it a share, so an old Hybrid target can be moved to the other classes.

A list under the planner shows each hybrid fund, how it was split (its report and date, its type, or arbitrage) and the resulting shares.

## Data

No new entities. Plan uses `setting` records, one set per scope (`all` or a member's id):

```ts
analyticsTargets:<scope>  AllocationTargets                  // unchanged, so saved targets carry over
allocationPlan:<scope>    { mode: 'new-money' | 'rebalance', band: number, amount: number }
emergencyFund:<scope>     { monthlyExpenses: number, months: number }
```

Settings travel in backups and the JSON export like other settings. The data format version doesn't change: an older build ignores settings it doesn't know.

## Engine

`packages/core/src/engine/plan.ts`, plain functions:

- **`planning(holdings, date, reference, loans)`**: what the Plan screen needs from the holdings. It returns the total, asset values by class (with hybrid funds split, using the fund reports and AMFI schemes in `reference`), each hybrid fund's split, **Access to your money** and the **Maturity ladder** (moved from `portfolioAnalytics`, unchanged), and emergency money split into bank / cash, cash funds and fixed deposits. Closed holdings and holdings at zero are left out, as in analytics.
- **`rebalancePlan(current, targets, amount, band)`** (moved from analytics) returns, for each asset class:
  - its value, current share, target % and target value after the new money;
  - **drift**: current share − target, in percentage points, and whether it's outside the band;
  - **change**: target value − value, signed (Buy and sell);
  - **add**: this class's part of the new money (New money only), and its share afterwards.

  It also counts the classes outside the band. Targets must total 100% with each between 0 and 100; the amount must be zero or more and the band between 0 and 50.
- **New money split:** pick a level λ and give each class `max(0, target% × λ − value)`, with λ chosen so the parts add up to the amount. Every class that gets money ends at the same fraction of its target, and none goes over it. Because the gaps below target always add up to at least the amount, the whole amount is placed. Classes with a 0% target get nothing.
- **`emergencyFund(money, settings)`**: available money, the target (months × monthly expenses), months covered and the shortfall. Monthly expenses must be above zero and months between 1 and 36.
- **`portfolioAnalytics`** stops returning asset values, liquidity and maturities.

## Data service

- **`plan(filter)`** returns `planning()` for the filter, with the scope's saved targets, allocation plan settings and emergency fund settings (each `null` until saved), and the loan totals and card dues, so the screen can mention them.
- **`saveAllocationPlan({ targets, mode, band, amount }, memberId?)`** checks the values and saves `analyticsTargets` and `allocationPlan` for the scope. It replaces `saveAllocationTargets`.
- **`saveEmergencyFund({ monthlyExpenses, months }, memberId?)`** checks and saves `emergencyFund` for the scope.

## Screens

- **Plan** (`#/plan`), top to bottom:
  - **Allocation planner**:
    - Amount to invest (₹), the drift band (± points), and **New money only** / **Buy and sell**.
    - A line that says how many classes are outside the band, or that every class is within it.
    - A row per class: current share, target % (editable), how far off it is (flagged when outside the band), and **Put in** (New money only) or **Change** (Buy and sell). On phones the last two go on a second line under each row.
    - When the saved emergency fund is short, a line saying by how much, before the table.
    - **Save plan** saves the targets, mode, band and amount for this selection. Without saved targets, they start at today's split, as they do now.
  - **Emergency fund**: monthly expenses (₹) and months to keep. It shows the months covered against the target, how much is short or spare, and the money counted by type. **Save** keeps it for this selection. Until expenses are entered, it shows the money counted and asks for expenses.
  - **Access to your money** and the **Maturity ladder**, moved from Analytics as they are.
  - With no holdings, an empty state that links to **Import files**.
- **Analytics**: loses the three cards. Its intro and empty state stop mentioning planning, and the **Bank / cash** figure is read from Investment vehicles. The underlying asset split's note points to the planner on Plan.
- **More** (phones): a **Plan** row ("Targets, new money and your emergency fund"). Analytics' row reads "Allocation, concentration and fund holdings".

## Testing

- **Core unit tests:** the drift band edges; new money placed below target, never over it, with the parts adding up to the amount; zero holdings; 0% targets; Buy and sell gaps; invalid targets, amounts and bands; emergency money by type (cash funds counted, other debt funds not, money lent not); hybrid funds split by report, by type and as arbitrage, with negatives and the rounding gap left out, and a class you chose not split; months covered and shortfall; Analytics without the moved fields.
- **Data service tests:** `plan()` per member; saving and reading the allocation plan and emergency fund per scope; bad values refused.
- **Playwright, at phone and desktop sizes:** open Plan from the sidebar and from More; set targets, an amount and a band; check the new money split and the drift flag; switch to Buy and sell; save, switch member and back; enter monthly expenses and check months covered; the screen fits the width. The Analytics test stops checking for the planner.
