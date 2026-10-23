// SPDX-License-Identifier: AGPL-3.0-only
// The JSON export: the current state of every record, not the change log.
import { all } from '../../../log/replay.ts';
import { ENTITY_NAMES, type EntityMap, type EntityName } from '../../../model/types.ts';
import { utf8 } from '../../../util/bytes.ts';
import type { Exporter } from '../types.ts';

export interface JsonExport {
  format: 'portfolio-export';
  version: 1;
  exportedAt: string;
  entities: { [K in EntityName]?: EntityMap[K][] };
}

export const jsonExporter: Exporter = {
  id: 'json',
  label: 'JSON',
  extension: '.json',
  mime: 'application/json',
  encrypted: false,
  async run({ state }) {
    const entities: JsonExport['entities'] = {};

    for (const name of ENTITY_NAMES) {
      (entities as Record<string, unknown[]>)[name] = all(state, name);
    }

    const file: JsonExport = {
      format: 'portfolio-export',
      version: 1,
      exportedAt: new Date().toISOString(),
      entities,
    };

    return utf8.encode(JSON.stringify(file, null, 1));
  },
};
