# Portfolio analytics

Add an Analytics screen accessible from Home, the desktop sidebar and More on phones. It follows the member filter and values everything in INR using the existing engine.

Show asset class and instrument splits for the whole portfolio; NSE industry allocation for direct stocks; market-cap categories for equity stocks and funds; consolidated stock concentration; and active/passive strategies for funds and ETFs. All percentages use the explicitly labelled eligible subtotal. Missing classifications remain visible and coverage is value weighted. Fund categories describe mandates, never invented constituent weights. Hybrid and diversified funds are not decomposed into underlying securities. NSE cap buckets are index-membership proxies, identified as such.

Fetch whole NSE Nifty 100, Midcap 150, Smallcap 250 and Microcap 250 constituent CSVs through the existing relay and optional public feed. Preserve the last successful metadata when a refresh fails. Match by ISIN first and symbol second. Reuse the existing AMFI scheme list by code/ISIN. Keep reference data in the encrypted cache; never send holdings upstream.

Planning views include consolidated top holdings, cash versus retirement assets, scheduled maturities over the next year, currency denomination, valuation freshness, and editable target allocation with signed amounts to add/reduce. Targets start at current allocation, require a 100% total, and can be saved as an encrypted portfolio setting. These are user scenarios, with no model return assumptions or buy/sell recommendations.

Verify arithmetic, duplicate holdings, unknown categories, edge cases, source failure/caching, member filters and target validation with unit tests; verify phone/desktop navigation and layout plus planning controls in Playwright.
