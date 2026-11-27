// Entry point of the action: the runner starts this with its own Node, so the
// guard needs nothing installed on the runner image.
"use strict";
const fs = require("fs");
const path = require("path");
const { check } = require("./guard.js");

const dir = path.resolve(process.env.GITHUB_WORKSPACE || ".", process.env["INPUT_PATH"] || ".github/workflows");
let isPublic = false;
try {
  const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  isPublic = event.repository && event.repository.private === false;
} catch (e) {
  console.log(`::error::cannot read the event to tell whether this repository is public: ${e.message}`);
  process.exit(1);
}

const { files, findings } = check(dir, isPublic);
for (const x of findings) {
  console.log(`::error file=${path.relative(process.env.GITHUB_WORKSPACE || ".", x.file)}::${x.msg}`);
}
if (findings.length) {
  console.log(`runs-on guard: ${findings.length} finding(s) in ${files} workflow file(s)${isPublic ? " (public repository)" : ""}.`);
  process.exit(1);
}
console.log(`runs-on guard: ${files} workflow file(s), no GitHub-hosted labels without a reason${isPublic ? ", no own runner (public repository)" : ""}.`);
