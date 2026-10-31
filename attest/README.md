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

## SBOM attestation (Windows, macOS, or any tool-generated SBOM)

The Cimon agent that generates SBOMs automatically is Linux-only. On any
runner you can instead produce an SBOM with the tool of your choice and
have Cimon sign it as an in-toto attestation over the same artifacts, next
to the provenance, by passing it through the `sbom` input:

```yaml
- name: Generate SBOM
  shell: pwsh
  run: syft dir:dist -o cyclonedx-json=sbom.cdx.json   # any generator works

- uses: cycodelabs/cimon-action/attest@v1
  with:
    client-id: ${{ secrets.CIMON_CLIENT_ID }}
    secret: ${{ secrets.CIMON_SECRET }}
    subjects: dist\my-app.exe dist\my-app.dll
    sbom: sbom.cdx.json
    sign-key: private-key.pem
    signed-sbom-output: sbom.intoto.jsonl.sig
```

Accepted SBOM formats: CycloneDX (JSON or XML) and SPDX 2.x (JSON, YAML or
tag-value). The SBOM is signed with the same `sign-key` / `kms` /
`keyless` settings as the provenance. Verify it with:

```bash
cimon attest verify --client-id "$CIMON_CLIENT_ID" --secret "$CIMON_SECRET" \
  --type sbom --subjects "dist/my-app.exe dist/my-app.dll" \
  --key public-key.pem --signed-prov sbom.intoto.jsonl.sig
```

The same can be done by hand after the action, since it exports the binary
as `CIMON_PATH` and on `PATH`:

```bash
cimon attest sbom --client-id "$CIMON_CLIENT_ID" --secret "$CIMON_SECRET" \
  --sbom sbom.cdx.json --subjects "dist/my-app.exe dist/my-app.dll" \
  --key private-key.pem
```

`cimon attest sbom` and `cimon attest verify` need the Cycode credentials
either as `--client-id` / `--secret` or as the `CIMON_CLIENT_ID` /
`CIMON_SECRET` environment variables. Requires cimon v1.0.27 or later.

## GHES support

The action honors `GITHUB_API_URL` and `GITHUB_SERVER_URL` (set
automatically by GHES runners) so build metadata enrichment works
against your enterprise instance, not public github.com.

## Air-gapped / data-residency signing

If your environment cannot submit to the public Sigstore transparency
log (e.g. customers in the USA / EU with data-residency requirements),
use one of:

- **KMS signing**: `kms: vault://<key-name>` (HashiCorp Vault transit).
  The private key never leaves Vault; cimon sends the digest and receives
  the signature. Vault transit is the only KMS backend implemented today,
  and it requires cimon v1.0.28 or later.
- **Keyed signing with checked-in private key**: `sign-key: private-key.pem`.
- **Private Sigstore**: deploy your own Fulcio + Rekor and pass
  `fulcio-server-url` + `rekor-server-url`.

See the inputs section below for the full list.

### KMS signing with HashiCorp Vault transit

cimon reads the Vault connection from the standard Vault environment
variables (`VAULT_ADDR`, `VAULT_TOKEN`, and optionally `VAULT_NAMESPACE`
and `VAULT_CACERT`). The transit engine must be mounted at `transit/`, and
the key must support signing (for example `ecdsa-p256` or `rsa-3072`):

```yaml
- uses: cycodelabs/cimon-action/attest@v1
  env:
    VAULT_ADDR: https://vault.example.com:8200
    VAULT_TOKEN: ${{ secrets.VAULT_TOKEN }}
  with:
    subjects: dist\my-app.msi
    kms: vault://cimon-signing
    fail-on-error: true
```

Verifiers need the key's public half, which Vault returns from
`transit/keys/<key-name>`:
`cimon attest verify --key public-key.pem --signed-prov provenance.intoto.jsonl.sig`.

### Timestamping key-based signatures

A signature made with `sign-key` or `kms` carries no time anchor unless you add an
RFC 3161 timestamp, which lets a verifier show it was made before the
key was rotated or revoked. Request one explicitly; `timestamp-server-url`
accepts a Sigstore timestamp authority or a standard RFC 3161 service:

```yaml
- uses: cycodelabs/cimon-action/attest@v1
  with:
    subjects: dist\my-app.msi
    sign-key: private-key.pem
    include-timestamp: true
    timestamp-server-url: http://timestamp.sectigo.com
    fail-on-error: true
```

If the timestamp server cannot be reached, attestation fails. With the
default `fail-on-error: false` that is only logged as a warning, so set
it to `true` when the timestamp is required. Verify with
`cimon attest verify --key public-key.pem --timestamp-certificate-chain
<tsa-root.pem>`, pinning the timestamp authority's root certificate.
This requires a cimon release with key-based timestamping; older
releases accept these inputs and produce no timestamp.

## Inputs

| Name | Description | Default |
|---|---|---|
| `subjects` | Whitespace-separated list of artifact paths or base64 subjects | — |
| `source-path` | Path to the source checkout recorded in the attestation. Unset means automatic discovery (subject paths, run-id directory, workspace). Requires cimon v1.0.24 or later | — |
| `skip-source-tree-check` | Skip verifying the source tree matches the recorded commit | `false` |
| `sign-key` | Path to a private ECDSA/RSA/ED25519 PEM key | — |
| `kms` | KMS key URI for signing. HashiCorp Vault transit: `vault://<key-name>`, configured through `VAULT_ADDR` and `VAULT_TOKEN`. Requires cimon v1.0.28 or later | — |
| `keyless` | Use keyless (Sigstore) signing | `false` |
| `tlog-upload` | **Keyless only.** Upload signature to Rekor transparency log | `true` |
| `include-timestamp` | Request an RFC 3161 timestamp and embed it in the signature. Applies to `keyless`, `sign-key` and `kms` signing | `false` |
| `fulcio-server-url` | **Keyless only.** Fulcio server URL | `https://fulcio.sigstore.dev` |
| `rekor-server-url` | **Keyless only.** Rekor server URL | `https://rekor.sigstore.dev` |
| `timestamp-server-url` | RFC 3161 timestamp server URL: a Sigstore timestamp authority or a standard RFC 3161 service. With `sign-key` or `kms`, forwarded only when `include-timestamp: true` | — |
| `allow-submit-data-to-public-sigstore` | **Keyless only.** Required when using public Sigstore | `false` |
| `provenance-output` | Path for unsigned provenance | `provenance.intoto.jsonl` |
| `signed-provenance-output` | Path for signed provenance | `provenance.intoto.jsonl.sig` |
| `sbom` | Path to an SBOM produced by another tool (CycloneDX JSON/XML or SPDX 2.x JSON/YAML/tag-value) to sign as an SBOM attestation over the same subjects. Requires cimon v1.0.27 or later | — |
| `signed-sbom-output` | Path for the signed SBOM attestation. Used only when `sbom` is set | `sbom.intoto.jsonl.sig` |
| `report-job-summary` | Render provenance in the workflow job summary | `true` |
| `report-artifact` | Upload provenance as a workflow artifact | `true` |
| `github-token` | Token used for build metadata enrichment | `${{ github.token }}` |
| `log-level` | `trace` / `debug` / `info` | `info` |
| `fail-on-error` | Fail the step on attestation errors | `false` |

## Outputs

| Name | Description |
|---|---|
| `cimon-path` | Absolute path to the installed `cimon` / `cimon.exe` binary (also exported as `CIMON_PATH` and added to `PATH`) |
| `signed-sbom-path` | Path of the signed SBOM attestation. Empty unless `sbom` is set |

## Development

After editing `index.js`, rebuild the bundled distribution:

```bash
cd attest
npm install
npm run dist/index.js   # invokes ncc build
```

The bundled `dist/index.js` is what the action runtime executes; both
`index.js` and `dist/index.js` must be committed.
