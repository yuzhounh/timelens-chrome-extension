import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir = join(root, "release");
const zipPath = join(releaseDir, "timelens-chrome-extension-store.zip");
const stageDir = join(releaseDir, ".stage");

const includePaths = [
  "manifest.json",
  "background.js",
  "lib.js",
  "i18n.js",
  "dashboard.html",
  "dashboard.css",
  "dashboard.js",
  "popup.html",
  "popup.css",
  "popup.js",
  "icons",
  "_locales"
];

const forbiddenPatterns = [
  /^\.git/,
  /^node_modules/,
  /^email-worker/,
  /^test/,
  /^docs/,
  /^scripts/,
  /^release/,
  /\.zip$/,
  /^\.env/,
  /^README\.md$/,
  /^LICENSE$/
];

function resetStage() {
  if (existsSync(stageDir)) rmSync(stageDir, { recursive: true, force: true });
  mkdirSync(stageDir, { recursive: true });
}

function copyIntoStage() {
  for (const relativePath of includePaths) {
    const source = join(root, relativePath);
    const target = join(stageDir, relativePath);
    if (!existsSync(source)) {
      throw new Error(`Missing required path: ${relativePath}`);
    }
    cpSync(source, target, { recursive: true });
  }
}

function createZip() {
  mkdirSync(releaseDir, { recursive: true });
  if (existsSync(zipPath)) rmSync(zipPath, { force: true });
  if (process.platform === "win32") {
    execSync(
      `powershell -NoProfile -Command "Compress-Archive -Path '${stageDir.replace(/'/g, "''")}\\*' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force"`,
      { stdio: "inherit" }
    );
  } else {
    execSync(`cd "${stageDir}" && zip -r "${zipPath}" .`, { stdio: "inherit" });
  }
}

function inspectZipEntries() {
  if (process.platform === "win32") {
    const escaped = zipPath.replace(/'/g, "''");
    const output = execSync(
      `powershell -NoProfile -Command "Add-Type -AssemblyName System.IO.Compression.FileSystem; $z=[System.IO.Compression.ZipFile]::OpenRead('${escaped}'); $z.Entries | ForEach-Object { $_.FullName }; $z.Dispose()"`,
      { encoding: "utf8" }
    );
    return output.trim().split(/\r?\n/).filter(Boolean).map((entry) => entry.replace(/\\/g, "/"));
  }
  return execSync(`unzip -Z1 "${zipPath}"`, { encoding: "utf8" }).trim().split(/\n/).filter(Boolean);
}

function validate(entries) {
  const issues = [];
  const warnings = [];

  if (!entries.includes("manifest.json")) {
    issues.push("manifest.json is not at zip root");
  }
  if (entries.some((entry) => entry.startsWith("timelens-chrome-extension/"))) {
    issues.push("Zip contains an extra top-level folder; Chrome Web Store expects files at root");
  }
  for (const entry of entries) {
    const top = entry.split("/")[0];
    if (forbiddenPatterns.some((pattern) => pattern.test(top) || pattern.test(entry))) {
      issues.push(`Forbidden path in zip: ${entry}`);
    }
  }
  if (!entries.some((entry) => entry.startsWith("_locales/en/messages.json"))) {
    issues.push("Missing _locales/en/messages.json");
  }
  if (!entries.some((entry) => entry.startsWith("_locales/zh_CN/messages.json"))) {
    issues.push("Missing _locales/zh_CN/messages.json");
  }
  if (!entries.some((entry) => entry.startsWith("icons/timer-128.png"))) {
    issues.push("Missing icons/timer-128.png (required for store listing)");
  }

  const manifest = JSON.parse(readFileSync(join(stageDir, "manifest.json"), "utf8"));
  if (!manifest.default_locale) warnings.push("manifest.json has no default_locale");
  if (!manifest.name?.startsWith("__MSG_")) warnings.push("manifest name is not localized via __MSG_ keys");

  const zipSize = statSync(zipPath).size;
  if (zipSize > 20 * 1024 * 1024) warnings.push(`Zip is ${(zipSize / 1024 / 1024).toFixed(1)} MB; keep under 20 MB for smoother review`);

  return { issues, warnings, zipSize, manifestVersion: manifest.version };
}

resetStage();
copyIntoStage();
createZip();
const entries = inspectZipEntries();
const result = validate(entries);

console.log(`\nStore package: ${zipPath}`);
console.log(`Version: ${result.manifestVersion}`);
console.log(`Files: ${entries.length}`);
console.log(`Size: ${(result.zipSize / 1024).toFixed(1)} KB`);

if (result.warnings.length) {
  console.log("\nWarnings:");
  for (const warning of result.warnings) console.log(`  - ${warning}`);
}

if (result.issues.length) {
  console.error("\nIssues:");
  for (const issue of result.issues) console.error(`  - ${issue}`);
  process.exit(1);
}

console.log("\nZip structure looks compliant for Chrome Web Store upload.");
console.log("\nTop-level entries:");
for (const entry of [...new Set(entries.map((item) => item.split("/")[0]))].sort()) {
  console.log(`  - ${entry}`);
}

rmSync(stageDir, { recursive: true, force: true });
