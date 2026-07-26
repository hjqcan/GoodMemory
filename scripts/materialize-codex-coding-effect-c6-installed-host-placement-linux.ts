import { isAbsolute } from "node:path";

import {
  materializeC6InstalledHostPlacementLinux,
} from "./codex-coding-effect/c6-installed-host-placement-linux";
import type {
  C6InstalledHostPlacementLinuxInput,
} from "./codex-coding-effect/c6-installed-host-placement-linux";

const OPTION_NAMES = new Set([
  "closure-root",
  "codex-fixture-root",
  "codex-tarball-root",
  "output",
]);

export interface C6InstalledHostPlacementLinuxCliOptions {
  closureRoot: string;
  codexFixtureRoot: string;
  codexTarballRoot: string;
  outputPath: string;
}

export function parseC6InstalledHostPlacementLinuxCliOptions(
  args: readonly string[],
): C6InstalledHostPlacementLinuxCliOptions {
  const values = new Map<string, string>();
  for (const argument of args) {
    const match = /^--([^=]+)=(.*)$/u.exec(argument);
    if (match === null) {
      throw new Error(
        `invalid C6 placement materializer argument ${argument}`,
      );
    }
    const [, name, value] = match;
    if (!OPTION_NAMES.has(name)) {
      throw new Error(
        `unknown C6 placement materializer option --${name}`,
      );
    }
    if (values.has(name)) {
      throw new Error(`--${name} cannot be specified more than once`);
    }
    if (value.length === 0 || value.trim() !== value) {
      throw new Error(`--${name} must not be empty or padded`);
    }
    if (!isAbsolute(value)) {
      throw new Error(`--${name} must be absolute`);
    }
    values.set(name, value);
  }
  return {
    closureRoot: required(values, "closure-root"),
    codexFixtureRoot: required(values, "codex-fixture-root"),
    codexTarballRoot: required(values, "codex-tarball-root"),
    outputPath: required(values, "output"),
  };
}

export async function runC6InstalledHostPlacementLinuxCommand(
  args: readonly string[],
  dispatch: (
    input: C6InstalledHostPlacementLinuxInput,
  ) => Promise<unknown> = materializeC6InstalledHostPlacementLinux,
): Promise<unknown> {
  return dispatch(parseC6InstalledHostPlacementLinuxCliOptions(args));
}

function required(
  values: ReadonlyMap<string, string>,
  name: string,
): string {
  const value = values.get(name);
  if (value === undefined) {
    throw new Error(`--${name} is required exactly once`);
  }
  return value;
}

if (import.meta.main) {
  try {
    const result = await runC6InstalledHostPlacementLinuxCommand(
      process.argv.slice(2),
    );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
