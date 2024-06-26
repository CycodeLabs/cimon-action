# 🦫 Secure your CI with Cimon

![](./pics/cimon-cover.png)

<a href="https://cycode.com/cygives/" alt="Cimon is part of Cygives, the community hub for free & open developer security tools."/>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./assets/images/Cygives-darkmode.svg">
    <source media="(prefers-color-scheme: light)" srcset="./assets/images/Cygives-lightmode.svg">
    <img alt="Cygives Banner" src="./assets/images/Cygives-lightmode.svg">
  </picture>
</a>

[Cimon](https://cimon.build) (pronounced "Simon") is a runtime security solution that detects and stops software supply-chain attacks on your pipeline, including those targeting SolarWinds and CodeCov, through easy onboarding and a developer-friendly experience.

By utilizing the revolutionary eBPF technology, Cimon monitors and mitigates attacks within the kernel, denying access to users' assets as soon as they arise.

This action helps seamlessly deploy the agent into any desired GitHub Actions build. The action is based on the NodeJS engine and contains simple `pre` and `post` scripts to deploy and gracefully shut down the agent.

Learn more about Cimon in our [docs](https://docs.cimon.build).

## 🏃‍♂️ Getting Started with Cimon

Getting started with Cimon is as simple as introducing a single step in the pipeline. Cimon Action should be the first step in each of your jobs.

We recommend starting Cimon in “Detect Mode” to allow it to learn your environment before applying preventive policies.

```yaml
- uses: cycodelabs/cimon-action@v0
```

## 🔨 Usage

The action supports the following parameters:

| Name                     | Default               | Description                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `client-id`              |                       | Cimon client ID for authentication                                                                                                                                                                                                                                                                                                                                        |
| `secret`                 |                       | Cimon secret for authentication                                                                                                                                                                                                                                                                                                                                           |
| `url`                    |                       | Cimon endpoint for authentication                                                                                                                                                                                                                                                                                                                                         |
| `prevent`                | `false`               | Enable prevention mode                                                                                                                                                                                                                                                                                                                                                    |
| `allowed-ips`            |                       | A comma or white space separated list of allowed IP addresses                                                                                                                                                                                                                                                                                                             |
| `allowed-hosts`          |                       | A comma or white space separated list of allowed domain names. The left-most label can be the wildcard character (`*`) to match multiple subdomains (e.g. `*.example.com`).                                                                                                                                                                                               |
| `ignored-ip-nets`        |                       | A comma or white space separated list of ignored IP networks in CIDR notation, e.g. 10.0.0.0/8, 172.16.0.0/12. This setting is mandatory if your workflow runs containers attached to a custom network with configured sub-range. In other words, inter-container networking is usually ignored by Cimon. Cimon implicitly ignores 10.0.0.0/8 and 172.16.0.0/12 networks. |
| `github-token`           | `${{ github.token }}` | GitHub token (used to overcome GitHub rate limiting)                                                                                                                                                                                                                                                                                                                      |
| `report-job-summary`     | `true`                | Report results through job summary output                                                                                                                                                                                                                                                                                                                                 |
| `report-process-tree`    | `false`               | Enable to report the process tree                                                                                                                                                                                                                                                                                                                                         |
| `slack-webhook-endpoint` |                       | Slack webhook endpoint to report security events                                                                                                                                                                                                                                                                                                                          |
| `apply-fs-events`        | `false`               | Enable processing filesystem events and display them in the process tree report                                                                                                                                                                                                                                                                                           |
| `log-level`              | `info`                | Log level (Used for debugging)                                                                                                                                                                                                                                                                                                                                            |
| `feature-gates`          |                       | Set of key=value pairs that describe Cimon features                                                                                                                                                                                                                                                                                                                       |
| `fail-on-error`          | `false`               | Fail the CI if Cimon encountered an error                                                                                                                                                                                                                                                                                                                                 |

## ⚙️ Scenarios

### Running Cimon on detect mode

```yaml
steps:
    - uses: cycodelabs/cimon-action@v0
```

### Running Cimon on prevent mode

```yaml
steps:
    - uses: cycodelabs/cimon-action@v0
      with:
          prevent: true
          allowed-hosts: >
              cycode.com
```

### Running Cimon on detect mode with a process tree and file system events

```yaml
steps:
    - uses: cycodelabs/cimon-action@v0
      with:
          report-process-tree: true
          apply-fs-events: true
```

### Running Cimon with enhanced Cycode capabiltiies

You can read more about it [here](https://docs.cimon.build/#cimon-with-cycode).

```yaml
steps:
    - uses: cycodelabs/cimon-action@v0
      with:
          client-id: ${{ secrets.CIMON_CLIENT_ID }}
          secret: ${{ secrets.CIMON_SECRET }}
```

## 🛡️ Security Report

Each pipeline run will report its findings through a security report embedded within the pipeline summary in GitHub Actions.

Here is an example of a Cimon report:

![](./pics/detect-report.png)

The report, created as a job summary, contains the profile of the running job based on the configuration and includes a snippet to assist the user with transitioning from detection to prevention.

When the policy is set to "prevent", any security anomalies matching the profile are displayed on the report:

![](./pics/prevent-report.png)

## 🪚 Development

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

## 🪪 License

[Apache License 2.0](./LICENSE.md)
