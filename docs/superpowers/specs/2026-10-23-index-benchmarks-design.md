# Index and benchmark data

## Intended result

Extend the existing whole-market relay and optional public price feed with Indian index and benchmark data. Fetch the full contents of supported official NSE/Nifty and BSE catalogues and daily reports rather than maintaining a small list of popular indices. New indices in those reports should appear without a code change.

The scope is public Indian NSE/Nifty and BSE data. A catalogue entry does not imply that its levels, total-return variant, history or constituent weights are publicly downloadable. Represent each of those capabilities separately. Do not describe this as coverage of every global index or every proprietary benchmark provider.

## Source findings

- The official NSE daily snapshot for 22 October 2026 was fetched successfully: 167 indices with dated OHLC, closing levels, daily points/percentage changes, volume, turnover and optional P/E, P/B and dividend yield. It includes equity, strategy, volatility and selected fixed-income indices, but is not the complete Nifty fixed-income/hybrid catalogue. Sources: https://www.nseindia.com/all-reports and https://www.niftyindices.com/reports/daily-reports .
- The official Nifty historical-data page provides separate index, valuation and total-return views and a broader catalogue. It explicitly identifies fixed-income indices as total return except the clean-price 10-year government-bond index: https://www.niftyindices.com/reports/historical-data .
- BSE publishes an index catalogue and archive interface. Its current backend must be verified before an adapter is called supported. A failed or access-restricted endpoint must appear as a source failure, without guessed data: https://www.bseindia.com/indices/IndexArchiveData.html .
- Public constituent membership is different from constituent weight. Preserve existing NSE classification lists; use additional official membership/weight files only when available and verified. Full daily weights may require a subscribed index-data product.

## Approaches considered

1. **Official bulk reports and catalogues, recommended.** Reuses the app's existing privacy and caching model, covers entire available reports and retains explicit source gaps. Some historical/TRI/weight datasets may remain unavailable publicly.
2. **Fetch a separate quote/history for every index.** Can add individual gaps, but hundreds of upstream calls are unsuitable for a normal relay refresh and would be more fragile. Reserve verified per-index archival jobs for the optional feed, rather than app startup.
3. **Use a commercial market-data provider.** Can provide broader contractual coverage and weights, but needs an account, credentials and an explicit provider choice. It is not a prerequisite for public-source support.

## Data contract

Keep index reference data separate from investible holdings and their prices. Each series has a provider-qualified stable identifier, published name, source URL, currency, published observation date and return basis. Return basis can be price return, total return, net total return, volatility or unknown; do not infer equity TRI from a price index or treat India VIX as an investment-return benchmark.

Latest observations contain a positive finite closing level and optional validated OHLC, daily change, valuation and volume fields. Missing fields stay absent. Daily change and dividend yield percentages must have one documented numeric convention. Preserve each source's actual observation date; a successful retrieval does not make an old observation current.

Store catalogue availability, latest observations, retained history and source failures independently. Merge by provider and series identifier. Failed refreshes keep prior successful observations and their original dates, with a stale/failure indication. Reject HTML error pages, malformed numbers, impossible dates, conflicting duplicate observations and oversized responses before saving data.

## Relay, feed and history

Add a fixed index-data relay route using only official, allowlisted source URLs. Fetch whole bulk datasets without sending portfolio holdings, selected benchmarks or individual scheme identifiers upstream. Apply bounded downloads, timeouts, caching and source-specific failure isolation.

Publish a versioned compressed index-data file through the optional feed and support it in the feed client. Older feeds without that file fall back to the relay. Keep the existing NAV, stock-price, FX and fund-disclosure flows working when index sources fail.

Append observed index closes to retained history without mixing providers or return variants. The optional feed can accumulate and backfill verified public bulk daily archives with bounded concurrency. In the relay-only app, retain observations from successful refreshes. Show the available historical range; never imply that an initial refresh provides an index's complete lifetime history.

Historical returns are only calculated for a requested period when suitable dated observations exist for that same series. Price-return and total-return observations never share a history key. Do not compare portfolio XIRR directly with an unmatched index point-to-point return or generate alpha/beta from insufficient data.

## App integration

Fetch index data alongside the existing data refresh, persist it in the encrypted cache and restore it after unlocking. Index fetches should run even if no particular fund or stock is held. Source failures do not remove saved data or make unrelated successful refreshes fail silently.

Expose a searchable index/benchmark section in Analytics with provider, name, dated closing level, daily change, return basis and source links. Show data coverage, retained-data warnings and available history. Keep public catalogue entries without observations visibly unavailable instead of supplying zero or proxy prices. Provide clear empty and partial-data states on desktop and phone.

Constituent membership/weight availability is displayed separately. A fund's reported portfolio is never presented as the exact index portfolio, and existing market-cap classification remains based on its documented NSE membership proxy.

## Verification

Use source-attributed official fixtures for report and catalogue parsers. Cover complete-report ingestion, quoted CSV fields, missing optional fields, percentage conventions, dates, HTML/errors, PR/TRI separation and duplicate handling. Test allowlists, bounded responses, partial source failures, caching, history merging, legacy-feed fallback, encrypted reload and refresh cadence. Verify the searchable Analytics view and unavailable/stale states on phone and desktop. Run the existing unit, type, lint, build and browser checks before claiming completion.

## Approval status

Implemented 23 October 2026 (`packages/core/src/plugins/prices/indices`, `engine/benchmarks.ts`, the `index-data` relay route, `v1/latest/indices.json.gz` in the feed, and the Analytics card).

Source verification on 23 October 2026:

- NSE's daily snapshot (`nsearchives.nseindia.com/content/indices/ind_close_all_DDMMYYYY.csv`) is supported: 167 indices on 22 October, with archives going back several years.
- BSE's daily all-indices CSV (`www.bseindia.com/downloads/allindices/allindices_DDMMYYYY.csv`) is supported: 134 indices, with archives back to at least January 2025. BSE's index API (`api.bseindia.com/BseIndiaAPI/api/...`) answers non-browser requests with Akamai "Access Denied", so it isn't used.
- Nifty's total return values and its full catalogue (including the fixed-income and hybrid indices missing from the snapshot) only load one index at a time through its historical-data page. They aren't fetched, so the catalogue is the union of series seen in the daily files. Equity series are labelled price return; strategy, dividend-points and BSE bond series are labelled "unknown".
- Percentages (daily change, dividend yield) are stored as fractions; volume in shares and turnover in rupees.
- The relay-only app keeps the closes from its own refreshes. The feed backfills up to 100 missing archive days per exchange per run.
