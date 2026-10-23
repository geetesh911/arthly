# More fund houses for fund look-through

## Intended result

Load the monthly portfolio reports of more AMCs, so funds outside PPFAS, Nippon India, HDFC and Zerodha get sectors, cap sizes and stock exposure instead of staying unclassified. The first eight are SBI, Tata, DSP, Bank of India, Quant, Invesco, Canara Robeco and Mirae Asset.

## Source findings (23 October 2026)

All eight answer both curl and the Cloudflare Workers runtime with the app's own user agent and no other headers. None needs a cookie, token or login.

| AMC | How the files are listed | Files for September 2026 |
| --- | --- | --- |
| SBI | POST to `/ajaxcall/CMS/GetSchemePortfolioSheets` with an empty year and month, which lists every consolidated workbook | 1 xlsx, 2.6 MB, 119 schemes |
| Tata | Escaped JSON in the Next.js page; files on `betacms.tatamutualfund.com` redirect to `www.tatamutualfund.com` | 1 xlsx, 1.8 MB, 68 schemes |
| DSP | Plain links on the portfolio disclosures page | 1 zip of two xlsx, 1.1 MB, 91 schemes |
| Bank of India | POST to `/AjaxService.asmx/GetDocuments` | 1 xlsx, 0.6 MB, 25 schemes |
| Quant | POST to `statutorydisclosures.aspx/displaydisclouser2`, one month at a time | 31 xlsx, 3.5 MB |
| Invesco | GET `/api/CompleteMonthlyHoldings?year=…&classification=…`, six fund types; the month is the JSON key, since file names often lack it | 48 xlsx, 5.3 MB |
| Canara Robeco | The monthly portfolio page filtered by year and month, ten files a page | 27 xlsx, 12 MB |
| Mirae Asset | POST to `/AjaxService/GetDownloadsData` for the monthly tab | 99 xlsx, 17.5 MB |

Not added:

- **Axis.** Its file lists need a bearer token from the site's session, and its robots.txt disallows the API path.
- **Edelweiss.** Akamai refuses every request that isn't from a browser.
- **HDFC.** Its listing now refuses the Workers runtime (Akamai, 403) whatever headers are sent, although Node and curl get through. It stays configured, so it works again if HDFC relents and from a feed that can reach it. The app doesn't try to get around any of these blocks.

No second official copy exists for Axis or Edelweiss. AMFI's portfolio disclosure page only links to each AMC's own page. Axis's fund pages and sitemaps carry no portfolio workbooks or ISINs. Edelweiss refuses every host it runs, including its partner site. Other sites that republish holdings aren't official and usually show only the top ten. Their reports can be [added by hand](#reports-added-by-hand) instead.

## Design

**Sources.** Each AMC keeps its page URL and may add `requests(today)`: the GETs or JSON POSTs its own page script makes, for the two months before today where the AMC lists by month. A source may give dates for files whose names don't say (`dates`), and may have several allowed origins. Zips are allowed workbook files. File-name dates also accept month names run together with the year ("sept2026", "31march2026"). A posted listing is never redirected. The relay makes up to about 30 listing requests per index, below the Workers limit of 50.

**Parser.** Every rule applies to every AMC, and every sheet must still add up to 100% of net assets:

- **Futures counted in the table.** Quant lists futures inside the table at contract value with their offset in net current assets. Bank of India does the same, with fractions as weights. Futures stay out of stock views, as before. When the offset is what keeps the sheet from adding up, it is added back as cash, with a warning.
- **Repeated rows.** Quant sometimes repeats a row. When that is what keeps the sheet from adding up, the repeat is left out, with a warning.
- **Short positions and swaps.** Short legs, rows whose industry says futures or options, and swaps under an "IRS" heading count as derivatives. A cash row ends a derivatives section.
- **Layout variants.**
  - Tiny weights may be marked "@", "*" or "#", when a footnote defines the mark.
  - The weight column may be "% to AUM", and the value column "MKT VAL".
  - Tata's named subtotals, such as "PORTFOLIO TOTAL", are recognised.
  - Dates may be written in figures with the day first ("30-09-26").
  - The date may sit in the cell after "as on".
  - A scheme title may end in "FoF".
  - Edelweiss titles each sheet "PORTFOLIO STATEMENT OF … AS ON …". A year in the name, as in "Bharat Bond ETF – April 2030", stays.
  - An Industry column is preferred over a separate Rating column.
  - "(Formerly known as …)" is dropped from scheme names.
  - Only the first 64 columns are read, since some AMCs declare 256.
- **Sheet failures.** A sheet without a holdings table (risk-o-meters, dividend histories, top-ten summaries) is skipped unless it lists Indian ISINs. When collecting, a scheme that can't be read is reported and the rest of the workbook is kept.

**Matching.** A fund's name also matches a report when only a trailing "Fund" differs, as in a Groww name such as "Example Value Direct Plan Growth". It still has to be the only such report.

**Limits.** A refresh may download up to 600 files and 128 MB in five minutes, four at a time. A new month's reports come to about 60 MB; reports already saved aren't downloaded again.

## Reports added by hand

For fund houses the relay can't reach, someone downloads the monthly portfolio in their own browser and adds it under the fund holdings in Analytics. A workbook or a zip of them is read in the data worker with the same parser and checks, including that each scheme adds up to 100%. Schemes that can't be read are listed; a file with no readable scheme, or one dated after today, is turned down.

- **Storage.** Added reports are sealed on this device under their own key (`added:fund-reports`), apart from the price cache, so a refresh never drops them. They aren't synced or included in backups; they're public files that can be added again.
- **Which report is used.** The newest report of each scheme is kept among the added ones. Analytics uses an added report only when it's newer than any fetched report of the same scheme, and then in its place.
- **Display.** A fund using one shows "Added by you" instead of an official link. The card says how many schemes were added and the newest date. **Remove added reports** forgets all of them, after a confirmation. The Add screen points a portfolio it doesn't recognise to Analytics.

## Verification

Every September 2026 file from the eight AMCs was parsed (90 of 91 parse; Invesco's Gold ETF holds gold and has no ISIN table). Through the local relay in the Workers runtime, the index lists 234 files from 11 AMCs in 3 seconds. A test portfolio of 17 scheme names loaded 641 reports in 22 seconds and matched 15 funds; the other two are Axis and Edelweiss. Adding Edelweiss's September 2026 workbook (76 schemes, all read) and an Axis scheme's by hand matched both, taking fund value covered from 88% to 99.9%, sectors to 99.8% classified and cap sizes to 97%. Unit tests cover each listing request, the dating rules, every parser rule above with synthetic sheets, zips, sheet failures, the name fallback, and added reports: reading, turning down, keeping the newest and replacing older fetched ones. A worker test keeps an added report through a failed refresh and an unlock, and a browser test adds, turns down and removes one at phone and desktop sizes.
