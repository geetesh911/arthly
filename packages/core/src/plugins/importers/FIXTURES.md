# Importer fixtures

Every file under `*/fixtures/` is synthetic. It copies the layout of a real export (sheet names, headings, summary blocks, number formats) but every name, number, folio, client code, PAN and phone number is made up.

To add a fixture for a new importer:

1. Start from your own export and keep its layout.
2. Replace every personal value: names, PAN, phone, email, address, account, folio and client numbers.
3. Replace every amount, unit count and date with made-up values, keeping the file's own totals equal to the sum of its lines.
4. Run the tests. The personal-data scan fails if a parsed draft contains anything that looks like a PAN, phone number or email.

A PDF fixture starts as an HTML page in the statement's layout, printed to A4 by Chromium (see `epfo-passbook/fixtures/passbook.html`). To learn a PDF's layout without sharing the file, run `node packages/core/scripts/pdf-outline.ts statement.pdf`: it prints each row of text with every name and number masked.
