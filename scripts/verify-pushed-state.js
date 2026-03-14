import { execSync } from "node:child_process";

function run(cmd) {
  return execSync(cmd, { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
}

function fail(msg) {
  console.error("FAIL:", msg);
  process.exit(1);
}

run("git fetch origin main");
const local = run("git rev-parse HEAD");
const remote = run("git rev-parse origin/main");
if (local !== remote) {
  fail(`pushed state mismatch: local=${local} remote=${remote}`);
}
console.log(`OK: pushed state verified (${local})`);

