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
`docs/platform/release-and-deploy.md`, "Only reviewed code deploys"). Needs a
checkout with `fetch-depth: 0`.

```yaml
# On a release event, before the build: the release commit must be on main
# (or on its release/X.Y.x line).
- uses: evolv2/ci-actions/reviewed-source@main
  if: github.event_name == 'release'
  with:
    mode: release

# A manual run that tags the image with a typed version: only a release tag
# on exactly the commit being built.
- uses: evolv2/ci-actions/reviewed-source@main
  if: github.event_name == 'workflow_dispatch' && inputs.version != ''
  with:
    mode: build
    version: ${{ inputs.version }}

# A manual run that deploys an existing tag: a release on main, or a dev build
# when the target is a dev namespace.
- uses: evolv2/ci-actions/reviewed-source@main
  with:
    mode: deploy
    version: ${{ steps.target.outputs.version }}
    allow-dev: ${{ steps.target.outputs.namespace == 'dev' }}
```

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
