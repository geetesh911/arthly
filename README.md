# Arthly

Arthly is a free, open-source portfolio tracker for Indian investors. It runs in your browser, and your data is encrypted on your device. No server ever sees your holdings.

It tracks Indian stocks, ETFs and mutual funds, SGBs and bonds, FDs, PPF, EPF and EPS, bank cash, and US stocks (priced by hand for now). One portfolio can hold a whole family, with each account belonging to a member.

> Status: version 1 is under construction. The design is in [docs/superpowers/specs](docs/superpowers/specs/2026-10-22-portfolio-app-design.md), and the build plan in [docs/superpowers/plans](docs/superpowers/plans/2026-10-22-v1-phases.md).

## What it does

- **Dashboard:** net worth, net invested, total gain, exact XIRR, allocation by asset class, member or group, value over time, and what's coming up.
- **Portfolio analytics:** asset and investment-vehicle splits, NSE sector allocation, AMFI's official large, mid and small cap categories, consolidated stock concentration, and active/passive funds. Direct stocks and disclosed fund stocks are combined by ISIN. Fund holding details show weights, estimated rupee exposure, report dates and official sources, with overlap across funds. Coverage and eligible subtotals are shown beside each view.
- **Indices and benchmarks:** every index in NSE's and BSE's daily files (about 300), searchable, with each level's date, daily change and return basis, plus 1-month and 1-year changes once saved closes reach back that far.
- **Planning:** liquidity categories, a maturity ladder, currency denomination, largest positions, price freshness, and an allocation planner with optional contributions and targets saved separately for the family and each member.
- **Imports:** drop in the files your broker gives you. Today that's Groww's mutual-fund and stock holdings files, Bank of Baroda's PPF statement and EPFO passbook PDFs, plus this app's own Excel, template and JSON exports, one at a time or zipped together. Every import shows a preview first and can be undone.
- **Fixed income done properly:** FD compounding and payouts, SGB and bond coupons, PPF interest on the lowest balance from the 5th, EPF interest from the month after each contribution.
- **Checks:** stale prices or files, holdings that don't match your files, possible duplicates, maturities and payouts due soon, and PPF minimums and limits.
- **Income per financial year:** interest and dividends, received and earned. A summary for your records, not tax advice.
- **No lock-in:** export to Excel or JSON at any time, and import them back. An encrypted backup file restores everything on another device.

## Privacy

- Everything is parsed, stored and calculated in your browser. Your original files are never stored or uploaded.
- Data is encrypted with AES-256-GCM under a key that only your passphrase, your recovery code or your device's passkey can unlock. The app locks itself when idle.
- Prices are fetched as whole files (every fund and every listed security) through the app's own relay, so neither the relay nor AMFI, NSE or BSE learn what you hold.
- Sectors come from whole NSE constituent lists and the industries in fund reports, grouped into NSE's 22 sectors. Cap sizes come from AMFI's whole stock categorisation, which covers every listed company. The last successful lists are kept if a refresh fails.
- Fund holdings arrive as whole monthly disclosure workbooks from PPFAS, Nippon India, HDFC, SBI, Tata, DSP, Bank of India, Zerodha, Quant, Invesco, Canara Robeco and Mirae Asset. The relay discovers and streams their official files; the browser parses and encrypts them locally. It fetches every supported file without sending your fund selections. Missing reports remain unclassified, and saved reports retain their original dates after a failed refresh.
- Index levels arrive as NSE's and BSE's whole daily all-index files, fetched whatever you hold or look at. If one exchange fails, its last levels stay with their original date.
- No analytics, no third-party scripts, no remote fonts.

See [SECURITY.md](SECURITY.md) for the details and the limits.

## Use it

Open the hosted site, choose **New portfolio**, set a passphrase and write down the recovery code. On iPhone, add the app to your Home Screen first, because Safari may clear data for sites that aren't added.

Each month, download your Groww holdings files and drop them on the **Add** screen. On Android you can share the files straight to the app.

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
| `packages/core`   | Plain TypeScript with no DOM: the change log, encryption, sync, the engine, and the plugins (importers, asset types, price sources, exporters)                                                     |
| `apps/web`        | The SvelteKit app. `src/lib/worker` is the data worker that holds the key and the data; the screens talk to it over Comlink and are built from shadcn-svelte components in `src/lib/components/ui` |
| `functions`       | The price relay, as a Cloudflare Pages Function; its logic and tests are in `packages/core/src/plugins/prices/relay`                                                                               |
| `apps/price-feed` | The optional nightly price feed, run by `.github/workflows/price-feed.yml`                                                                                                                         |

To add an importer or another plugin, see [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

[AGPL-3.0](LICENSE). If you run a modified copy for others, you must share its source. The components in `apps/web/src/lib/components/ui` come from [shadcn-svelte](https://shadcn-svelte.com) and keep its MIT licence.
