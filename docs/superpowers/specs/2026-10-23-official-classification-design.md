# Official cap sizes, report sectors and fund-type fallback

## Intended result

Classify more of the portfolio from official sources, so fewer amounts are "Unclassified" in Analytics:

1. Cap sizes come from AMFI's semi-annual stock categorisation, which covers every listed company, instead of Nifty index membership.
2. Sectors use the industry each fund report gives for its holdings, grouped into NSE's sectors, when NSE's index lists don't cover a stock.
3. In the underlying asset split, a fund without a holdings report is shown by its own asset class, marked as an estimate.

## Source findings (23 October 2026)

- AMFI publishes the list on https://www.amfiindia.com/otherdata/categorisation-of-stocks every January and July. The newest file is `https://portal.amfiindia.com/spages/AverageMarketCapitalization30Jun2026.xlsx` (0.6 MB, sheet `FINAL`). Its title row names the period ("…during the six months ended 30 June 2026"); its columns are Sr. No., Company name, ISIN, BSE Symbol, BSE average, NSE Symbol, NSE average, MSEI Symbol, MSEI average, average of all exchanges and "Categorization as per SEBI Circular dated Oct 6, 2017". It has 5,427 companies: 100 Large Cap, 150 Mid Cap and 5,177 Small Cap, every one with an Indian ISIN; a missing exchange symbol is `-`. Both the page and the workbook answer requests from outside a browser. Older files on the page sit under `www.amfiindia.com/Themes/Theme1/downloads/`.
- NSE's Industry Classification Structure (July 2023, https://www.niftyindices.com/resources/industry-classification) has 12 macro-economic sectors, 22 sectors, 59 industries and 197 basic industries. NSE's index lists (`ind_nifty100list.csv` and the others) give the sector level in their "Industry" column, spelled without commas ("Oil Gas & Consumable Fuels", "Media Entertainment & Publication").
- The PPFAS, Nippon India, HDFC and Zerodha reports give each Indian stock's industry using NSE's 59 industry names, apart from letter case ("Agricultural Food & Other Products"). Foreign stocks in PPFAS's report use US-style names and stay unclassified.

## Design

**Cap list.** A core module discovers the newest `AverageMarketCapitalization<day><Mon><year>.xlsx` link on AMFI's page (https only, on `portal.amfiindia.com` or `www.amfiindia.com`), fetches it within a size limit, and parses it into `{ version: 1, date, asOf, url, rows: { isin, nse?, cap }[], warnings?, failure? }`, where `cap` is `large`, `mid` or `small` and `asOf` is the period end read from the title row. Parsing rejects changed headings, an empty list and malformed ISINs; it warns when the counts aren't 100 large and 150 mid caps, and drops ISINs listed twice with different categories.

The relay gains an `amfi-caps` route that returns the workbook itself with its official URL in `x-source-url`; the browser's data worker parses it, because parsing a workbook is too heavy for a Cloudflare request. The optional feed publishes the parsed file as `v1/latest/caps.json.gz`, and the app falls back to the relay when a feed doesn't have it. The worker fetches the list on a forced refresh, when none is saved, when the saved one is more than a week old, or after a failure. A failed fetch keeps the saved list with its own period and says why. The list is saved in the encrypted price cache.

A stock's cap size is AMFI's category for its ISIN, or for its NSE symbol when the holding has no ISIN. Stocks not on the list (such as listings since the period) remain unclassified. There is no micro-cap bucket, since SEBI defines three categories; NSE's lists still supply index member counts.

**Sectors.** A fixed table maps NSE's 59 industries to their 22 sectors, matched ignoring case, spacing and punctuation. A stock's sector is, in order: NSE's index-list sector; its fund report's industry, mapped; the industry any loaded fund report gives the same ISIN, mapped (this covers direct stocks); otherwise unclassified.

**Fund-type fallback.** In the underlying asset split, a fund (or nested fund) without a report counts under its own asset class, such as a gold ETF under Gold and a flexi-cap fund under Equity, which therefore includes whatever cash that fund holds. The amount placed this way is returned separately and shown on the card as "by fund type". Sector and cap-size views don't use the fallback, since a fund's type says nothing about its stocks.

## Status

Implemented 23 October 2026 (`plugins/prices/caps`, `plugins/prices/sectors.ts`, the `amfi-caps` relay route, `v1/latest/caps.json.gz` in the feed, and the Analytics cards). It replaces the Nifty-membership cap proxy in the analytics design, and, for the underlying asset split only, the look-through design's rule that uncovered fund amounts stay unclassified.

## Verification

Fixtures are an unchanged-value excerpt of AMFI's June 2026 list and saved copies of its page links. Tests cover discovery and the URL allowlist, title-date parsing, `-` symbols, category counts, duplicate and malformed rows, validation of saved and feed data, failure retention, the relay route's size limit and headers, the feed and relay clients, the industry table, sector precedence, the fund-type fallback, and the worker's refresh cadence. Then lint, typecheck, unit tests, build and the Playwright suite, plus a live check through the local relay.
