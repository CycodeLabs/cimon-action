# cimon-attest

Generate, sign, and verify SLSA build provenance for artifacts produced
by your CI pipeline.

This action is **cross-platform**: it works on Linux, Windows, and macOS
GitHub Actions runners (including self-hosted runners on **GitHub
Enterprise Server**). Hardening (`prevent: true`, network policy, etc.)
is implemented on top of eBPF and remains Linux-only — for that, use the
top-level `cycodelabs/cimon-action@v1` action instead.

## Quick start

### Linux / macOS

```yaml
- uses: cycodelabs/cimon-action/attest@v1
  with:
    subjects: dist/my-binary
    keyless: true
    allow-submit-data-to-public-sigstore: true
```

### Windows (e.g. GHES self-hosted runner)

```yaml
- uses: cycodelabs/cimon-action/attest@v1
  with:
    subjects: dist\my-app.msi
    sign-key: private-key.pem  # keyed signing recommended for air-gapped/data-residency
```

The action automatically detects the runner platform and downloads the
matching `cimon` binary (`cimon.exe` on Windows). It uses
`$RUNNER_TEMP` so it cooperates with on-prem GHES self-hosted runners
that may not have `/tmp` writable.

## GHES support

The action honors `GITHUB_API_URL` and `GITHUB_SERVER_URL` (set
automatically by GHES runners) so build metadata enrichment works
against your enterprise instance, not public github.com.

## Air-gapped / data-residency signing

If your environment cannot submit to the public Sigstore transparency
log (e.g. customers in the USA / EU with data-residency requirements),
use one of:

- **KMS signing**: `--kms vault://<key-id>` (HashiCorp Vault transit) or
  `--kms awskms://<arn>` (AWS KMS) — signature stays in your control.
- **Keyed signing with checked-in private key**: `sign-key: private-key.pem`.
- **Private Sigstore**: deploy your own Fulcio + Rekor and pass
  `fulcio-server-url` + `rekor-server-url`.

See the inputs section below for the full list.

## Inputs

| Name | Description | Default |
|---|---|---|
| `subjects` | Whitespace-separated list of artifact paths or base64 subjects | — |
| `sign-key` | Path to a private ECDSA/RSA/ED25519 PEM key | — |
| `keyless` | Use keyless (Sigstore) signing | `false` |
| `tlog-upload` | Upload signature to Rekor transparency log | `true` |
| `fulcio-server-url` | Fulcio server URL | `https://fulcio.sigstore.dev` |
| `rekor-server-url` | Rekor server URL | `https://rekor.sigstore.dev` |
| `timestamp-server-url` | RFC3161 timestamp server URL | — |
| `allow-submit-data-to-public-sigstore` | Required when using public Sigstore | `false` |
| `provenance-output` | Path for unsigned provenance | `provenance.intoto.jsonl` |
| `signed-provenance-output` | Path for signed provenance | `provenance.intoto.jsonl.sig` |
| `report-job-summary` | Render provenance in the workflow job summary | `true` |
| `report-artifact` | Upload provenance as a workflow artifact | `true` |
| `github-token` | Token used for build metadata enrichment | `${{ github.token }}` |
| `log-level` | `trace` / `debug` / `info` | `info` |
| `fail-on-error` | Fail the step on attestation errors | `false` |

## Development

After editing `index.js`, rebuild the bundled distribution:

```bash
cd attest
npm install
npm run dist/index.js   # invokes ncc build
```

The bundled `dist/index.js` is what the action runtime executes; both
`index.js` and `dist/index.js` must be committed.
