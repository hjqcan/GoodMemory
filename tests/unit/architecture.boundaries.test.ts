import { describe, expect, it } from "bun:test";
import { access, readFile, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import ts from "typescript";
import * as reporting from "../../src/eval/reporting";

const SRC_ROOT = join(import.meta.dir, "../../src");
const STORAGE_IMPLEMENTATION_FILES = new Set([
  "storage/memory.ts",
  "storage/postgres.ts",
  "storage/repositories.ts",
  "storage/sqlite.ts",
]);
const STORAGE_PORTS_FILE = "storage/ports.ts";
const CORE_CONTRACT_FILES = new Set([
  "embedding/contracts.ts",
  "evidence/contracts.ts",
  "evolution/contracts.ts",
  "storage/contracts.ts",
]);
const ANSWER_MODULE_MAX_LINES = 550;
const RECALL_SELECTION_MAX_LINES = 300;
const RECALL_SELECTOR_MAX_LINES = 900;
const RECALL_FACT_SELECTION_MAX_LINES = 350;
const RECALL_FACT_SELECTION_FILE_LIMIT = 14;
const RECALL_SELECTOR_TOP_LEVEL_FILE_LIMIT = 35;
const SOURCE_ORDER_SELECTOR_TOP_LEVEL_FILE_LIMIT = 25;
const ALLOWED_RECALL_SELECTION_QUERY_IMPORTS = new Set([
  "selectContradictionEvidencePair",
  "resolveContradictionSelection",
  "selectSourceOrderedInformationExtractionEvidence",
  "selectSourceOrderedInstructionEvidence",
  "selectSourceOrderedPreferenceEvidence",
  "selectSourceOrderedReasoningBridgeEvidence",
  "selectSourceOrderedSummaryCoverage",
  "selectSourceOrderedTemporalIntervalEvidence",
  "selectSourceOrderedTimelineIntegrationEvidence",
]);
const DISALLOWED_SELECTOR_FILENAME_PATTERN =
  /(?:Alexis|Greg|Kimberly|Stephen|FlaskLogin|WeatherAutocomplete|AiHiring|Sneaker)/u;
const DISALLOWED_SELECTOR_RUNTIME_FIXTURE_PATTERN =
  /\b(?:ashlee|bay-street|bay\s+street|laura|mason|michael|michele|patrick|robert|stephanie|thomas)\b/iu;
const PRODUCTION_MEMORY_DIRECTORIES = [
  "api",
  "answer",
  "recall",
  "remember",
  "runtime",
] as const;
const LANGUAGE_RULE_SCAN_EXCLUDED_PREFIXES = [
  "eval/",
  "language/",
  "testing/",
] as const;
const BENCHMARK_METADATA_IDENTIFIERS = new Set([
  "caseId",
  "expectedAnswer",
  "goldEvidence",
  "goldEvidenceIds",
  "questionType",
  "rubric",
  "rubricItems",
]);
const internalImportEdgesCache = new Map<string, Promise<string[]>>();
const sourceCache = new Map<string, Promise<string>>();
const typeScriptFilesCache = new Map<string, Promise<string[]>>();

const NATURAL_LANGUAGE_RULE_TERMS = new Set([
  "always",
  "avoid",
  "before",
  "begin",
  "called",
  "choose",
  "close",
  "command",
  "correction",
  "dear",
  "directory",
  "failure",
  "first",
  "folder",
  "greet",
  "instead",
  "name",
  "never",
  "only",
  "open",
  "prefer",
  "proceed",
  "requests",
  "return",
  "safe",
  "sign",
  "start",
  "subject",
  "success",
  "term",
  "using",
  "warn",
  "when",
  "with",
]);

async function collectTypeScriptFiles(directory: string): Promise<string[]> {
  const cached = typeScriptFilesCache.get(directory);
  if (cached) {
    return cached;
  }
  const pending = collectTypeScriptFilesUncached(directory);
  typeScriptFilesCache.set(directory, pending);
  return pending;
}

async function collectTypeScriptFilesUncached(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectTypeScriptFiles(fullPath));
      continue;
    }

    if (entry.isFile() && fullPath.endsWith(".ts")) {
      files.push(fullPath);
    }
  }

  return files;
}

function readSource(file: string): Promise<string> {
  const cached = sourceCache.get(file);
  if (cached) {
    return cached;
  }
  const pending = readFile(file, "utf8");
  sourceCache.set(file, pending);
  return pending;
}

async function collectTopLevelTypeScriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => join(directory, entry.name));
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function normalizeInternalPath(path: string): string {
  return path.replaceAll("\\", "/");
}

function collectNaturalLanguageRuleLiterals(input: {
  file: string;
  source: string;
}): string[] {
  const sourceFile = ts.createSourceFile(
    input.file,
    input.source,
    ts.ScriptTarget.Latest,
    true,
  );
  const offenders: string[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isRegularExpressionLiteral(node)) {
      const testCall = ts.isPropertyAccessExpression(node.parent) &&
          node.parent.name.text === "test" &&
          ts.isCallExpression(node.parent.parent)
        ? node.parent.parent
        : undefined;
      const testedIdentifier = testCall?.arguments[0];
      const isTechnicalLabelGrammar = Boolean(
        testedIdentifier &&
          ts.isIdentifier(testedIdentifier) &&
          /label$/iu.test(testedIdentifier.text),
      );
      const words = node.getText(sourceFile)
        .match(/[A-Za-z][A-Za-z'’-]*/gu)
        ?.map((word) => word.toLowerCase()) ?? [];
      const splitCall = ts.isCallExpression(node.parent) &&
          node.parent.arguments.includes(node) &&
          ts.isPropertyAccessExpression(node.parent.expression) &&
          node.parent.expression.name.text === "split"
        ? node.parent
        : undefined;
      const containsNaturalLanguageSeparator = Boolean(
        splitCall && (
          /\\bbut\\b/iu.test(node.text) ||
          /[，；]|\\u(?:FF0C|FF1B)/iu.test(node.text)
        ),
      );
      if (
        !isTechnicalLabelGrammar &&
        (
          containsNaturalLanguageSeparator ||
          new Set(words.filter((word) => NATURAL_LANGUAGE_RULE_TERMS.has(word))).size >= 2
        )
      ) {
        offenders.push(`${input.file}:${sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
      }
    }

    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ["endsWith", "includes", "startsWith"].includes(node.expression.name.text)
    ) {
      const value = node.arguments[0];
      if (value && (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value))) {
        const isProtocolIdentifier = /^[A-Za-z0-9]+(?:_[A-Za-z0-9]+)+$/u.test(
          value.text,
        );
        const words = value.text.match(/[A-Za-z][A-Za-z'’-]*/gu)
          ?.map((word) => word.toLowerCase()) ?? [];
        if (
          !isProtocolIdentifier &&
          new Set(words.filter((word) => NATURAL_LANGUAGE_RULE_TERMS.has(word))).size >= 2
        ) {
          offenders.push(`${input.file}:${sourceFile.getLineAndCharacterOfPosition(value.getStart()).line + 1}`);
        }
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return offenders;
}

function toSourceRelativePath(path: string): string {
  return normalizeInternalPath(relative(SRC_ROOT, path));
}

function collectRelativeModuleSpecifiers(source: string): string[] {
  const moduleReferences = ts.preProcessFile(source, true, true).importedFiles;
  const specifiers = new Set<string>();

  for (const { fileName } of moduleReferences) {
    if (fileName.startsWith("./") || fileName.startsWith("../")) {
      specifiers.add(fileName);
    }
  }

  return [...specifiers];
}

async function resolveInternalImport(
  file: string,
  specifier: string,
): Promise<string | null> {
  const targetBase = resolve(dirname(file), specifier);
  const candidates = [
    `${targetBase}.ts`,
    join(targetBase, "index.ts"),
  ];

  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      return toSourceRelativePath(candidate);
    }
  }

  return null;
}

async function collectInternalImportEdges(file: string): Promise<string[]> {
  const cached = internalImportEdgesCache.get(file);
  if (cached) {
    return cached;
  }
  const pending = (async () => {
    const source = await readSource(file);
    const targets = new Set<string>();

    for (const specifier of collectRelativeModuleSpecifiers(source)) {
      const target = await resolveInternalImport(file, specifier);
      if (target) {
        targets.add(target);
      }
    }

    return [...targets];
  })();
  internalImportEdgesCache.set(file, pending);
  return pending;
}

async function collectImportedBindingsForTarget(
  file: string,
  targetPath: string,
): Promise<string[]> {
  const source = await readSource(file);
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const bindings = new Set<string>();

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) {
      continue;
    }

    const moduleSpecifier = statement.moduleSpecifier;
    if (!ts.isStringLiteral(moduleSpecifier)) {
      continue;
    }

    const specifier = moduleSpecifier.text;
    if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
      continue;
    }

    const resolvedTarget = await resolveInternalImport(file, specifier);
    if (resolvedTarget !== targetPath) {
      continue;
    }

    const importClause = statement.importClause;
    if (!importClause?.namedBindings || !ts.isNamedImports(importClause.namedBindings)) {
      continue;
    }

    for (const element of importClause.namedBindings.elements) {
      bindings.add(element.propertyName?.text ?? element.name.text);
    }
  }

  return [...bindings];
}

function isCoreContractFile(relativePath: string): boolean {
  const normalizedPath = normalizeInternalPath(relativePath);
  return (
    normalizedPath.startsWith("domain/") ||
    CORE_CONTRACT_FILES.has(normalizedPath)
  );
}

function isCoreBehaviorFile(relativePath: string): boolean {
  const normalizedPath = normalizeInternalPath(relativePath);
  return (
    normalizedPath.startsWith("governance/") ||
    normalizedPath.startsWith("maintenance/") ||
    normalizedPath.startsWith("recall/") ||
    normalizedPath.startsWith("remember/") ||
    normalizedPath.startsWith("runtime/") ||
    normalizedPath.startsWith("verify/") ||
    (
      normalizedPath.startsWith("evolution/") &&
      normalizedPath !== "evolution/contracts.ts"
    )
  );
}

function allowedStoragePortBindings(relativePath: string): Set<string> {
  const normalizedPath = normalizeInternalPath(relativePath);

  if (normalizedPath.startsWith("remember/")) {
    return new Set([
      "RememberRepositoryPort",
      "RememberVectorPort",
    ]);
  }

  if (normalizedPath.startsWith("recall/")) {
    return new Set([
      "RecallRepositoryPort",
      "RecallRuntimePort",
      "RecallVectorSearchPort",
    ]);
  }

  if (normalizedPath.startsWith("maintenance/")) {
    return new Set([
      "MaintenanceRepositoryPort",
      "MaintenanceVectorPort",
    ]);
  }

  if (normalizedPath.startsWith("evolution/")) {
    return new Set([
      "EvolutionRepositoryPort",
    ]);
  }

  return new Set();
}

describe("architecture boundaries", () => {
  it("detects ASCII natural-language admission regexes outside language packs", () => {
    expect(collectNaturalLanguageRuleLiterals({
      file: "sample.ts",
      source:
        "export const matches = (text: string) => /only proceed when ready/.test(text);",
    })).toEqual(["sample.ts:1"]);
  });

  it("detects natural-language clause separators outside language packs", () => {
    expect(collectNaturalLanguageRuleLiterals({
      file: "sample.ts",
      source: String.raw`export const split = (text: string) => text.split(/[;]+|\bbut\b/iu);`,
    })).toEqual(["sample.ts:1"]);

    expect(collectNaturalLanguageRuleLiterals({
      file: "sample.ts",
      source: String.raw`export const split = (text: string) => text.split(/[，；]+/u);`,
    })).toEqual(["sample.ts:1"]);
  });

  it("keeps built-in language analyzers free of runtime NLP dependencies", async () => {
    const packageJson = JSON.parse(
      await readFile(join(import.meta.dir, "../../package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };
    const languageFiles = await collectTypeScriptFiles(join(SRC_ROOT, "language"));
    const languageSources = await Promise.all(
      languageFiles.map((file) => readFile(file, "utf8")),
    );

    expect(packageJson.dependencies?.["opencc-js"]).toBeUndefined();
    expect(languageSources.some((source) => /from ["']opencc-js/u.test(source))).toBe(
      false,
    );
  });
  it("treats re-exports as internal dependency edges", async () => {
    expect(
      await collectInternalImportEdges(join(SRC_ROOT, "language", "index.ts")),
    ).toEqual([
      "language/contracts.ts",
      "language/chinese.ts",
      "language/english.ts",
      "language/french.ts",
      "language/generic.ts",
      "language/japanese.ts",
      "language/korean.ts",
      "language/service.ts",
      "language/spanish.ts",
    ]);
  });

  it("keeps concrete language packs behind the language module boundary", async () => {
    const files = await collectTypeScriptFiles(SRC_ROOT);
    const concretePackImport = /language\/(?:chinese|english|french|generic|japanese|korean|spanish)(?:Semantics|Temporal)?["']/u;
    const offenders: string[] = [];
    const legacyAdapters: string[] = [];

    for (const file of files) {
      const relativePath = toSourceRelativePath(file);
      const source = await readSource(file);
      if (!relativePath.startsWith("language/") && concretePackImport.test(source)) {
        offenders.push(relativePath);
      }
      if (source.includes("LanguageAdapter")) {
        legacyAdapters.push(relativePath);
      }
    }

    expect(offenders).toEqual([]);
    expect(legacyAdapters).toEqual([]);
  });

  it("keeps locale and script heuristics inside the language boundary", async () => {
    const scriptOffenders: string[] = [];
    const localeFallbackOffenders: string[] = [];
    const storageLanguageImports: string[] = [];

    const files = await collectTypeScriptFiles(SRC_ROOT);
    for (const file of files) {
      const relativePath = toSourceRelativePath(file);
      if (relativePath.startsWith("language/")) {
        continue;
      }
      const source = await readSource(file);
      if (/\\p\{Script(?:_Extensions)?=/u.test(source)) {
        scriptOffenders.push(relativePath);
      }
      if (
        /\b(?:defaultLocale|locale)\b[^\n]*(?:\?\?|\|\|)\s*["'](?:en|zh|ja|ko|fr|es)(?:-[^"']+)?["']/u.test(
          source,
        )
      ) {
        localeFallbackOffenders.push(relativePath);
      }
      if (
        relativePath.startsWith("storage/") &&
        (await collectInternalImportEdges(file)).some((target) =>
          target.startsWith("language/"),
        )
      ) {
        storageLanguageImports.push(relativePath);
      }
    }

    expect(scriptOffenders).toEqual([]);
    expect(localeFallbackOffenders).toEqual([]);
    expect(storageLanguageImports).toEqual([]);
  });

  it("keeps ASCII natural-language rule matching inside the language boundary", async () => {
    const offenders: string[] = [];
    const files = await collectTypeScriptFiles(SRC_ROOT);
    for (const file of files) {
      const relativePath = toSourceRelativePath(file);
      if (LANGUAGE_RULE_SCAN_EXCLUDED_PREFIXES.some((prefix) =>
        relativePath.startsWith(prefix)
      )) {
        continue;
      }
      const source = await readSource(file);
      offenders.push(...collectNaturalLanguageRuleLiterals({
        file: relativePath,
        source,
      }));
    }

    expect(offenders).toEqual([]);
  });

  it("keeps recall bridge and progressive scoring language-pack driven", async () => {
    const iterativeRecall = await readSource(
      join(SRC_ROOT, "recall", "iterativeRecall.ts"),
    );
    const generalizedFusion = await readSource(
      join(SRC_ROOT, "recall", "generalizedFusion.ts"),
    );
    const progressiveRecall = await readSource(
      join(SRC_ROOT, "progressive", "recall.ts"),
    );

    expect(iterativeRecall).not.toContain("BRIDGE_STOPWORDS");
    expect(iterativeRecall).not.toContain("[A-Za-z0-9][A-Za-z0-9'-]");
    expect(generalizedFusion).not.toContain('toLocaleLowerCase("en-US")');
    expect(progressiveRecall).not.toContain("match(/[a-z0-9_\\-]+/gu)");
  });

  it("normalizes internal paths before boundary checks", () => {
    expect(isCoreContractFile("domain\\record.ts")).toBe(true);
    expect(isCoreBehaviorFile("remember\\engine.ts")).toBe(true);
  });

  it("disallows src internals from importing the public barrel", async () => {
    const files = await collectTypeScriptFiles(SRC_ROOT);
    const offenders: string[] = [];
    const relativeIndexImportPattern = /from\s+["'](?:\.\.?\/)+index(?:\.ts)?["']/;
    const absoluteIndexImportPattern = /from\s+["'][^"']*src\/index(?:\.ts)?["']/;

    for (const file of files) {
      if (file === join(SRC_ROOT, "index.ts")) {
        continue;
      }

      const source = await readFile(file, "utf8");
      if (
        relativeIndexImportPattern.test(source) ||
        absoluteIndexImportPattern.test(source)
      ) {
        offenders.push(toSourceRelativePath(file));
      }
    }

    expect(offenders).toEqual([]);
  });

  it("keeps raw repository and engine assembly out of the root public barrel", async () => {
    const source = await readFile(join(SRC_ROOT, "index.ts"), "utf8");

    expect(source).not.toContain('export { createMemoryRepositories } from "./storage/repositories"');
    expect(source).not.toContain('export { createRecallEngine } from "./recall/engine"');
    expect(source).not.toContain('export { createRememberEngine } from "./remember/engine"');
    expect(source).not.toContain("MemoryRepositoriesConfig");
    expect(source).not.toContain("RecallEngineConfig");
    expect(source).not.toContain("InternalRecallResult");
  });

  it("keeps createGoodMemory composed from narrow governance ports instead of MemoryRepositories typing", async () => {
    const source = await readFile(
      join(SRC_ROOT, "api", "createGoodMemory.ts"),
      "utf8",
    );

    expect(source).not.toMatch(/\bMemoryRepositories\b/);
    expect(source).toContain("GovernanceRepositoryPort");
    expect(source).toContain("createEvolutionRuntime");
  });

  it("keeps core contracts isolated from api, eval, adapters, and storage implementations", async () => {
    const files = await collectTypeScriptFiles(SRC_ROOT);
    const offenders: Array<{ file: string; targets: string[] }> = [];

    for (const file of files) {
      const relativePath = toSourceRelativePath(file);
      if (!isCoreContractFile(relativePath)) {
        continue;
      }

      const targets = await collectInternalImportEdges(file);
      const disallowedTargets = targets.filter((target) => {
        return (
          target === "cli.ts" ||
          target.startsWith("api/") ||
          target.startsWith("eval/") ||
          target.startsWith("llm/") ||
          target.startsWith("provider/") ||
          (target.startsWith("storage/") && target !== "storage/contracts.ts")
        );
      });

      if (disallowedTargets.length > 0) {
        offenders.push({
          file: relativePath,
          targets: disallowedTargets,
        });
      }
    }

    expect(offenders).toEqual([]);
  });

  it("keeps core behavior isolated from api, eval, adapters, and storage implementations", async () => {
    const files = await collectTypeScriptFiles(SRC_ROOT);
    const offenders: Array<{ file: string; targets: string[] }> = [];

    for (const file of files) {
      const relativePath = toSourceRelativePath(file);
      if (!isCoreBehaviorFile(relativePath)) {
        continue;
      }

      const targets = await collectInternalImportEdges(file);
      const disallowedTargets = targets.filter((target) => {
        return (
          target === "cli.ts" ||
          target.startsWith("api/") ||
          target.startsWith("eval/") ||
          target.startsWith("llm/") ||
          target.startsWith("provider/") ||
          STORAGE_IMPLEMENTATION_FILES.has(target)
        );
      });

      if (disallowedTargets.length > 0) {
        offenders.push({
          file: relativePath,
          targets: disallowedTargets,
        });
      }
    }

    expect(offenders).toEqual([]);
  });

  it("keeps subsystem ports scoped to their owning core behavior directories", async () => {
    const files = await collectTypeScriptFiles(SRC_ROOT);
    const offenders: Array<{ file: string; bindings: string[] }> = [];

    for (const file of files) {
      const relativePath = toSourceRelativePath(file);
      if (!isCoreBehaviorFile(relativePath)) {
        continue;
      }

      const importedBindings = await collectImportedBindingsForTarget(
        file,
        STORAGE_PORTS_FILE,
      );
      const allowedBindings = allowedStoragePortBindings(relativePath);
      const disallowedBindings = importedBindings.filter(
        (binding) => !allowedBindings.has(binding),
      );

      if (disallowedBindings.length > 0) {
        offenders.push({
          file: relativePath,
          bindings: disallowedBindings,
        });
      }
    }

    expect(offenders).toEqual([]);
  });

  it("limits storage repository wiring to composition and public compatibility layers", async () => {
    const files = await collectTypeScriptFiles(SRC_ROOT);
    const allowedFiles = new Set([
      "api/createGoodMemory.ts",
      "index.ts",
      "storage/repositories.ts",
    ]);
    const offenders: Array<{ file: string; targets: string[] }> = [];

    for (const file of files) {
      const relativePath = toSourceRelativePath(file);
      if (allowedFiles.has(relativePath)) {
        continue;
      }

      const targets = await collectInternalImportEdges(file);
      const disallowedTargets = targets.filter(
        (target) => target === "storage/repositories.ts",
      );

      if (disallowedTargets.length > 0) {
        offenders.push({
          file: relativePath,
          targets: disallowedTargets,
        });
      }
    }

    expect(offenders).toEqual([]);
  });

  it("removes the legacy llm directory and blocks any internal reintroduction", async () => {
    const files = await collectTypeScriptFiles(SRC_ROOT);
    const offenders: Array<{ file: string; targets: string[] }> = [];

    for (const file of files) {
      const relativePath = toSourceRelativePath(file);
      const targets = await collectInternalImportEdges(file);
      const disallowedTargets = targets.filter((target) =>
        target.startsWith("llm/"),
      );

      if (disallowedTargets.length > 0) {
        offenders.push({
          file: relativePath,
          targets: disallowedTargets,
        });
      }
    }

    expect(offenders).toEqual([]);
    expect(await fileExists(join(SRC_ROOT, "llm", "ai-sdk-runtime.ts"))).toBe(false);
  });

  it("keeps provider-backed memory extraction outside the remember directory", async () => {
    expect(
      await fileExists(join(SRC_ROOT, "remember/llm-extractor.ts")),
    ).toBe(false);

    const providerLayerSource = await readFile(
      join(SRC_ROOT, "provider/layer.ts"),
      "utf8",
    );

    expect(providerLayerSource).toContain('from "./memory-extractor"');
    expect(providerLayerSource).not.toContain("../remember/llm-extractor");
  });

  it("keeps the AI SDK adapter on the runtime-kit lifecycle instead of a duplicate memory loop", async () => {
    const source = await readFile(join(SRC_ROOT, "ai-sdk", "public.ts"), "utf8");

    expect(source).toContain("createGoodMemoryRuntimeKit");
    expect(source).not.toContain("config.memory.recall");
    expect(source).not.toContain("config.memory.buildContext");
    expect(source).not.toContain("config.memory.remember");
    expect(source).not.toContain("input.memory.recall");
    expect(source).not.toContain("input.memory.buildContext");
    expect(source).not.toContain("input.memory.remember");
  });

  it("keeps the eval protocol reader isolated and bounded", async () => {
    expect(await fileExists(join(SRC_ROOT, "answer/evidencePack.ts"))).toBe(false);
    expect(await fileExists(join(SRC_ROOT, "answer/operations/count.ts"))).toBe(false);

    // These prompts are measured benchmark behavior. They remain eval-only and
    // split by operation so protocol compatibility cannot regrow a monolith.
    const answerFiles = await collectTypeScriptFiles(
      join(SRC_ROOT, "eval/protocol-reader"),
    );
    const oversized: Array<{ file: string; lines: number }> = [];
    for (const file of answerFiles) {
      const lines = (await readFile(file, "utf8")).split("\n").length;
      if (lines > ANSWER_MODULE_MAX_LINES) {
        oversized.push({ file: toSourceRelativePath(file), lines });
      }
    }
    expect(oversized).toEqual([]);
  });

  it("keeps benchmark metadata and eval readers out of production memory layers", async () => {
    const evalImportOffenders: Array<{ file: string; targets: string[] }> = [];
    const metadataOffenders: Array<{ file: string; identifiers: string[] }> = [];

    for (const directory of PRODUCTION_MEMORY_DIRECTORIES) {
      const files = await collectTypeScriptFiles(join(SRC_ROOT, directory));
      for (const file of files) {
        const relativePath = toSourceRelativePath(file);
        const targets = await collectInternalImportEdges(file);
        const evalTargets = targets.filter((target) => target.startsWith("eval/"));
        if (evalTargets.length > 0) {
          evalImportOffenders.push({ file: relativePath, targets: evalTargets });
        }

        const source = await readSource(file);
        const sourceFile = ts.createSourceFile(
          relativePath,
          source,
          ts.ScriptTarget.Latest,
          true,
          ts.ScriptKind.TS,
        );
        const identifiers = new Set<string>();
        const visit = (node: ts.Node): void => {
          if (
            ts.isIdentifier(node) &&
            BENCHMARK_METADATA_IDENTIFIERS.has(node.text)
          ) {
            identifiers.add(node.text);
          }
          ts.forEachChild(node, visit);
        };
        visit(sourceFile);
        if (identifiers.size > 0) {
          metadataOffenders.push({
            file: relativePath,
            identifiers: [...identifiers].sort(),
          });
        }
      }
    }

    expect(evalImportOffenders).toEqual([]);
    expect(metadataOffenders).toEqual([]);
  });

  it("keeps generic ledger rendering in answer while eval owns only format selection", async () => {
    const answerRenderer = join(
      SRC_ROOT,
      "answer/evidenceLedgerContext.ts",
    );
    expect(await fileExists(answerRenderer)).toBe(true);

    const answerSource = await readFile(answerRenderer, "utf8");
    const evalSource = await readFile(
      join(SRC_ROOT, "eval/evidenceLedgerFormats.ts"),
      "utf8",
    );
    expect(answerSource).not.toContain("../eval/");
    expect(evalSource).toContain("../answer/evidenceLedgerContext");
  });

  it("keeps legacy-fitted temporal and topic selectors out of production recall", async () => {
    const productionSelectorDirectory = join(SRC_ROOT, "recall", "selectors");
    const legacySelectorDirectory = join(
      import.meta.dir,
      "../..",
      "scripts/eval-profiles/legacy-fitted/recall/selectors",
    );

    expect(await fileExists(join(productionSelectorDirectory, "temporal.ts"))).toBe(false);
    expect(await fileExists(join(productionSelectorDirectory, "topic.ts"))).toBe(false);

    for (const fileName of ["temporal.ts", "topic.ts"]) {
      const source = await readFile(join(legacySelectorDirectory, fileName), "utf8");
      expect(source).not.toContain("src/recall/selectors");
    }

    const activeContext = await readFile(
      join(productionSelectorDirectory, "selectionContext.ts"),
      "utf8",
    );
    expect(activeContext).not.toMatch(
      /(?:isTemporalEventOrderQuery|isInstrumentPracticeTimeQuery|PERSONAL_ELECTRONICS_FACT_PATTERN|QUANTIFIED_FACT_PATTERN)/u,
    );
  });

  it("keeps legacy fact selection instance-scoped and out of production state", async () => {
    const selectionSource = await readSource(
      join(SRC_ROOT, "recall", "selection.ts"),
    );
    const engineSource = await readSource(join(SRC_ROOT, "recall", "engine.ts"));
    const apiSource = await readSource(join(SRC_ROOT, "api", "createGoodMemory.ts"));
    const legacyActivationSource = await readFile(
      join(
        import.meta.dir,
        "../../scripts/eval-profiles/legacy-fitted/activate.ts",
      ),
      "utf8",
    );

    expect(selectionSource).not.toContain("internalFactSelector");
    expect(selectionSource).not.toContain("setFactSelectorForInternalEval");
    expect(engineSource).toContain(
      "config.factSelector ?? selectGeneralizedFactsForInternalUse",
    );
    expect(apiSource).toContain("factSelector: internal?.factSelector");
    expect(legacyActivationSource).not.toContain("src/recall/selection");
  });

  it("keeps recall selection split into orchestration plus bounded selector modules", async () => {
    const selectorDirectory = join(SRC_ROOT, "recall", "selectors");
    const selectionSource = await readFile(
      join(SRC_ROOT, "recall", "selection.ts"),
      "utf8",
    );
    const selectorFiles = await collectTypeScriptFiles(selectorDirectory);
    const topLevelSelectorFiles = await collectTopLevelTypeScriptFiles(selectorDirectory);
    const topLevelSourceOrderSelectorFiles = topLevelSelectorFiles.filter((file) =>
      file.split("/").at(-1)?.startsWith("sourceOrder") === true
    );
    const oversizedSelectorFiles: Array<{ file: string; lines: number }> = [];
    const wildcardBarrels: string[] = [];
    const benchmarkLiteralFiles: Array<{ file: string; literal: string }> = [];
    const caseNamedSelectorFiles: string[] = [];
    const caseLiteralSelectorFiles: string[] = [];
    const disallowedSelectionQueryImports: string[] = [];

    expect(selectionSource.split("\n").length).toBeLessThanOrEqual(
      RECALL_SELECTION_MAX_LINES,
    );
    expect(
      await fileExists(join(SRC_ROOT, "recall", "selectors", "factSelection.ts")),
    ).toBe(false);
    expect(
      await fileExists(join(SRC_ROOT, "recall", "selectors", "sourceOrder.ts")),
    ).toBe(false);
    expect(topLevelSelectorFiles.length).toBeLessThanOrEqual(
      RECALL_SELECTOR_TOP_LEVEL_FILE_LIMIT,
    );
    expect(topLevelSourceOrderSelectorFiles.length).toBeLessThanOrEqual(
      SOURCE_ORDER_SELECTOR_TOP_LEVEL_FILE_LIMIT,
    );

    for (const binding of await collectImportedBindingsForTarget(
      join(SRC_ROOT, "recall", "selection.ts"),
      "recall/selectors/contradiction.ts",
    )) {
      if (
        /^is[A-Z].*Query$/u.test(binding) &&
        !ALLOWED_RECALL_SELECTION_QUERY_IMPORTS.has(binding)
      ) {
        disallowedSelectionQueryImports.push(binding);
      }
    }

    const selectionSourceFile = ts.createSourceFile(
      "selection.ts",
      selectionSource,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    for (const statement of selectionSourceFile.statements) {
      if (!ts.isImportDeclaration(statement)) {
        continue;
      }

      const moduleSpecifier = statement.moduleSpecifier;
      if (
        !ts.isStringLiteral(moduleSpecifier) ||
        !moduleSpecifier.text.startsWith("./selectors/")
      ) {
        continue;
      }

      const importClause = statement.importClause;
      if (!importClause?.namedBindings || !ts.isNamedImports(importClause.namedBindings)) {
        continue;
      }

      for (const element of importClause.namedBindings.elements) {
        const binding = element.propertyName?.text ?? element.name.text;
        if (
          /^is[A-Z].*Query$/u.test(binding) &&
          !ALLOWED_RECALL_SELECTION_QUERY_IMPORTS.has(binding)
        ) {
          disallowedSelectionQueryImports.push(binding);
        }
      }
    }

    for (const file of selectorFiles) {
      const source = await readFile(file, "utf8");
      const lines = source.split("\n").length;
      const relativePath = toSourceRelativePath(file);

      if (lines > RECALL_SELECTOR_MAX_LINES) {
        oversizedSelectorFiles.push({
          file: relativePath,
          lines,
        });
      }
      if (/export\s+\*\s+from/u.test(source)) {
        wildcardBarrels.push(relativePath);
      }
      if (/\b(?:external_benchmark|BEAM)\b/u.test(source)) {
        benchmarkLiteralFiles.push({
          file: relativePath,
          literal: source.includes("external_benchmark")
            ? "external_benchmark"
            : "BEAM",
        });
      }
      if (DISALLOWED_SELECTOR_FILENAME_PATTERN.test(relativePath)) {
        caseNamedSelectorFiles.push(relativePath);
      }
      if (DISALLOWED_SELECTOR_RUNTIME_FIXTURE_PATTERN.test(source)) {
        caseLiteralSelectorFiles.push(relativePath);
      }
    }

    expect(selectionSource).not.toMatch(/\b(?:external_benchmark|BEAM)\b/u);
    expect([...new Set(disallowedSelectionQueryImports)].sort()).toEqual([]);
    expect(oversizedSelectorFiles).toEqual([]);
    expect(wildcardBarrels).toEqual([]);
    expect(benchmarkLiteralFiles).toEqual([]);
    expect(caseNamedSelectorFiles).toEqual([]);
    expect(caseLiteralSelectorFiles).toEqual([]);

    for (const reExport of [
      "selectArchives",
      "selectEpisodes",
      "selectFeedback",
      "selectFeedbackForProfile",
      "selectFeedbackForQuery",
      "selectPreferencesForQuery",
      "selectReferences",
    ]) {
      expect(selectionSource).toContain(reExport);
    }
  });

  it("keeps fact-selection orchestration modules bounded and mutation-owned", async () => {
    const factSelectionDirectory = join(SRC_ROOT, "recall", "factSelection");
    if (!(await fileExists(factSelectionDirectory))) {
      // Rules activate once the factSelection extraction lands.
      return;
    }

    const factSelectionFiles = await collectTypeScriptFiles(factSelectionDirectory);
    const selectionSource = await readFile(
      join(SRC_ROOT, "recall", "selection.ts"),
      "utf8",
    );
    const oversizedFiles: Array<{ file: string; lines: number }> = [];
    const wildcardBarrels: string[] = [];
    const benchmarkLiteralFiles: string[] = [];
    const fixtureLiteralFiles: string[] = [];
    const disallowedQueryImports: string[] = [];
    const unauthorizedDraftMutations: string[] = [];
    const draftMutationPattern =
      /\bselected\s*\.\s*(?:push|splice)\s*\(|\bselectedIds\s*\.\s*(?:add|delete)\s*\(/u;

    expect(factSelectionFiles.length).toBeLessThanOrEqual(
      RECALL_FACT_SELECTION_FILE_LIMIT,
    );

    for (const file of factSelectionFiles) {
      const source = await readFile(file, "utf8");
      const relativePath = toSourceRelativePath(file);
      const lines = source.split("\n").length;
      if (lines > RECALL_FACT_SELECTION_MAX_LINES) {
        oversizedFiles.push({ file: relativePath, lines });
      }
      if (/export\s+\*\s+from/u.test(source)) {
        wildcardBarrels.push(relativePath);
      }
      if (/\b(?:external_benchmark|BEAM)\b/u.test(source)) {
        benchmarkLiteralFiles.push(relativePath);
      }
      if (DISALLOWED_SELECTOR_RUNTIME_FIXTURE_PATTERN.test(source)) {
        fixtureLiteralFiles.push(relativePath);
      }

      const isDraftModule = relativePath === "recall/factSelection/draft.ts";
      if (!isDraftModule) {
        if (draftMutationPattern.test(source)) {
          unauthorizedDraftMutations.push(relativePath);
        }
        if (/\bmarkSelectedTrace\b/u.test(source)) {
          unauthorizedDraftMutations.push(`${relativePath} (markSelectedTrace)`);
        }
      }

      const sourceFile = ts.createSourceFile(
        relativePath,
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
      );
      for (const statement of sourceFile.statements) {
        if (!ts.isImportDeclaration(statement)) {
          continue;
        }
        const moduleSpecifier = statement.moduleSpecifier;
        if (!ts.isStringLiteral(moduleSpecifier) || !moduleSpecifier.text.startsWith(".")) {
          continue;
        }
        const importClause = statement.importClause;
        if (!importClause?.namedBindings || !ts.isNamedImports(importClause.namedBindings)) {
          continue;
        }
        for (const element of importClause.namedBindings.elements) {
          const binding = element.propertyName?.text ?? element.name.text;
          if (
            /^is[A-Z].*Query$/u.test(binding) &&
            !ALLOWED_RECALL_SELECTION_QUERY_IMPORTS.has(binding)
          ) {
            disallowedQueryImports.push(`${relativePath}: ${binding}`);
          }
        }
      }
    }

    // Once the draft module owns selection-state mutation, the engine itself
    // must route every mutation through it.
    expect(selectionSource).not.toMatch(draftMutationPattern);
    expect(selectionSource).not.toMatch(/\bmarkSelectedTrace\b/u);

    // The engine is a small declarative loop: route bodies live in the route
    // modules, never as inline switch cases.
    expect(selectionSource).not.toMatch(/\bswitch\s*\(/u);

    // The post-primary override pipeline must stay declarative: pruning lives
    // in the augmenter stages, never inline in the engine.
    const augmenterTablePath = join(
      factSelectionDirectory,
      "augmenterTable.ts",
    );
    expect(await fileExists(augmenterTablePath)).toBe(false);

    expect(oversizedFiles).toEqual([]);
    expect(wildcardBarrels).toEqual([]);
    expect(benchmarkLiteralFiles).toEqual([]);
    expect(fixtureLiteralFiles).toEqual([]);
    expect(disallowedQueryImports).toEqual([]);
    expect(unauthorizedDraftMutations).toEqual([]);
  });

  it("keeps production recall free of environment seams", async () => {
    const recallFiles = await collectTypeScriptFiles(join(SRC_ROOT, "recall"));
    const envReaders: string[] = [];
    for (const file of recallFiles) {
      const relativePath = toSourceRelativePath(file);
      const source = await readFile(file, "utf8");
      if (/\bprocess\.env\b/u.test(source)) {
        envReaders.push(relativePath);
      }
    }
    expect(envReaders).toEqual([]);
  });

  it("keeps eval reporting limited to function exports", async () => {
    expect(Object.keys(reporting).sort()).toEqual([
      "aggregateJudgedCases",
      "persistEvalArtifacts",
    ]);

    const source = await readFile(join(SRC_ROOT, "eval/reporting.ts"), "utf8");
    expect(source).not.toMatch(/export\s+(interface|type)\s+/);
  });

  it("keeps support layers from importing up into write/integration layers", async () => {
    const checks: Array<{ dir: string; forbidden: string }> = [
      { dir: "language", forbidden: "remember/" },
      { dir: "policy", forbidden: "remember/" },
      { dir: "api", forbidden: "host/" },
    ];
    const offenders: Array<{ file: string; targets: string[] }> = [];

    for (const { dir, forbidden } of checks) {
      const files = await collectTypeScriptFiles(join(SRC_ROOT, dir));
      for (const file of files) {
        const targets = await collectInternalImportEdges(file);
        const disallowedTargets = targets.filter((target) =>
          target.startsWith(forbidden),
        );

        if (disallowedTargets.length > 0) {
          offenders.push({
            file: toSourceRelativePath(file),
            targets: disallowedTargets,
          });
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("keeps storage and runtime from importing the evolution feature module", async () => {
    const offenders: Array<{ file: string; targets: string[] }> = [];

    for (const dir of ["storage", "runtime"]) {
      const files = await collectTypeScriptFiles(join(SRC_ROOT, dir));
      for (const file of files) {
        const targets = await collectInternalImportEdges(file);
        const disallowedTargets = targets.filter((target) =>
          target.startsWith("evolution/"),
        );

        if (disallowedTargets.length > 0) {
          offenders.push({
            file: toSourceRelativePath(file),
            targets: disallowedTargets,
          });
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("keeps the provider layer free of eval harness imports", async () => {
    const files = await collectTypeScriptFiles(join(SRC_ROOT, "provider"));
    const offenders: Array<{ file: string; targets: string[] }> = [];

    for (const file of files) {
      const targets = await collectInternalImportEdges(file);
      const disallowedTargets = targets.filter((target) =>
        target.startsWith("eval/"),
      );

      if (disallowedTargets.length > 0) {
        offenders.push({
          file: toSourceRelativePath(file),
          targets: disallowedTargets,
        });
      }
    }

    expect(offenders).toEqual([]);
  });
});
