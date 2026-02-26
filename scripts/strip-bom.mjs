import { access, readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const WORKSPACE_ROOTS = ["apps", "packages"];
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function getWorkspacePackageJsonPaths() {
  const result = [];

  for (const workspaceRoot of WORKSPACE_ROOTS) {
    const workspacePath = path.join(ROOT, workspaceRoot);
    let entries = [];

    try {
      entries = await readdir(workspacePath, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const packageJsonPath = path.join(workspacePath, entry.name, "package.json");
      if (await exists(packageJsonPath)) {
        result.push(packageJsonPath);
      }
    }
  }

  return result;
}

function hasUtf8Bom(buffer) {
  return buffer.length >= 3 && buffer[0] === BOM[0] && buffer[1] === BOM[1] && buffer[2] === BOM[2];
}

async function main() {
  const files = await getWorkspacePackageJsonPaths();
  const fixed = [];

  for (const filePath of files) {
    const content = await readFile(filePath);
    let nextContent = content;

    if (hasUtf8Bom(content)) {
      nextContent = content.subarray(3);
      await writeFile(filePath, nextContent);
      fixed.push(path.relative(ROOT, filePath));
    }

    JSON.parse(nextContent.toString("utf8"));
  }

  if (fixed.length === 0) {
    console.log("No BOM found in workspace package.json files.");
    return;
  }

  console.log("Removed BOM from:");
  for (const file of fixed) {
    console.log(`- ${file}`);
  }
}

await main();
