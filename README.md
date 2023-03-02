# Secure your CI with Cimon

Cimon detects and stops software supply-chain attacks, including those targeting SolarWinds and CodeCov, through a developer-friendly experience.

By utilizing the revolutionary eBPF technology, Cimon monitors and mitigates attacks within the kernel, denying access to users' assets as soon as they arise.

This action helps seamlessly deploy the agent into any desired GitHub Actions build. The action is based on the NodeJS engine and contains simple `pre` and `post` scripts to deploy and gracefully shut down the agent.

## Getting Started

In order to integrate Cimon with GitHub, simply introduce the action in your GitHub Action workflow as follows:

``` yaml
steps:
  - uses: cycodelabs/cimon-action@v0
    with:
      prevent: true
      allowed-ips: ...
      allowed-domain-names: ...
```

## Usage

The action supports the following parameters:

| Name                               | Default                                | Description                                                                                             |
|------------------------------------|----------------------------------------|---------------------------------------------------------------------------------------------------------|
| `api-key`                          |                                        | Cimon API key                                                                                           |
| `prevent`                          | `false`                                | Enable prevention mode                                                                                  |
| `allowed-ips`                      |                                        | A comma-separated list of allowed IP addresses                                                          |
| `allowed-domain-names`             |                                        | A comma-separated list of domain names                                                                  |
| `github-token`                     | `${{ github.token }}`                  | GitHub token (used to overcome GitHub rate limiting)                                                    |
| `report-job-summary`               | `true`                                 | Report results through job summary output                                                               |
| `report-process-tree`              | `false`                                | Enable to report the process tree                                                                       |
| `slack-webhook-endpoint`           |                                        | Slack webhook endpoint to report security events                                                        |
| `apply-fs-events`                  | `false`                                | Enable processing filesystem events and display them in the process tree report                         |
| `docker-image`                     | `docker.io/cycodelabs/cimon:latest`    | Docker image reference                                                                                  |
| `docker-image-pull`                | `false`                                | Skip pulling image from registry (Used for debugging)                                                   |
| `docker-username`                  | `false`                                | Username to pull image from registry (Used for debugging)                                               |
| `docker-password`                  | `false`                                | Password to pull image from registry (Used for debugging)                                               |
| `enable-metrics`                   | `true`                                 | Enable to send anonymous metrics reports                                                                |
| `log-level`                        | `info`                                 | Log level (Used for debugging)                                                                          |

## Scenarios

### Running Cimon on detect mode

``` yaml
steps:
  - uses: cycodelabs/cimon-action@v0
```

### Running Cimon on prevent mode

``` yaml
steps:
  - uses: cycodelabs/cimon-action@v0
    with:
      prevent: true
      allowed-ips: ""
      allowed-domain-names: "cycode.com"
```

### Running Cimon on detect mode with a process tree and file system events

``` yaml
steps:
  - uses: cycodelabs/cimon-action@v0
    with:
      report-process-tree: true
      apply-fs-events: true
```

## Development

Contributions to GitHub Action are welcome. After changes were made to the `src` folder, these changes should be reflected to the `dist` folder through the following build process:

1. Install or update package dependencies:
   ```
   npm install
   ```
2. Compile JavaScript source files into single entrypoint files with [ncc]:
   ```
   npm run all
   ```

The build script will update the actions' entry points code in the [dist](dist) directory, which should be added to the Git repository.

[ncc]: https://github.com/vercel/ncc

## License

[Apache License 2.0](./LICENSE.md)