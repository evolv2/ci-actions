// runs-on guard: every evolv2 job runs on our own runners (T-20261127-12,
// Michael 27-11-2026: "Alles op onze eigen runners").
//
// Usage: node guard.js <workflow dir> <public: true|false>
//
// The workflows are parsed as YAML (vendor/js-yaml, 4.1.0 from the npm
// registry, sha512 checked), so the runner may be written in any form:
// `runs-on: x`, a list on its own lines, `{group: ..., labels: ...}`.
//
// Per job (a job that `uses:` a reusable workflow is checked by that
// repository's own guard):
//
// 1. GitHub-hosted labels are refused unless the job's text carries
//    `# hosted: <reason>`. Hosted = ubuntu-*, windows-*, macos-* (also -arm,
//    -large, -xlarge), in runs-on, in an expression fallback
//    (`|| 'ubuntu-latest'`) or in the job's matrix. A comparison
//    (`vars.CI_RUNNER == 'ubuntu-latest'`) is the off switch, not a label.
// 2. In a PUBLIC repository a job on an own runner is refused, whatever the
//    reason comment says: leafcloud*, self-hosted, a runner `group`, or a
//    repository variable (`vars.*`) as the label.
// 3. A job on an own runner in a workflow triggered by `pull_request_target`
//    may not check out or fetch PR code: actions/checkout with a `ref` on the
//    PR head or `refs/pull/...`, or a run step with `gh pr checkout` or a
//    fetch of `pull/<n>/...`.
//
// What this cannot see: the value of a `vars.X` (a variable may hold a hosted
// label; the repository settings decide), a label built with format(), and
// reusable workflows in other repositories. In a public repository this is a
// lint, not a boundary: a fork PR can change this file in the same PR. The
// boundary there is the runner group (no public repositories).

"use strict";
const fs = require("fs");
const path = require("path");
const yaml = require("./vendor/js-yaml-4.1.0.min.js");

const HOSTED = /^(ubuntu|windows|macos)-[a-z0-9.]+(-[a-z0-9]+)*$/i;
const HOSTED_LITERAL = /'((?:ubuntu|windows|macos)-[a-z0-9.]+(?:-[a-z0-9]+)*)'/gi;
const OWN_LABEL = /^(leafcloud(-[a-z0-9-]+)?|self-hosted)$/i;

// Remove comparisons such as `vars.CI_RUNNER == 'ubuntu-latest'`.
function dropComparisons(s) {
  return s.replace(/[!=]=\s*'[^']*'/g, "").replace(/'[^']*'\s*[!=]=/g, "");
}

function strings(v, out = []) {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => strings(x, out));
  return out;
}

// Classify the runner of one job: which hosted labels it can land on, and
// whether it can land on an own runner.
function classify(job) {
  const hosted = new Set();
  let own = false;
  const ro = job["runs-on"];
  const matrixValues = strings(job.strategy && job.strategy.matrix);
  let labels = [];
  if (ro && typeof ro === "object" && !Array.isArray(ro)) {
    if (ro.group) own = true;
    labels = strings(ro.labels);
  } else {
    labels = strings(ro);
  }
  for (const l of labels) {
    const t = l.trim();
    if (t.includes("${{")) {
      const e = dropComparisons(t);
      for (const m of e.matchAll(HOSTED_LITERAL)) hosted.add(m[1]);
      if (/'leafcloud[a-z0-9-]*'/i.test(e) || /vars\.[A-Za-z0-9_]+/.test(e)) own = true;
      if (/matrix\./.test(e)) {
        for (const v of matrixValues) {
          if (HOSTED.test(v.trim())) hosted.add(v.trim());
          if (OWN_LABEL.test(v.trim())) own = true;
        }
      }
    } else if (HOSTED.test(t)) hosted.add(t);
    else own = true; // leafcloud*, self-hosted, or any label of our own
  }
  return { hosted: [...hosted], own };
}

function triggers(on) {
  if (typeof on === "string") return [on];
  if (Array.isArray(on)) return on;
  if (on && typeof on === "object") return Object.keys(on);
  return [];
}

function checksOutPrCode(job) {
  for (const step of job.steps || []) {
    if (!step || typeof step !== "object") continue;
    if (typeof step.uses === "string" && /^actions\/checkout@/.test(step.uses)) {
      const ref = String((step.with && step.with.ref) || "");
      const repo = String((step.with && step.with.repository) || "");
      if (/pull_request\.head|refs\/pull\/|github\.event\.number|github\.head_ref/.test(ref + " " + repo)) return true;
    }
    if (typeof step.run === "string" && /gh\s+pr\s+checkout|pull\/[^\s]*\/(head|merge)|refs\/pull\//.test(step.run)) return true;
  }
  return false;
}

// The raw text of each job, to find its `# hosted:` reason.
function jobBlocks(text) {
  const lines = text.split(/\r?\n/);
  const blocks = {};
  let inJobs = false, indent = null, current = null;
  for (const line of lines) {
    if (/^jobs:\s*(#.*)?$/.test(line)) { inJobs = true; continue; }
    if (!inJobs) continue;
    if (/^\S/.test(line) && !/^#/.test(line)) { inJobs = false; current = null; continue; }
    const m = line.match(/^(\s+)([A-Za-z0-9_-]+):\s*(#.*)?$/);
    if (m && (indent === null || m[1].length === indent)) {
      indent = m[1].length; current = m[2]; blocks[current] = [];
      continue;
    }
    if (current) blocks[current].push(line);
  }
  // A reason in the comment block right above `<job>:` counts too.
  const out = {};
  for (const [name, body] of Object.entries(blocks)) out[name] = body.join("\n");
  const above = text.split(/\r?\n/);
  for (let i = 0; i < above.length; i++) {
    const m = above[i].match(/^\s+([A-Za-z0-9_-]+):\s*$/);
    if (m && out[m[1]] !== undefined) {
      for (let j = i - 1; j >= 0 && /^\s*#/.test(above[j]); j--) out[m[1]] += "\n" + above[j];
    }
  }
  return out;
}

function check(dir, isPublic) {
  const findings = [];
  const files = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).sort()
    : [];
  for (const f of files) {
    const file = path.join(dir, f);
    const text = fs.readFileSync(file, "utf8");
    let doc;
    try {
      doc = yaml.load(text);
    } catch (e) {
      findings.push({ file, msg: `not valid YAML: ${e.reason || e.message}` });
      continue;
    }
    if (!doc || typeof doc !== "object" || !doc.jobs) continue;
    const prTarget = triggers(doc.on).includes("pull_request_target");
    const blocks = jobBlocks(text);
    for (const [name, job] of Object.entries(doc.jobs)) {
      if (!job || typeof job !== "object" || job.uses) continue;
      const { hosted, own } = classify(job);
      const reason = /#\s*hosted:\s*\S/.test(blocks[name] || "");
      if (hosted.length && !reason) {
        findings.push({ file, msg: `job '${name}': GitHub-hosted label (${hosted.join(", ")}). Use \${{ vars.CI_RUNNER || 'leafcloud' }} (deploy/publish: vars.DEPLOY_RUNNER), or add '# hosted: <reason>' to the job when there is no own machine for it.` });
      }
      if (isPublic && own) {
        findings.push({ file, msg: `job '${name}': own runner in a public repository. Anyone can open a PR here; use a GitHub-hosted label with '# hosted: public repo'.` });
      }
      if (prTarget && own && checksOutPrCode(job)) {
        findings.push({ file, msg: `job '${name}': pull_request_target with a checkout or fetch of PR code on an own runner: that runs PR code with this repository's rights.` });
      }
    }
  }
  return { files: files.length, findings };
}

module.exports = { check, classify };

if (require.main === module) {
  const dir = process.argv[2] || ".github/workflows";
  const isPublic = process.argv[3] === "true";
  const { files, findings } = check(dir, isPublic);
  for (const x of findings) console.log(`::error file=${x.file}::${x.msg}`);
  if (findings.length) {
    console.log(`runs-on guard: ${findings.length} finding(s) in ${files} workflow file(s).`);
    process.exit(1);
  }
  console.log(`runs-on guard: ${files} workflow file(s), no GitHub-hosted labels without a reason.`);
}
