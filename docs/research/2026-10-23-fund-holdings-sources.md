# Indian mutual fund and ETF holdings sources

Verified 23 October 2026. Scope: publicly disclosed underlying holdings and portfolio weights; no implementation or investor account access.

## Recommended starting point

Extend Arthly's public fund-data feed with official AMC monthly portfolio spreadsheets, normalized into a dated JSON dataset. Use AMFI as a directory of AMC disclosure pages. This is a practical low-cost route for a first release; the integration work is collecting different file formats, mapping schemes and securities, and checking completeness. This recommendation is an engineering inference, not a claim that AMFI provides a consolidated holdings API. [AMFI portfolio disclosure directory](https://www.amfiindia.com/online-center/portfolio-disclosure)

SEBI's 20 March 2026 Master Circular, paragraph 6.1.1, requires scheme portfolios with ISINs in downloadable spreadsheet form within 10 calendar days after month-end; debt-scheme fortnightly disclosure has a five-day deadline. Monthly holdings should therefore be presented with their actual portfolio date, rather than as today's positions. [SEBI Master Circular, printed page 86](https://www.sebi.gov.in/sebi_data/attachdocs/mar-2026/1774024028162.pdf)

## Verified free official files

PPFAS publishes a consolidated file and separate scheme files for September 2026 and prior months on its [portfolio disclosure page](https://amc.ppfas.com/downloads/portfolio-disclosure/). The following links resolved to Excel content types during research:

- [September 2026 consolidated XLS](https://amc.ppfas.com/downloads/portfolio-disclosure/2026/PPFAS_Monthly_Portfolio_Report_September_30_2026.xls)
- [Parag Parikh Flexi Cap Fund September 2026 XLSX](https://amc.ppfas.com/downloads/portfolio-disclosure/2026/PPFCF_PPFAS_Monthly_Portfolio_Report_September_30_2026.xlsx)

Implementation follow-up: the per-fund September XLSX was downloaded successfully and workbook cells inspected. Prefer discovering links from the listing over assuming future file names.

HDFC's [monthly portfolio disclosure page](https://www.hdfcfund.com/statutory-disclosure/portfolio/monthly-portfolio) also lists Excel disclosures for mutual funds and ETFs. Use each ETF's disclosed portfolio for actual held securities; a benchmark index's constituents are a separate dataset and should not silently substitute for fund holdings.

## Concrete ingestion discovery, verified in implementation follow-up

Public response samples and representative workbooks are saved under `/tmp/arthly-fund-research/`. These observations describe the current sites, not guaranteed stable public API contracts.

### AMFI central directory

`GET https://www.amfiindia.com/online-center/portfolio-disclosure` returned HTTP 200. Its Next.js React Server Components payload, embedded in `self.__next_f.push(...)` scripts, contains `members`: 57 observed directory entries, 54 with a nonempty `amc_monthly_portfolio_disclosure`. Each has `mf_id`, `mf_name` and AMC disclosure URLs. Parse the push argument as JSON, then find its string payload containing `"members":`; the observed payload is a prefixed JSON React element whose properties object contains that array. Samples: `amfi.html`, `amfi-page-js.js`, `amfi-members.json`.

The page's own JavaScript maps the monthly selection to `amc_monthly_portfolio_disclosure` and opens that URL. It does **not** discover each month's spreadsheets centrally. Use this directory to maintain the AMC registry, then run per-AMC discovery. [AMFI official disclosure directory](https://www.amfiindia.com/online-center/portfolio-disclosure)

### PPFAS

`GET https://amc.ppfas.com/downloads/portfolio-disclosure/index.php` returned HTTP 200 and contains ordinary relative anchor links for consolidated and individual scheme files. The bare trailing-slash URL returned 403 to the same Python client in this pass; the explicit `index.php` worked. Discover `href` attributes ending in `.xls`/`.xlsx` with optional query strings; each month begins with the consolidated file and then per-scheme files. The query string is a publication/cache suffix, not a portfolio-date field. [Official listing](https://amc.ppfas.com/downloads/portfolio-disclosure/index.php)

Verified download: `https://amc.ppfas.com/downloads/portfolio-disclosure/2026/PPFCF_PPFAS_Monthly_Portfolio_Report_September_30_2026.xlsx` — HTTP 200, 96,943 bytes. The sheet is `PPFCF`; title/date precede header row 4. Columns B/C/D/E/F/G are instrument/ISIN/industry/quantity/value in lakhs/% net assets. Cell G7 is raw `0.0775` with percentage formatting, representing 7.75%. Sample: `ppfas-2026-09.xlsx`.

### Nippon India

`GET https://mf.nipponindiaim.com/investor-service/downloads/factsheet-portfolio-and-other-disclosures/` returned HTTP 200 and contains static `li` entries with separate monthly and fortnightly anchor links. Match labels containing monthly portfolio, not every portfolio link. [Official listing](https://mf.nipponindiaim.com/investor-service/downloads/factsheet-portfolio-and-other-disclosures/)

Verified [September 2026 consolidated download](https://mf.nipponindiaim.com/InvestorServices/FactsheetsDocuments/NIMF-MONTHLY-PORTFOLIO-30-Sep-26.xls): HTTP 200, 1,352,141 bytes, 108 sheets. **Despite the `.xls` extension and MIME type, this file is an OOXML ZIP workbook**: sniff bytes or let a capable Excel reader detect the format. The first sheet is an index mapping codes to fund names. It includes active funds and ETFs such as Nifty 50 BeES, Junior BeES and Gold BeES. Example fund sheet header row 4: B ISIN, C instrument, D industry/rating, E quantity, F value in lakhs, G % NAV. G7 raw `0.0322` is formatted as 3.22%. Samples: `nippon.html`, `nippon-2026-09.xls`.

### Zerodha

`GET https://www.zerodhafundhouse.com/resources/disclosures` returned HTTP 200. Read JSON from `<script id="__NEXT_DATA__">`, then `.props.pageProps.initialReports`. Select the report with `id === "portfolio-disclosures"`, then its `.data` entry with `id === "monthly-portfolio-disclosures"`. Its `.files` contains `{id,name,url,modTs}`; 383 historical file entries were observed. `modTs` is publication/modification metadata; use the date inside each workbook as portfolio date. [Official listing](https://www.zerodhafundhouse.com/resources/disclosures)

Verified [September 2026 Nifty 50 ETF XLSX](https://assets.zerodhafundhouse.com/statutory-reports/portfolio-disclosures/ZEN50-%20Monthly%20Portfolio%20September%202026.xlsx): HTTP 200, 126,863 bytes. One sheet `ZEN50`, header row 4: C instrument, D ISIN, E industry/rating, F quantity, G value lakhs, H % NAV. H8 raw `0.1037` is percentage-formatted 10.37%. Samples: `zerodha.html`, `zerodha-nextdata.json`, `zerodha-monthly-files.json`, `zerodha-zen50-2026-09.xlsx`.

### HDFC

The official page loads in a normal browser and exposes SSR JSON in `<script id="__NEXT_DATA__">`: `.props.pageProps.portfolioDataResponse.data.files` contains `{file_id,title,file:{filename,url},extension}`. The rendered latest list contained 111 September 2026 scheme files, including ETFs. Direct shell requests to the page, its observed Next.js data URL and script URL returned 403 in this environment; the file CDN remained accessible. Treat this as a source availability condition and preserve last good data if the relay cannot fetch the listing. [Official listing](https://www.hdfcfund.com/statutory-disclosure/portfolio/monthly-portfolio)

Verified [HDFC Nifty 50 ETF September 2026 XLSX](https://files.hdfcfund.com/s3fs-public/2026-10/Monthly%20HDFC%20NIFTY%2050%20ETF%20-%2030%20September%202026_0.xlsx?VersionId=XLaspCSqyFTz1m27GXEOGtsZj7yw4tcB): HTTP 200, 152,866 bytes. Preserve discovered `VersionId` rather than guessing paths. Header row 5: B ISIN, D instrument, E industry, F quantity, G value lakhs, H % NAV. **H9 raw `10.38` means 10.38 percentage points**, unlike the fraction-valued examples above. Sample: `hdfc-nifty50-2026-09.xlsx`.

### Parsing implications confirmed by samples

- Detect workbook content independently from filename extension; skip index sheets.
- Find normalized header labels rather than fixed column positions, and read the portfolio date inside the file.
- Honor Excel number formatting for percentage fractions; do not infer units solely from a number being below 1, since a genuine 0.20% holding can be stored as `0.20`.
- Preserve instrument group headings and signed weights: derivative hedges, debt, cash and net receivables are relevant to completeness.
- Directory discovery gives broad AMC coverage; successful dated workbook parsing determines actual scheme coverage. A failed source or unknown scheme must stay explicitly unavailable rather than substitute an index portfolio.

## Commercial structured alternatives

| Provider | Evidence of relevant data and delivery | What to establish before integration |
| --- | --- | --- |
| **Accord Fintech ACE Datafeed / ACE MF Nxt** | ACE Datafeed explicitly lists mutual-fund scheme master, NAV history and **latest portfolio**, delivered through **FTP and API**. ACE MF Nxt separately describes comprehensive portfolio data for Indian schemes across **42+ AMCs**. [ACE Datafeed](https://www.accordfintech.com/market-data-feed), [ACE MF Nxt](https://www.accordfintech.com/ace-mf-nxt) | Request a sample constituent-level feed containing security ISIN, weight, portfolio date and scheme IDs. Confirm ETF coverage, full versus partial holdings, historical holdings depth, refresh SLA, corrections and app redistribution rights. The public pages do not establish these details or prices. The application's daily performance refresh does not establish daily portfolio refresh. |
| **Morningstar Data / Direct Web Services** | Official holdings documentation supports full holdings, historical portfolio dates and fields including **ISIN, weight, shares, market value and portfolio date**. It also documents subscription scope and suppression controls. The REST documentation provides a `Full` holdings view; its default is `Top10`, which is insufficient for complete look-through. [Holdings data documentation](https://docs-analyticslab.morningstar.com/morningstar_data/holdings.html), [REST request documentation](https://developer.morningstar.com/direct-web-services/documentation/direct-web-services/investment-details---managed-investments/api-requests) | Validate the actual Indian mutual-fund and ETF universe against Arthly's required scheme list in a vendor sample. Confirm full holdings entitlement, allowed reuse, costs and date freshness. These global product docs establish a real structured holdings product but do not guarantee complete India coverage or an India refresh SLA. |

Neither provider's cited public pages provide enough evidence to quote a price or promise universal Indian ETF coverage. Do not treat third-party “Morningstar India APIs” as official Morningstar licensing evidence.

## Suggested ingestion contract

This is a proposal, not an existing API: retain source URL, portfolio date, fetch time, original file hash, canonical scheme ID, constituent ISIN/name, instrument type, published weight and market value where available. Preserve debt, cash, derivatives and foreign securities rather than renormalizing disclosed equities to 100%. Keep missing/unmapped coverage explicit. Normalize a scheme portfolio separately from plan-level identifiers, after verifying scheme mappings.

The collection step needs only public scheme identifiers; investor holdings can remain in Arthly while local look-through multiplies each fund allocation by its disclosed constituent weights. Use the disclosure's percentage of net assets as the weight basis, preserving its date and units. Multiplying a month-end weight by a user's current fund value produces a dated exposure estimate, not a claim about the fund's current positions.
