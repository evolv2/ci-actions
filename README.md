# ci-actions

Shared GitHub Actions for evolv2 repositories.

## buildkit

Sets up the buildx builder for an image build:

```yaml
- id: buildx
  uses: evolv2/ci-actions/buildkit@main
  with:
    name: eva-app
    fallback-image: evaplatform.azurecr.io/mirror/moby/buildkit:buildx-stable-1
```

On the eva-ci build runners it uses the shared BuildKit daemon (eva-server
`scripts/ci-runners/03-buildkit.yaml`). That daemon keeps its cache between
builds and runs only while builds do. Anywhere else, or if the daemon is not
up in time, the action creates a local docker-container builder as before.
When `steps.buildx.outputs.remote` is `true`, leave out
`--cache-to type=registry`: the daemon keeps the cache itself.

## reviewed-source

Fails the job when a release or a manual run would build, tag or deploy code
that did not go through a reviewed PR (eva-server
`docs/platform/release-and-deploy.md`, "Only reviewed code deploys"). On a
shallow checkout it fetches the history it needs.

```yaml
# On a release event, before the build: the release commit must be on main.
# Pin the action by full commit SHA: this repository is public and main
# is not protected.
- uses: evolv2/ci-actions/reviewed-source@<full-commit-sha>
  if: github.event_name == 'release'
  with:
    mode: release

# A manual run that tags the image with a typed version: only a release tag
# on exactly the commit being built.
- uses: evolv2/ci-actions/reviewed-source@<full-commit-sha>
  if: github.event_name == 'workflow_dispatch' && inputs.version != ''
  with:
    mode: build
    version: ${{ inputs.version }}

# A manual run that deploys an existing tag: a release on main, or a dev build
# when the target is a dev namespace.
- uses: evolv2/ci-actions/reviewed-source@<full-commit-sha>
  with:
    mode: deploy
    version: ${{ steps.target.outputs.version }}
    allow-dev: ${{ steps.target.outputs.namespace == 'dev' }}
```

## runs-on-guard

Fails when a workflow runs on a GitHub-hosted runner without a reason. Every
evolv2 job runs on our own runners (eva-ci), picked through a repository
variable: `${{ vars.CI_RUNNER || 'leafcloud' }}`, `CI_BUILD_RUNNER` for image
builds, `vars.DEPLOY_RUNNER` for jobs that hold a deploy or publish key.

```yaml
# .github/workflows/runs-on-guard.yml in a private repository
on: [pull_request]
permissions:
  contents: read
jobs:
  runs-on-guard:
    runs-on: ${{ vars.CI_RUNNER || 'leafcloud' }}
    timeout-minutes: 2
    steps:
      - uses: actions/checkout@<full-commit-sha>
        with:
          persist-credentials: false
      - uses: evolv2/ci-actions/runs-on-guard@<full-commit-sha>
```

The workflows are parsed as YAML (`guard.js`, js-yaml 4.1.0 vendored in
`vendor/`), per job; a job that `uses:` a reusable workflow is checked by that
repository's own guard.

- A hosted label (`ubuntu-*`, `windows-*`, `macos-*`, also `-arm`, `-large`,
  `-xlarge`; in `runs-on`, as `|| 'ubuntu-latest'` or in the matrix) needs
  `# hosted: <reason>` in the job or in the comment block above it. Reasons in
  use: a macOS/Windows release leg (we have only Linux runners), a public
  repository, an endpoint that refuses LeafCloud. A comparison such as
  `vars.CI_RUNNER == 'ubuntu-latest'` is not a label.
- In a public repository (this one) the reverse holds: an own runner
  (`leafcloud*`, `self-hosted`, a runner `group`, a `vars.*` label) is
  refused, reason or not, because anyone can open a PR there.
- `pull_request_target` with a checkout or fetch of PR code (`ref` on the PR
  head or `refs/pull/...`, `gh pr checkout`) on an own runner is refused.

What it cannot see: the value of a `vars.X` (a variable may hold a hosted
label), a label built with `format()`, reusable workflows in other
repositories. In a public repository it is a lint, not a boundary: a fork PR
can change the guard in the same PR. The boundary there is the runner group,
which must not allow public repositories. Tests: `node runs-on-guard/test.js`.

Why (27-11-2026): the org's Actions budget ran out and every job still on
GitHub-hosted stopped. This repository runs the guard on itself
(`.github/workflows/runs-on-guard.yml`).

## scan-sign

Run right after an image is pushed to ACR (with `az acr login` done):

```yaml
- uses: evolv2/ci-actions/scan-sign@main
  with:
    image: evaplatform.azurecr.io/<name>
    tag: ${{ steps.version.outputs.version }}
    cosign-key: ${{ secrets.COSIGN_PRIVATE_KEY }}
    cosign-password: ${{ secrets.COSIGN_PASSWORD }}
```

It resolves the digest ACR indexes, scans it with Trivy (the job fails on a
CRITICAL vulnerability that has a fix; HIGH is listed in the job summary), and
signs the digest with cosign without the public transparency log. The cluster
admits only images signed with the evolv2 key (Kyverno policy in eva-server,
`k8s/leafcloud/kyverno/`).

`self-test.yml` proves it end to end on every push to main.

### From evolv2-apps (customer apps)

Customer-app repos live in the `evolv2-apps` org and hold no Azure identity:
they `docker login` with a token scoped to their own `apps/<app>` repository
and sign with the apps key (eva-server `docs/runbooks/evolv2-apps-org.md`).
They resolve the digest from the registry instead of through `az`, and pin
this action by commit SHA (the evolv2-apps Actions policy allows only that):

```yaml
- uses: evolv2/ci-actions/scan-sign@<commit-sha>
  with:
    image: evaplatform.azurecr.io/apps/<app>
    tag: ${{ steps.version.outputs.version }}
    digest-source: registry
    cosign-key: ${{ secrets.APPS_COSIGN_PRIVATE_KEY }}
    cosign-password: ${{ secrets.APPS_COSIGN_PASSWORD }}
```

Cross-org use requires this repository to be public (on the GitHub Team plan
a private or internal action can only be used inside its own org). It holds
no secrets; its workflows run on push to main and on manual dispatch only.
