const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");

// Node 22 on Windows aborts the process (0xC0000409) when the native recursive copy sees non-ASCII paths.
function copyDir(source, target) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) {
      copyDir(from, to);
    } else {
      fs.copyFileSync(from, to);
    }
  }
}

for (const dir of ["migrations", "migrations-sqlite"]) {
  const source = path.join(root, "src", "db", dir);
  const target = path.join(root, "dist", "db", dir);
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  copyDir(source, target);
}
