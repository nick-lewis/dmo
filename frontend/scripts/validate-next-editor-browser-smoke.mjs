#!/usr/bin/env node

import { readFile } from "node:fs/promises";

function usage() {
  return [
    "Usage:",
    "  node ./scripts/validate-next-editor-browser-smoke.mjs --file <capture.json>",
    "  <capture-json> | node ./scripts/validate-next-editor-browser-smoke.mjs",
    "",
    "Expected capture shape:",
    JSON.stringify(
      {
        initial: {
          url: "http://localhost:5173/experiences/<id>/next#event=<id>&script=0&tab=fine-tuning",
          activeTab: "Fine Tuning",
          hasEvents: true,
          tabs: ["Audio", "Display Text", "Slides & Actions", "Fine Tuning"],
        },
        afterDisplayClick: "http://localhost:5173/experiences/<id>/next#event=<id>&script=0&tab=display",
        afterDisplayRefresh: {
          url: "http://localhost:5173/experiences/<id>/next#event=<id>&script=0&tab=display",
          activeTab: "Display Text",
        },
        afterFineTuningClick: {
          url: "http://localhost:5173/experiences/<id>/next#event=<id>&script=0&tab=fine-tuning",
          activeTab: "Fine Tuning",
          hasFineTuning: true,
        },
        errorLogCount: 0,
        errors: [],
      },
      null,
      2,
    ),
  ].join("\n");
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseArgs(argv) {
  if (argv.includes("--help") || argv.includes("-h")) {
    return { help: true };
  }

  const fileIndex = argv.indexOf("--file");
  if (fileIndex >= 0) {
    const file = argv[fileIndex + 1];
    if (!file) {
      throw new Error("Missing value after --file.");
    }
    return { file };
  }

  if (argv.length > 0) {
    throw new Error(`Unknown argument: ${argv[0]}`);
  }

  return {};
}

function urlIncludes(url, expected) {
  return typeof url === "string" && url.includes(expected);
}

function validateNextEditorBrowserSmoke(capture) {
  const failures = [];
  const assert = (condition, message) => {
    if (!condition) {
      failures.push(message);
    }
  };

  assert(capture && typeof capture === "object", "Capture must be a JSON object.");

  const initial = capture?.initial ?? {};
  const tabs = Array.isArray(initial.tabs) ? initial.tabs : [];
  assert(urlIncludes(initial.url, "/next"), "Initial URL must stay on /next.");
  assert(urlIncludes(initial.url, "event="), "Initial URL must preserve event hash state.");
  assert(urlIncludes(initial.url, "script=0"), "Initial URL must preserve script=0 hash state.");
  assert(urlIncludes(initial.url, "tab=fine-tuning"), "Initial URL must restore tab=fine-tuning.");
  assert(initial.hasEvents === true, "Events panel must be visible after initial load.");
  assert(initial.activeTab === "Fine Tuning", "Fine Tuning tab must be active after initial load.");
  for (const tabName of ["Audio", "Display Text", "Slides & Actions", "Fine Tuning"]) {
    assert(tabs.includes(tabName), `Missing script workspace tab: ${tabName}.`);
  }

  assert(urlIncludes(capture?.afterDisplayClick, "tab=display"), "Display Text switch must update URL to tab=display.");
  assert(
    urlIncludes(capture?.afterDisplayRefresh?.url, "tab=display"),
    "Display Text refresh must preserve tab=display.",
  );
  assert(
    capture?.afterDisplayRefresh?.activeTab === "Display Text",
    "Display Text tab must be active after refresh.",
  );

  const fineTuning = capture?.afterFineTuningClick ?? {};
  assert(urlIncludes(fineTuning.url, "tab=fine-tuning"), "Fine Tuning switch must update URL to tab=fine-tuning.");
  assert(fineTuning.activeTab === "Fine Tuning", "Fine Tuning tab must be active after switching back.");
  assert(fineTuning.hasFineTuning === true, "Fine Tuning content must be visible after switching back.");

  const errorLogCount = Number(capture?.errorLogCount ?? 0);
  assert(Number.isFinite(errorLogCount), "errorLogCount must be a number.");
  assert(errorLogCount === 0, "Browser console must not contain errors.");

  return failures;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const raw = args.file ? await readFile(args.file, "utf8") : await readStdin();
  if (!raw.trim()) {
    throw new Error("No capture JSON was provided.");
  }

  const capture = JSON.parse(raw);
  const failures = validateNextEditorBrowserSmoke(capture);
  if (failures.length > 0) {
    console.error("Next editor browser smoke failed:");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    if (Array.isArray(capture.errors) && capture.errors.length > 0) {
      console.error("Console errors:");
      for (const error of capture.errors) {
        console.error(`- ${error}`);
      }
    }
    process.exitCode = 1;
    return;
  }

  console.log("Next editor browser smoke passed.");
}

main().catch((error) => {
  console.error(error.message);
  console.error("");
  console.error(usage());
  process.exitCode = 1;
});
