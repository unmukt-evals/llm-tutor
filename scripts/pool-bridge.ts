// scripts/pool-bridge.ts
// CLI bridge that calls the app's parseModule + validatePool against on-disk
// inputs, so the .mjs generator script can stay plain-Node while still using
// the canonical TS logic in src/lib. Subcommands:
//
//   parse  <module-md-path>      → emits JSON { id, name, track, engineerPass,
//                                              operatorPass, sources, anchors,
//                                              primarySources }
//   validate <pool-json-path>    → exit 0 if valid (prints "OK"); exit 1 if
//                                  invalid (prints "ERROR: <message>")
//
// Read by scripts/generate-pools.mjs via execFile.

import { readFile } from 'node:fs/promises';
import { parseModule } from '@/lib/ingest/parse-module';
import { validatePool } from '@/lib/mcq/repository';

async function main(): Promise<void> {
  const [, , cmd, arg] = process.argv;
  if (!cmd || !arg) {
    console.error('usage: pool-bridge.ts <parse|validate> <path>');
    process.exit(2);
  }

  if (cmd === 'parse') {
    const raw = await readFile(arg, 'utf8');
    const m = parseModule(raw);
    process.stdout.write(
      JSON.stringify({
        id: m.id,
        track: m.track,
        name: m.name,
        primarySources: m.primarySources,
        anchors: m.anchors,
        whyThisMatters: m.whyThisMatters,
        engineerPass: m.passes.engineer ?? '',
        operatorPass: m.passes.operator ?? '',
        sources: m.sources,
      }),
    );
    return;
  }

  if (cmd === 'validate') {
    const raw = await readFile(arg, 'utf8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      console.error(`ERROR: not valid JSON: ${(e as Error).message}`);
      process.exit(1);
    }
    try {
      validatePool(parsed);
      process.stdout.write('OK');
      return;
    } catch (e) {
      console.error(`ERROR: ${(e as Error).message}`);
      process.exit(1);
    }
  }

  console.error(`unknown command: ${cmd}`);
  process.exit(2);
}

void main();
