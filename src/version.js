// The package version, read from the manifest rather than duplicated here.
// A version written in two places gets bumped in one.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function version() {
  try {
    const manifest = fileURLToPath(new URL('../package.json', import.meta.url));
    return JSON.parse(readFileSync(manifest, 'utf8')).version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}
