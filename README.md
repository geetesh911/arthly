# Arthly

Arthly is a free, open-source portfolio tracker for Indian investors. It runs in your browser, and your data is encrypted on your device. No server ever sees your holdings.

Use it at **[arthly.pages.dev](https://arthly.pages.dev)**, or [host your own copy](#host-it-yourself).

It tracks Indian stocks, ETFs and mutual funds, SGBs and bonds, FDs, PPF, EPF and EPS, bank cash, US stocks (priced by hand for now), money you've lent or borrowed, and credit card bills. One portfolio can hold a whole family, with each account belonging to a member.

> Status: version 1 is under construction. The design is in [docs/superpowers/specs](docs/superpowers/specs/2026-10-22-portfolio-app-design.md), and the build plan in [docs/superpowers/plans](docs/superpowers/plans/2026-10-22-v1-phases.md).

## What it does

- **Dashboard:** net worth, net invested, total gain, exact XIRR, allocation by asset class, member or group, value over time, and what's coming up.
- **Loans:** money owed to you (what you lent) and money you owe (what you borrowed), with part repayments, settling in full, write-offs and optional due dates. Net worth adds what you're owed and takes off what you owe. Net invested, gain and XIRR stay about your investments. What you're owed shows in the asset split and in access to your money; what you owe is never a chart slice. Overdue loans show in Checks, and loans due soon in Coming up.
- **Credit cards:** several cards, each with its bank, a name you give it and an optional credit limit. No card number is kept. Type in each bill (amount, minimum due, statement and due dates) and record what you pay, in part or in full. Net worth takes off what's left to pay on each card's latest bill; a new bill replaces what was left on the last one. Bills due soon, and overdue ones, show in Coming up. Close a card you no longer use and its history stays.
- **Portfolio analytics:** asset and investment-vehicle splits, NSE sector allocation, AMFI's official large, mid and small cap categories, consolidated stock concentration, active/passive funds, currency denomination, largest positions and price freshness. Direct stocks and disclosed fund stocks are combined by ISIN. Fund holding details show weights, estimated rupee exposure, report dates and official sources, with overlap across funds. Coverage and eligible subtotals are shown beside each view.
- **Indices and benchmarks:** every index in NSE's and BSE's daily files (about 300), searchable, with each level's date, daily change and return basis, plus 1-month and 1-year changes once saved closes reach back that far.
- **Plan:** targets for each asset class, with a drift band that flags classes too far off target. New money is split across the classes below target without selling anything, or a buy-and-sell mode shows the full gap. Hybrid funds count as the classes they hold: by their latest holdings report, arbitrage funds as debt, and a typical split for their type when there's no report. An emergency fund shows how many months of expenses your bank balances, liquid and money market funds and FDs would cover. Access to your money and a maturity ladder sit alongside. Everything is saved separately for the family and each member.
- **Imports:** drop in the files your broker gives you. Today that's Groww's mutual-fund and stock holdings files, Bank of Baroda's PPF statement and EPFO passbook PDFs, plus this app's own Excel, template and JSON exports, one at a time or zipped together. Every import shows a preview first and can be undone.
- **Fixed income done properly:** FD compounding and payouts, SGB and bond coupons, PPF interest on the lowest balance from the 5th, EPF interest from the month after each contribution.
- **Checks:** stale prices or files, holdings that don't match your files, possible duplicates, maturities and payouts due soon, and PPF minimums and limits.
- **Income per financial year:** interest and dividends, received and earned. A summary for your records, not tax advice.
- **Cloud sync:** connect Google Drive in Settings and the portfolio stays up to date on every device: phone, laptop or a family member's. Changes merge by themselves, and when the same record was changed on two devices, the later change wins and Checks offers the other. On a new device, choose **Link with another device**, sign in to Google, and scan the code it shows from Settings → Cloud sync → **Link a device** on a device where the portfolio is open. No passphrase needed. Or choose **Open from Google Drive** and unlock with your passphrase or recovery code.
- **No lock-in:** export to Excel or JSON at any time, and import them back. An encrypted backup file restores everything on another device.

## Privacy

- Everything is parsed, stored and calculated in your browser. Your original files are never stored or uploaded.
- Data is encrypted with AES-256-GCM under a key that only your passphrase, your recovery code or your device's passkey can unlock. The app locks itself when idle.
- Prices are fetched as whole files (every fund and every listed security) through the app's own relay, so neither the relay nor AMFI, NSE or BSE learn what you hold.
- Sectors come from whole NSE constituent lists and the industries in fund reports, grouped into NSE's 22 sectors. Cap sizes come from AMFI's whole stock categorisation, which covers every listed company. The last successful lists are kept if a refresh fails.
- Fund holdings arrive as whole monthly disclosure workbooks from PPFAS, Nippon India, HDFC, SBI, Tata, DSP, Bank of India, Zerodha, Quant, Invesco, Canara Robeco and Mirae Asset. The relay discovers and streams their official files; the browser parses and encrypts them locally. It fetches every supported file without sending your fund selections. Missing reports remain unclassified, and saved reports retain their original dates after a failed refresh.
- Index levels arrive as NSE's and BSE's whole daily all-index files, fetched whatever you hold or look at. If one exchange fails, its last levels stay with their original date.
- Cloud sync puts only encrypted files in your Google Drive, in an `Arthly` folder. Arthly asks only for the files it makes itself, so it can't see anything else in your Drive. The Google sign-in is kept encrypted on each device and is never synced or put in a backup file. Linking a device sends the portfolio's key through that folder, sealed so only the new device can open it.
- No analytics, no third-party scripts, no remote fonts.

See the [privacy policy](https://arthly.pages.dev/privacy) and [SECURITY.md](SECURITY.md) for the details and the limits.

## Use it

Open [arthly.pages.dev](https://arthly.pages.dev), choose **New portfolio**, set a passphrase and write down the recovery code. On iPhone, add the app to your Home Screen first, because Safari may clear data for sites that aren't added.

Each month, download your Groww holdings files and drop them on the **Import** screen (**Add** → **Import files**). On Android you can share the files straight to the app.

## Host it yourself

The app is a static site plus one small piece of server code: the price relay in `functions/`. AMFI, NSE, BSE and the fund houses don't let web pages read their files, so the relay fetches them for the app. Cloudflare Pages runs it next to the app on its free plan.

1. Fork this repository.
2. Deploy it to Cloudflare Pages from your computer:

   ```bash
   pnpm install
   pnpm exec wrangler login
   pnpm run deploy
   ```

   The first deploy creates the Pages project named in `wrangler.jsonc`. To build from GitHub instead, create a Pages project from your fork with build command `pnpm build` and output directory `apps/web/build`; Cloudflare finds `functions/` and `_headers` by itself.

3. Open the site, add your holdings, and press **Refresh prices** on the **Holdings** screen.

**Cloud sync with Google Drive (optional):** the app signs in to Google through a second small function in `functions/`, which holds your Google client secret. It swaps Google's sign-in codes for tokens and never sees any data. Without it, Settings says Google Drive isn't set up.

1. In the [Google Cloud console](https://console.cloud.google.com/), create a project and enable the **Google Drive API**.
2. Under **Google Auth Platform**, fill in the branding, with `https://<your site>/` as the home page and `https://<your site>/privacy` as the privacy policy. Choose the **External** audience, and add the `https://www.googleapis.com/auth/drive.file` scope under **Data access**. Then publish the app: while it's in testing, Google's sign-ins expire after 7 days. That scope is non-sensitive, so Google doesn't review the app, though it may ask to verify the branding if you add a logo.
3. Under **Clients**, create a **Web application** client with the authorized redirect URI `https://<your site>/oauth.html`. To try it locally with `pnpm relay`, also add `http://localhost:8788/oauth.html`.
4. Give the Pages project the client's ID and secret, then deploy again:

   ```bash
   pnpm exec wrangler pages secret put GOOGLE_CLIENT_ID
   pnpm exec wrangler pages secret put GOOGLE_CLIENT_SECRET
   pnpm run deploy
   ```

   For `pnpm relay`, put `GOOGLE_CLIENT_ID=…` and `GOOGLE_CLIENT_SECRET=…` in a `.dev.vars` file at the top of the repository instead. Git ignores it.

The relay goes back up to a week for the last trading day's file. If NSE turns it away, it uses BSE's file instead. If neither answers, the app keeps the last prices and says so.

**Fund disclosures:** **Refresh data** in Analytics updates the supported monthly fund portfolios alongside prices and classification lists. Automatic checks run daily when the app refreshes prices. Underlying exposure uses current fund value × disclosed weight, so it is a dated estimate. Cash, debt and commodities stay separate; nested funds are expanded only when their reports can be matched. A fund without a report counts under its own type in the underlying asset split, marked "by fund type"; its stocks stay unclassified. Physical stock weights do not subtract derivative hedges. A new month's reports from every fund house come to about 60 MB, and saved months aren't downloaded again. If one scheme in a fund house's workbook can't be read, the rest still load and Analytics says which. Other AMCs need additional source adapters; AMFI's NAV list alone does not provide underlying holdings. Axis and Edelweiss refuse requests that don't come from a browser, and HDFC's site currently refuses the relay. For those, download the fund house's monthly portfolio from its website and choose **Add a fund report** under the fund holdings in Analytics. The file is read and kept on this device only, and the newest report of each scheme is used, whether fetched or added.

**Indices:** each data refresh also reads NSE's daily snapshot (`ind_close_all`) and BSE's daily all-indices file. Equity levels are price indices: neither file carries total return versions, and Nifty's total return values only come one index at a time from its website, so they aren't fetched. BSE's index API refuses requests from outside a browser; its public CSV doesn't. The app saves each refresh's closes, so 1-month and 1-year changes appear once its history reaches back that far.

**Cap sizes:** AMFI publishes its stock categorisation every January and July: the 100 largest companies by six-month average market value are large caps, the next 150 mid caps and the rest small caps. The relay finds the newest workbook on AMFI's page and the app reads it, checking for a new one weekly. Stocks listed since the list's period stay unclassified until the next one.

**A price feed instead (optional):** `apps/price-feed` builds the same prices, normalized fund disclosures, AMFI's cap list and index levels every evening as a GitHub Actions job and publishes them to GitHub Pages. It also fills up to 100 missing days of index history per exchange per run from their daily archives, so a feed has a year of closes within a few days. In your fork's settings, set **Pages → Source** to **GitHub Actions** and run the **Price feed** workflow once, then enter the feed's address in **Settings → Prices**. A feed outside `*.github.io` also needs `PUBLIC_FEED_ORIGIN` set when building. Older feeds without fund holdings, index levels or the cap list fall back to the app's relay.

## Develop

Requires Node 22 or later and pnpm 10.

```bash
pnpm install
pnpm test        # unit tests for core, price feed and the data worker
pnpm typecheck
pnpm lint
pnpm build       # the static site in apps/web/build
pnpm relay       # the built site plus the price relay, at http://localhost:8788
pnpm e2e         # Playwright, at phone and desktop sizes
```

| Folder            | What it holds                                                                                                                                                                                      |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core`   | Plain TypeScript with no DOM: the change log, encryption, sync, the engine, and the plugins (importers, asset types, price sources, exporters, storage providers)                                  |
| `apps/web`        | The SvelteKit app. `src/lib/worker` is the data worker that holds the key and the data; the screens talk to it over Comlink and are built from shadcn-svelte components in `src/lib/components/ui` |
| `functions`       | The price relay and the Google token function, as Cloudflare Pages Functions; their logic and tests are in `packages/core/src/plugins/prices/relay` and `plugins/storage/google-drive`             |
| `apps/price-feed` | The optional nightly price feed, run by `.github/workflows/price-feed.yml`                                                                                                                         |

To add an importer or another plugin, see [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

[AGPL-3.0](LICENSE). If you run a modified copy for others, you must share its source. The components in `apps/web/src/lib/components/ui` come from [shadcn-svelte](https://shadcn-svelte.com) and keep its MIT licence.
