/**
 * Dead-export check for a library with no barrel files.
 *
 * knip is vacuous here: with every module its own entry point nothing ever
 * looks unused. What is actually worth knowing is whether anything outside
 * this package imports a given export, so this resolves the three sibling
 * checkouts the way `vendor-check.ts` does, collects every `interlocking/...`
 * import across them, and diffs that against what `src/` exports.
 *
 * Three verdicts per export:
 *
 * - used: imported by at least one sibling app.
 * - internal: imported only by another module in this package. Not dead -
 *   without barrels a cross-module import needs the export - but it is not
 *   public surface either.
 * - unused: imported by nobody. These are the findings.
 *
 * A sibling that is not checked out is skipped, and the run exits 0 when all
 * three are absent, so CI is never blocked by this. Unused exports are a
 * warning by default, matching vendor-check's staleness pass; `--strict`
 * makes them fatal.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const siblingRoot = resolve(packageRoot, '..');
const SIBLINGS = ['coloring-book', 'test-track', 'yard-master'];

/** Every `.ts` file under `dir`, recursively. */
function tsFiles(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      out.push(...tsFiles(path));
    } else if (path.endsWith('.ts')) {
      out.push(path);
    }
  }
  return out;
}

/** Module specifier a consumer writes for a file in this package's `src/`. */
function specifierFor(file: string): string {
  return `interlocking/${relative(join(packageRoot, 'src'), file).replace(/\.ts$/, '')}`;
}

const EXPORT_DECL =
  /^export\s+(?:declare\s+)?(?:async\s+)?(?:const|let|var|function|class|interface|type|enum)\s+([A-Za-z0-9_$]+)/gm;

function exportedNames(source: string): string[] {
  return [...source.matchAll(EXPORT_DECL)].map((m) => m[1]);
}

/** `{ a, b as c, type D }` -> the names as this package exports them. */
function parseClause(clause: string): string[] {
  const braces = clause.match(/\{([\s\S]*)\}/);
  if (!braces) {
    return [];
  }
  return braces[1]
    .split(',')
    .map((part) =>
      part
        .trim()
        .replace(/^type\s+/, '')
        .split(/\s+as\s+/)[0]
        .trim()
    )
    .filter(Boolean);
}

const IMPORT_STMT =
  /import\s+(?:type\s+)?([\s\S]*?)\s*from\s*['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]/g;

interface Usage {
  /** Specifier -> names imported from it. */
  names: Map<string, Set<string>>;
  /** Specifiers imported wholesale (default, namespace or side-effect). */
  whole: Set<string>;
}

function emptyUsage(): Usage {
  return { names: new Map(), whole: new Set() };
}

function record(
  usage: Usage,
  specifier: string,
  clause: string | undefined
): void {
  if (clause === undefined || !clause.includes('{')) {
    usage.whole.add(specifier);
    return;
  }
  const names = usage.names.get(specifier) ?? new Set<string>();
  for (const name of parseClause(clause)) {
    names.add(name);
  }
  usage.names.set(specifier, names);
  // `import def, { a } from x` also consumes the default.
  if (!/^\s*\{/.test(clause)) {
    usage.whole.add(specifier);
  }
}

/** Imports of `interlocking/...` anywhere under a sibling checkout. */
function collectSiblingImports(repo: string, usage: Usage): void {
  for (const dir of ['src', 'scripts', 'tests']) {
    for (const file of tsFiles(join(repo, dir))) {
      const source = readFileSync(file, 'utf8');
      for (const m of source.matchAll(IMPORT_STMT)) {
        const specifier = m[2] ?? m[3];
        if (!specifier.startsWith('interlocking/')) {
          continue;
        }
        record(usage, specifier, m[2] === undefined ? undefined : m[1]);
      }
    }
  }
}

/** Imports between modules of this package, normalised to the same specifiers. */
function collectInternalImports(usage: Usage): void {
  for (const file of tsFiles(join(packageRoot, 'src'))) {
    const source = readFileSync(file, 'utf8');
    for (const m of source.matchAll(IMPORT_STMT)) {
      const specifier = m[2] ?? m[3];
      if (!specifier.startsWith('.')) {
        continue;
      }
      const target = resolve(dirname(file), specifier.replace(/\.js$/, ''));
      record(
        usage,
        specifierFor(`${target}.ts`),
        m[2] === undefined ? undefined : m[1]
      );
    }
  }
}

const external = emptyUsage();
const internal = emptyUsage();

let present = 0;
for (const sibling of SIBLINGS) {
  const repo = join(siblingRoot, sibling);
  if (!existsSync(repo)) {
    console.log(`skipped  ${sibling} - ${repo} not present`);
    continue;
  }
  present++;
  collectSiblingImports(repo, external);
}

if (present === 0) {
  console.log('check:exports skipped - no sibling repo present');
  process.exit(0);
}

collectInternalImports(internal);

function importsName(usage: Usage, specifier: string, name: string): boolean {
  return (
    usage.whole.has(specifier) ||
    (usage.names.get(specifier)?.has(name) ?? false)
  );
}

const modules = tsFiles(join(packageRoot, 'src')).sort();
let unused = 0;
let internalOnly = 0;
let total = 0;
const unusedModules: string[] = [];

for (const file of modules) {
  const specifier = specifierFor(file);
  const names = exportedNames(readFileSync(file, 'utf8'));
  total += names.length;

  const dead = names.filter(
    (name) =>
      !importsName(external, specifier, name) &&
      !importsName(internal, specifier, name)
  );
  const inner = names.filter(
    (name) =>
      !importsName(external, specifier, name) &&
      importsName(internal, specifier, name)
  );

  internalOnly += inner.length;
  for (const name of inner) {
    console.log(`internal ${specifier}  ${name}`);
  }

  if (dead.length === names.length && names.length > 0) {
    unusedModules.push(specifier);
  }
  unused += dead.length;
  for (const name of dead) {
    console.warn(`UNUSED   ${specifier}  ${name}`);
  }
}

const checked = SIBLINGS.filter((s) => existsSync(join(siblingRoot, s)));
console.log(
  `\n${total} exports across ${modules.length} modules, checked against ${checked.join(', ')}.`
);
console.log(
  `${total - unused - internalOnly} imported by an app, ${internalOnly} internal only, ${unused} unused.`
);

for (const specifier of unusedModules) {
  console.warn(`no import of ${specifier} anywhere`);
}

if (unused > 0 && process.argv.includes('--strict')) {
  process.exit(1);
}
