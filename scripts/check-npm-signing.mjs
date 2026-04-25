import { spawnSync } from "node:child_process";

function runNpm(args) {
  const result = spawnSync("npm", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });

  return {
    status: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || ""
  };
}

function main() {
  const result = runNpm(["audit", "signatures"]);

  if (result.status === 0) {
    process.stdout.write(result.stdout);
    return;
  }

  const combined = `${result.stdout}\n${result.stderr}`;
  if (combined.includes("found no installed dependencies to audit")) {
    console.log("npm audit signatures skipped: no installed dependencies found.");
    return;
  }

  process.stderr.write(result.stderr || result.stdout);
  process.exit(result.status || 1);
}

main();

