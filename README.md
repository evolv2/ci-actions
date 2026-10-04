# ci-actions

Shared GitHub Actions for evolv2 repositories.

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
