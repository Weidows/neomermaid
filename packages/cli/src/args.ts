/**
 * Minimal, dependency-free flag parser.
 *
 * Supports `--flag`, `--key value`, `--key=value`, `-o value`, repeated flags
 * (collected into arrays) and `--` to stop parsing. Anything not consumed ends
 * up in `positional`.
 */

export interface ParsedArgs {
  flags: Map<string, string[]>;
  positional: string[];
}

const ALIASES: Record<string, string> = {
  o: 'out',
  t: 'theme',
  p: 'palette',
  f: 'format',
  h: 'help',
  v: 'version',
  j: 'json',
  s: 'scale',
};

export function parseArgs(argv: string[]): ParsedArgs {
  const flags = new Map<string, string[]>();
  const positional: string[] = [];
  let passthrough = false;

  const push = (key: string, value: string) => {
    const existing = flags.get(key);
    if (existing) existing.push(value);
    else flags.set(key, [value]);
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (passthrough) {
      positional.push(arg);
      continue;
    }
    if (arg === '--') {
      passthrough = true;
      continue;
    }
    if (arg.startsWith('--')) {
      const body = arg.slice(2);
      const eq = body.indexOf('=');
      if (eq !== -1) {
        push(body.slice(0, eq), body.slice(eq + 1));
        continue;
      }
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('-')) {
        push(body, next);
        i += 1;
      } else {
        push(body, 'true');
      }
      continue;
    }
    if (arg.startsWith('-') && arg.length > 1) {
      const key = ALIASES[arg.slice(1)] ?? arg.slice(1);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('-')) {
        push(key, next);
        i += 1;
      } else {
        push(key, 'true');
      }
      continue;
    }
    positional.push(arg);
  }

  return { flags, positional };
}

export interface FlagReader {
  get(name: string): string | undefined;
  all(name: string): string[];
  bool(name: string): boolean;
  number(name: string): number | undefined;
  has(name: string): boolean;
}

export function reader(parsed: ParsedArgs): FlagReader {
  const { flags } = parsed;
  return {
    get: (name) => flags.get(name)?.[flags.get(name)!.length - 1],
    all: (name) => flags.get(name) ?? [],
    has: (name) => flags.has(name),
    bool: (name) => {
      const value = flags.get(name)?.at(-1);
      if (value === undefined) return false;
      return value !== 'false' && value !== '0' && value !== 'no';
    },
    number: (name) => {
      const value = flags.get(name)?.at(-1);
      if (value === undefined) return undefined;
      const n = Number(value);
      return Number.isFinite(n) ? n : undefined;
    },
  };
}
