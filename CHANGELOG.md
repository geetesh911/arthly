# Changelog

## Unreleased

First version, under construction:

- Encrypted, local-first change log with sync-ready merging and `.pvault` backups
- Engine: FIFO lots, XIRR, FDs, bonds and SGBs, PPF, EPF and EPS, cash, income per financial year, upcoming events and checks
- Importers: Groww mutual-fund holdings, Groww stock holdings, Bank of Baroda PPF statements, EPFO passbook PDFs, and the app's own Excel, template, CSV and JSON files
- Exports: Excel (reading tabs plus data tabs), JSON, blank template
- Public price feed: AMFI, NSE (BSE fallback) and ECB FX, with history groups
- Web app: unlock with passphrase, recovery code or passkey; dashboard, holdings, import preview with undo, hand-entry forms, checks, income, settings
- New look built with shadcn-svelte (Luma style): a sidebar on desktop, a tab bar with icons on phones, charts with tooltips, and a light, dark or system theme
- Fixed: unlocking with a passphrase or recovery code now opens the app
- Zip files: drop or share a zip of statements, and each file inside is imported in turn
- Settings: rename and remove members and accounts. Removing an account removes its records too
- Fixed: Settings and the hand-entry forms now confirm what they saved, and refresh straight away
- EPF: import EPFO member passbook PDFs, one per member ID and year, with each share kept apart and the totals checked
- Holdings: one table with Invested, Value, Gain and XIRR columns, a subtotal per section and a total; returns and XIRR show 2 decimals
- Fixed: a return just below zero shows as 0.00%, not -0.00%
- Prices: a Refresh button on Holdings fetches fund NAVs from AMFI and stock prices from NSE (BSE if NSE fails) through the app's own relay on Cloudflare Pages, and the USD rate from Frankfurter. The GitHub price feed is now optional
- XIRR shows once a holding is a year old; before that, gain % covers it. Fixed: holdings imported from a Groww file showed XIRRs in the millions of %
- Named Arthly
- Arthly's colours: Citrus Lime, Light Lime, Lemon Yellow, Forest and Deep Green, in light and dark, as shadcn tokens in `apps/web/src/app.css`; text meets WCAG AA, and a new icon
- Dark theme: Citrus Midnight (#C4F05A on #121713), with stronger focus halos in dark and a visible keyboard focus on the Add screen's file picker
- XIRR for holdings imported from a file counts from the file's date at its value then, since the file doesn't say when you bought; invested and gain still use the cost
- Loans: money owed to you and money you owe, with part repayments, settling in full, write-offs and optional due dates, on a new Loans screen. Net worth adds what you're owed and takes off what you owe; net invested, gain and XIRR stay about investments. Overdue loans show in Checks, loans due soon in Coming up, and loans go into the Excel and JSON exports. The data format is now version 2, so an older copy of the app opens a newer portfolio read-only
- Fixed: number formats on the Excel export's Summary tab were one row off, so Total gain showed as a percentage
- Credit cards: add several cards (bank, a name and an optional limit, never a card number), type in each bill and record payments in part or in full, on a new Cards screen. Net worth takes off what's left to pay on each card's latest bill; net invested, gain and XIRR stay about investments. Bills due soon and overdue ones show in Coming up, and cards go into the Excel and JSON exports. The data format is now version 3
- Add is now a button instead of a screen: a menu in the sidebar on desktop and a panel from the middle of the tab bar on phones, listing every form. Importing files has its own screen, the investment forms sit under Holdings, which has its own Add, and a form's back link returns to where you opened it
- Plan: a new screen for targets, new money and your emergency fund. The allocation planner moves there from Analytics, flags classes that drift more than a band you set (5 points by default), and splits new money across the classes below target without selling, or shows the full buy-and-sell gap. The emergency fund shows how many months of expenses your bank balances, liquid and money market funds and FDs would cover against the months you want to keep (6 by default). Access to your money and the maturity ladder move to Plan too. The planner splits hybrid funds into the classes they hold, using each fund's holdings report; arbitrage funds count as debt, and a fund without a report gets a typical split for its type, marked as an estimate
- Cloud sync with Google Drive: connect it in Settings, and the portfolio syncs on unlock, a few seconds after each change, every 5 minutes, and when the app comes back online or into view. On another device, **Open from Google Drive** on the unlock screen brings it in with your passphrase or recovery code. Only encrypted files go to an `Arthly` folder in Drive, under Google's `drive.file` permission, and a small token function next to the price relay holds the Google client secret. A portfolio now opens in one tab at a time; another tab can take it over
- A privacy policy page, linked from the start screen and Settings, for Google's consent screen and anyone who wants to check. Fixed: on Cloudflare Pages, with the app installed for offline use, coming back from Google's sign-in showed the browser's error page
