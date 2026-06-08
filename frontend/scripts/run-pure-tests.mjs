import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const rootDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const testsDir = path.join(rootDir, "tests");
const outDir = path.join(rootDir, "node_modules", ".tmp", "pure-tests");

const stubModules = new Map([
  [
    path.join(rootDir, "src", "mainPanelApps.tsx"),
    "export function getMainPanelAppDefinition() { return null; }\n",
  ],
]);

async function collectTests(directory) {
  if (!existsSync(directory)) return [];

  const entries = await readdir(directory, { withFileTypes: true });
  const tests = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return collectTests(fullPath);
      return entry.isFile() && entry.name.endsWith(".test.ts")
        ? [fullPath]
        : [];
    }),
  );
  return tests.flat().sort();
}

function sourceFor(filePath) {
  return stubModules.get(filePath) ?? readFileSync(filePath, "utf8");
}

function isLocalSpecifier(value) {
  return value.startsWith(".");
}

function resolveLocalModule(fromFile, specifier) {
  const basePath = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    path.join(basePath, "index.ts"),
    path.join(basePath, "index.tsx"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function outputFileFor(sourceFile) {
  const relativePath = path.relative(rootDir, sourceFile);
  return path.join(outDir, relativePath).replace(/\.(json|tsx|ts)$/, ".mjs");
}

function outputSpecifier(fromFile, toFile) {
  const relativePath = path.relative(
    path.dirname(outputFileFor(fromFile)),
    outputFileFor(toFile),
  );
  const normalized = relativePath.split(path.sep).join("/");
  return normalized.startsWith(".") ? normalized : `./${normalized}`;
}

function localRuntimeDependencies(filePath) {
  if (filePath.endsWith(".json")) return [];

  const source = sourceFor(filePath);
  const parsed = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const dependencies = [];

  parsed.forEachChild((node) => {
    if (ts.isImportDeclaration(node)) {
      const specifier = node.moduleSpecifier;
      if (!ts.isStringLiteral(specifier)) return;
      if (!isLocalSpecifier(specifier.text)) return;
      if (node.importClause?.isTypeOnly) return;

      const dependency = resolveLocalModule(filePath, specifier.text);
      if (dependency) dependencies.push(dependency);
      return;
    }

    if (ts.isExportDeclaration(node)) {
      const specifier = node.moduleSpecifier;
      if (!specifier || !ts.isStringLiteral(specifier)) return;
      if (!isLocalSpecifier(specifier.text)) return;
      if (node.isTypeOnly) return;

      const dependency = resolveLocalModule(filePath, specifier.text);
      if (dependency) dependencies.push(dependency);
    }
  });

  return dependencies;
}

function collectRuntimeGraph(entryFiles) {
  const pending = [...entryFiles];
  const files = new Set();

  while (pending.length) {
    const filePath = pending.pop();
    if (!filePath || files.has(filePath)) continue;
    files.add(filePath);

    localRuntimeDependencies(filePath).forEach((dependency) => {
      if (!files.has(dependency)) pending.push(dependency);
    });
  }

  return [...files].sort();
}

function rewriteLocalSpecifiers(source, filePath) {
  return source.replace(
    /(\bfrom\s*["'])(\.[^"']+)(["'])|(\bimport\s*["'])(\.[^"']+)(["'])/g,
    (match, fromPrefix, fromSpecifier, fromSuffix, importPrefix, importSpecifier, importSuffix) => {
      const specifier = fromSpecifier ?? importSpecifier;
      const dependency = resolveLocalModule(filePath, specifier);
      if (!dependency) return match;

      const nextSpecifier = outputSpecifier(filePath, dependency);
      if (fromPrefix) return `${fromPrefix}${nextSpecifier}${fromSuffix}`;
      return `${importPrefix}${nextSpecifier}${importSuffix}`;
    },
  );
}

async function emitModule(filePath) {
  if (filePath.endsWith(".json")) {
    const outputFile = outputFileFor(filePath);
    await mkdir(path.dirname(outputFile), { recursive: true });
    await writeFile(
      outputFile,
      `export default ${sourceFor(filePath)};\n`,
      "utf8",
    );
    return outputFile;
  }

  const source = rewriteLocalSpecifiers(sourceFor(filePath), filePath);
  const output = ts.transpileModule(source, {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filePath,
  });
  const outputFile = outputFileFor(filePath);
  await mkdir(path.dirname(outputFile), { recursive: true });
  await writeFile(outputFile, output.outputText, "utf8");
  return outputFile;
}

const testFiles = await collectTests(testsDir);
if (!testFiles.length) {
  console.error("No pure frontend tests found.");
  process.exit(1);
}

await rm(outDir, { force: true, recursive: true });
const runtimeFiles = collectRuntimeGraph(testFiles);
const emittedFiles = await Promise.all(runtimeFiles.map(emitModule));
const emittedTests = emittedFiles.filter((filePath) => filePath.endsWith(".test.mjs"));

const result = spawnSync(process.execPath, ["--test", ...emittedTests], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
