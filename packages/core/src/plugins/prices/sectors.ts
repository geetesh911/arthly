// SPDX-License-Identifier: AGPL-3.0-only
// NSE's industry classification (NSE Indices, Industry Classification Structure, July 2023): each
// of its 59 industries belongs to one of 22 sectors. Fund reports name a stock's industry; NSE's
// index lists name its sector, spelled without commas, as here.

/** NSE's 22 sectors and the industries in each. */
export const NSE_SECTORS: Record<string, string[]> = {
  Chemicals: ['Chemicals & Petrochemicals', 'Fertilizers & Agrochemicals'],
  'Construction Materials': ['Cement & Cement Products', 'Other Construction Materials'],
  'Metals & Mining': [
    'Ferrous Metals',
    'Non - Ferrous Metals',
    'Diversified Metals',
    'Minerals & Mining',
    'Metals & Minerals Trading',
  ],
  'Forest Materials': ['Paper, Forest & Jute Products'],
  'Automobile and Auto Components': ['Automobiles', 'Auto Components'],
  'Consumer Durables': ['Consumer Durables'],
  Textiles: ['Textiles & Apparels'],
  'Media Entertainment & Publication': ['Media', 'Entertainment', 'Printing & Publication'],
  Realty: ['Realty'],
  'Consumer Services': ['Leisure Services', 'Other Consumer Services', 'Retailing'],
  'Oil Gas & Consumable Fuels': ['Gas', 'Oil', 'Petroleum Products', 'Consumable Fuels'],
  'Fast Moving Consumer Goods': [
    'Agricultural Food & other Products',
    'Beverages',
    'Cigarettes & Tobacco Products',
    'Food Products',
    'Personal Products',
    'Household Products',
    'Diversified FMCG',
  ],
  'Financial Services': [
    'Finance',
    'Banks',
    'Capital Markets',
    'Insurance',
    'Financial Technology (Fintech)',
  ],
  Healthcare: [
    'Pharmaceuticals & Biotechnology',
    'Healthcare Equipment & Supplies',
    'Healthcare Services',
  ],
  Construction: ['Construction'],
  'Capital Goods': [
    'Aerospace & Defense',
    'Agricultural, Commercial & Construction Vehicles',
    'Electrical Equipment',
    'Industrial Manufacturing',
    'Industrial Products',
  ],
  'Information Technology': ['IT - Software', 'IT - Services', 'IT - Hardware'],
  Services: [
    'Engineering Services',
    'Transport Services',
    'Transport Infrastructure',
    'Commercial Services & Supplies',
    'Public Services',
  ],
  Telecommunication: ['Telecom - Services', 'Telecom - Equipment & Accessories'],
  Power: ['Power'],
  Utilities: ['Other Utilities'],
  Diversified: ['Diversified'],
};

// Reports differ in letter case, spacing and punctuation ("Agricultural Food & Other Products").
const key = (name: string) =>
  name
    .toLowerCase()
    .replaceAll('&', 'and')
    .replace(/[^a-z0-9]+/g, '');

const SECTOR_OF = new Map(
  Object.entries(NSE_SECTORS).flatMap(([sector, industries]) =>
    industries.map((industry) => [key(industry), sector] as const),
  ),
);

/** The NSE sector an industry belongs to, if it's one of NSE's industries. */
export const sectorOfIndustry = (industry: string | undefined): string | undefined =>
  industry ? SECTOR_OF.get(key(industry)) : undefined;
