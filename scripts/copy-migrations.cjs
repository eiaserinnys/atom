const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");

for (const dir of ["migrations", "migrations-sqlite"]) {
  const source = path.join(root, "src", "db", dir);
  const target = path.join(root, "dist", "db", dir);
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true });
}
