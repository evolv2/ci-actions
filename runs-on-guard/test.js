// Tests of the runs-on guard: node runs-on-guard/test.js (run in
// .github/workflows/runs-on-guard.yml). Each case is a workflow, whether the
// repository is public, and the number of findings expected.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { check } = require("./guard.js");

const cases = [
  ["literal hosted label", false, 1, `
on: push
jobs:
  a:
    runs-on: ubuntu-latest
    steps: [{run: "true"}]
`],
  ["hosted label with a reason above the job", false, 0, `
on: push
jobs:
  # hosted: macOS release leg, no own machine
  a:
    runs-on: macos-latest
    steps: [{run: "true"}]
`],
  ["hosted label with a reason inside the job", false, 0, `
on: push
jobs:
  a:
    # hosted: endpoint refuses LeafCloud
    runs-on: ubuntu-latest
    steps: [{run: "true"}]
`],
  ["ARM, large and xlarge labels count as hosted", false, 3, `
on: push
jobs:
  a: {runs-on: ubuntu-24.04-arm, steps: [{run: "true"}]}
  b: {runs-on: windows-11-arm, steps: [{run: "true"}]}
  c: {runs-on: macos-latest-xlarge, steps: [{run: "true"}]}
`],
  ["hosted fallback in an expression", false, 1, `
on: push
jobs:
  a:
    runs-on: \${{ vars.DEPLOY_RUNNER || 'ubuntu-latest' }}
    steps: [{run: "true"}]
`],
  ["own runner with variable: no finding", false, 0, `
on: push
jobs:
  a:
    runs-on: \${{ vars.CI_RUNNER || 'leafcloud' }}
    steps: [{run: "true"}]
`],
  ["off switch comparison is not a label", false, 0, `
on: push
jobs:
  a:
    runs-on: \${{ vars.CI_RUNNER == 'ubuntu-latest' && 'leafcloud' || vars.CI_TEST_RUNNER || 'leafcloud-tests' }}
    steps: [{run: "true"}]
`],
  ["hosted matrix entry", false, 1, `
on: push
jobs:
  a:
    strategy:
      matrix:
        os: [leafcloud, windows-latest]
    runs-on: \${{ matrix.os }}
    steps: [{run: "true"}]
`],
  ["pull_request_target + PR-head checkout, runner as a list on its own line", false, 1, `
on: pull_request_target
jobs:
  a:
    runs-on:
      - leafcloud
    steps:
      - uses: actions/checkout@abc
        with:
          ref: \${{ github.event.pull_request.head.sha }}
`],
  ["pull_request_target + refs/pull merge ref", false, 1, `
on: {pull_request_target: {types: [opened]}}
jobs:
  a:
    runs-on: \${{ vars.CI_RUNNER || 'leafcloud' }}
    steps:
      - uses: actions/checkout@abc
        with:
          ref: refs/pull/\${{ github.event.number }}/merge
`],
  ["pull_request_target + gh pr checkout", false, 1, `
on: [pull_request_target]
jobs:
  a:
    runs-on: leafcloud
    steps:
      - run: gh pr checkout \${{ github.event.number }}
`],
  ["pull_request_target without checkout of PR code: no finding", false, 0, `
on: pull_request_target
permissions: {}
jobs:
  a:
    runs-on: \${{ vars.CI_RUNNER || 'leafcloud' }}
    steps: [{run: "echo checking the event only"}]
`],
  ["public: runner group", true, 1, `
on: pull_request
jobs:
  a:
    runs-on: {group: eva-ci}
    steps: [{run: "true"}]
`],
  ["public: self-hosted list", true, 1, `
on: pull_request
jobs:
  a:
    runs-on: [self-hosted, linux]
    steps: [{run: "true"}]
`],
  ["public: own runner even with a reason comment", true, 1, `
on: pull_request
jobs:
  # hosted: not true
  a:
    runs-on: leafcloud
    steps: [{run: "true"}]
`],
  ["public: hosted with reason: no finding", true, 0, `
on: pull_request
jobs:
  a:
    # hosted: public repo
    runs-on: ubuntu-latest
    steps: [{run: "true"}]
`],
  ["reusable workflow job is skipped", false, 0, `
on: push
jobs:
  a:
    uses: evolv2/ci-actions/.github/workflows/x.yml@abc
`],
];

let failed = 0;
const root = fs.mkdtempSync(path.join(os.tmpdir(), "runs-on-guard-"));
cases.forEach(([name, isPublic, expected, text], i) => {
  const dir = path.join(root, String(i));
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, "w.yml"), text);
  const { findings } = check(dir, isPublic);
  const ok = findings.length === expected;
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${findings.length} finding(s), expected ${expected}`);
  if (!ok) findings.forEach((f) => console.log(`     ${f.msg}`));
});
fs.rmSync(root, { recursive: true, force: true });
if (failed) {
  console.log(`${failed} of ${cases.length} cases failed`);
  process.exit(1);
}
console.log(`all ${cases.length} cases pass`);
