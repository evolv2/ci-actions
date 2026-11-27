#!/usr/bin/env bash
# runs-on guard: every job of this organisation runs on our own runners
# (T-20261127-12, Michael 27-11-2026: "Alles op onze eigen runners").
#
# Usage: check.sh <workflow dir> <public: true|false>
#
# Rules, checked line by line on the workflow files (no YAML parser: the runner
# image has none, and every rule below is about a single line or a whole file):
#
# 1. A GitHub-hosted label (ubuntu-*, windows-*, macos-*) on a line that is not
#    a comment is refused, unless that line, or the comment block right above
#    it, carries `# hosted: <reason>`. This catches a literal `runs-on: ubuntu-latest`, a
#    fallback `|| 'ubuntu-latest'`, and matrix entries (`os: macos-latest`).
#    Accepted reasons today: macOS/Windows release legs (no own machine),
#    a public repository, an endpoint that refuses LeafCloud (library-live).
# 2. In a PUBLIC repository the reverse holds: a job on an own runner is
#    refused. Anyone can open a pull request there, and an own runner shares
#    nodes and network with our builds (security manager 27-11-2026).
# 3. `pull_request_target` together with a checkout of the PR head
#    (`github.event.pull_request.head.*`) in a file that runs on an own runner
#    is refused: that runs code from the PR with the base repository's rights.
#
# Exit 1 with one ::error:: per finding; exit 0 and a count otherwise.

set -uo pipefail

dir="${1:-.github/workflows}"
public="${2:-false}"
fouten=0
fout() { echo "::error file=$1,line=$2::$3"; fouten=$((fouten + 1)); }

hosted_re='(^|[^A-Za-z0-9_-])(ubuntu|windows|macos)-(latest|slim|[0-9][0-9.]*)([^A-Za-z0-9_.-]|$)'
own_re='leafcloud|vars\.[A-Z_]*RUNNER'

shopt -s nullglob
files=("$dir"/*.yml "$dir"/*.yaml)
if [ ${#files[@]} -eq 0 ]; then
  echo "runs-on guard: no workflow files in $dir."
  exit 0
fi

for f in "${files[@]}"; do
  prev=""
  n=0
  file_own=0
  while IFS= read -r line || [ -n "$line" ]; do
    n=$((n + 1))
    line="${line%$'\r'}"
    # Skip full-line comments; strip a trailing comment for the label match,
    # but keep it to look for the `# hosted:` reason.
    if [[ "$line" =~ ^[[:space:]]*# ]]; then
      # The reason may stand anywhere in the comment block right above.
      [[ "$line" == *"# hosted:"* ]] && prev="# hosted: (block above)"
      continue
    fi
    code="${line%%#*}"
    # A comparison with a hosted label (`vars.CI_RUNNER == 'ubuntu-latest'`)
    # reads the off switch; it is not a label a job runs on.
    while [[ "$code" =~ (.*)[!=]=[[:space:]]*\'[^\']*\'(.*) ]]; do
      code="${BASH_REMATCH[1]}${BASH_REMATCH[2]}"
    done
    if [[ "$code" =~ runs-on: ]] && [[ "$code" =~ $own_re ]]; then
      file_own=1
      if [ "$public" = "true" ]; then
        fout "$f" "$n" "Own runner in a public repository. Anyone can open a PR here; use a GitHub-hosted label with '# hosted: public repo'."
      fi
    fi
    if [[ "$code" =~ $hosted_re ]]; then
      if [[ "$line" != *"# hosted:"* ]] && [[ "$prev" != *"# hosted:"* ]]; then
        fout "$f" "$n" "GitHub-hosted label (${BASH_REMATCH[2]}-${BASH_REMATCH[3]}). Use \${{ vars.CI_RUNNER || 'leafcloud' }} (deploy/publish: vars.DEPLOY_RUNNER), or add '# hosted: <reason>' when there is no own machine for it."
      fi
    fi
    prev="$line"
  done < "$f"

  if [ "$file_own" -eq 1 ] \
     && grep -v '^[[:space:]]*#' "$f" | grep -q 'pull_request_target' \
     && grep -v '^[[:space:]]*#' "$f" | grep -Eq 'ref:.*github\.event\.pull_request\.head\.'; then
    fout "$f" 1 "pull_request_target with a checkout of the PR head on an own runner: that runs PR code with this repository's rights."
  fi
done

if [ "$fouten" -gt 0 ]; then
  echo "runs-on guard: $fouten finding(s) in ${#files[@]} workflow file(s)."
  exit 1
fi
echo "runs-on guard: ${#files[@]} workflow file(s), no GitHub-hosted labels without a reason."
