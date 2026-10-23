These fixtures preserve disclosed values, numeric formats and sheet names from
public September 2026 portfolio reports. Workbook styles, embedded objects and
formulas were removed to keep fixtures small; formula results remain values.
Nippon contains selected sheets (Index, GF, IP, GD, GB, SI, MF). PPFAS contains
all seven schemes. Nippon uses OOXML bytes with an `.xls` extension, as does its
official download; PPFAS uses legacy BIFF8 XLS.

Sources retrieved 23 October 2026:

- `ppfas.xls`: https://amc.ppfas.com/downloads/portfolio-disclosure/2026/PPFAS_Monthly_Portfolio_Report_September_30_2026.xls
- `nippon.xls`: https://mf.nipponindiaim.com/InvestorServices/FactsheetsDocuments/NIMF-MONTHLY-PORTFOLIO-30-Sep-26.xls
- `zerodha.xlsx`: https://assets.zerodhafundhouse.com/statutory-reports/portfolio-disclosures/ZEN50-%20Monthly%20Portfolio%20September%202026.xlsx
- `hdfc.xlsx`: https://files.hdfcfund.com/s3fs-public/2026-10/Monthly%20HDFC%20NIFTY%2050%20ETF%20-%2030%20September%202026_0.xlsx?VersionId=XLaspCSqyFTz1m27GXEOGtsZj7yw4tcB

Regression cases include PPFAS's unformatted negative receivables fraction,
HDFC's percentage-point cells, debt with INE ISINs, foreign stock, REITs,
physical gold/silver, ETF units, and trailing derivative disclosures.

Additional live-ingestion regressions preserve values and formats from these
reports (retrieved the same date). The derivative fixture retains its original
65,501-row advertised derivative range, with only actual populated cells kept.

- `hdfc-derivative.xlsx`: https://files.hdfcfund.com/s3fs-public/2026-10/Monthly%20HDFC%20Multi%20Cap%20Fund%20-%2030%20September%202026_0.xlsx?VersionId=X2awJzZRIRNp1f.c.QuHrdtA1nrRBe92
- `hdfc-small-weight.xlsx`: https://files.hdfcfund.com/s3fs-public/2026-10/Monthly%20HDFC%20NIFTY100%20Low%20Volatility%2030%20Index%20Fund%20-%2030%20September%202026_0.xlsx?VersionId=ijOUCX6rSl.T4Xj5LkL31xoXgKBgJ87x
- `hdfc-fmp.xlsx`: https://files.hdfcfund.com/s3fs-public/2026-10/Monthly%20HDFC%20FMP%202638D%20February%202023%20-%2030%20September%202026.xlsx?VersionId=KySUDKBJ_E4vogpTxOnBo5J6wWnpgYnC
- `zerodha-arbitrage.xlsx`: https://assets.zerodhafundhouse.com/statutory-reports/portfolio-disclosures/ZARBI%20-%20Monthly%20Portfolio%20September%202026.xlsx
- `zerodha-hybrid.xlsx`: https://assets.zerodhafundhouse.com/statutory-reports/portfolio-disclosures/ZNH73%20-%20Monthly%20Portfolio%20September%202026.xlsx
