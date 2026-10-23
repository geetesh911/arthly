// SPDX-License-Identifier: AGPL-3.0-only
import { excelExporter, templateExporter } from './excel/index.ts';
import { jsonExporter } from './json/index.ts';
import type { Exporter } from './types.ts';

export const exporters: Exporter[] = [excelExporter, jsonExporter, templateExporter];
