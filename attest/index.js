import core from '@actions/core';
import exec from '@actions/exec';
import tc from '@actions/tool-cache';
import { DefaultArtifactClient } from '@actions/artifact';
import * as http from '@actions/http-client';
import path from 'path';
import fs from 'fs';
import os from 'os';

const IS_WINDOWS = process.platform === 'win32';

// SECURITY: scope every install under a unique per-job subdirectory so a
// malicious previous step / job on a self-hosted runner cannot plant a
// pre-existing cimon binary or install script that we'd silently reuse.
// GHES self-hosted runners commonly persist $RUNNER_TEMP between jobs;
// public hosted runners give us a fresh VM, but we apply the same
// hardening unconditionally.
const CIMON_TMP_BASE = process.env.RUNNER_TEMP || os.tmpdir();
const CIMON_RUN_KEY = [
    process.env.GITHUB_RUN_ID || 'local',
    process.env.GITHUB_RUN_ATTEMPT || '0',
    process.env.GITHUB_JOB || 'job',
]
    .map((s) => String(s).replace(/[^A-Za-z0-9._-]/g, '_'))
    .join('-');
const CIMON_TMP_DIR = path.join(CIMON_TMP_BASE, `cimon-${CIMON_RUN_KEY}`);

// Linux: bootstrap from the cimon-releases install.sh.
const CIMON_SCRIPT_DOWNLOAD_URL =
    'https://cimon-releases.s3.amazonaws.com/install.sh';
const CIMON_SCRIPT_PATH = path.join(CIMON_TMP_DIR, 'install.sh');
const CIMON_EXECUTABLE_DIR = path.join(CIMON_TMP_DIR, 'cimon');
const CIMON_EXECUTABLE_PATH = path.join(CIMON_EXECUTABLE_DIR, 'cimon');

// Windows: install.ps1 is not yet published to S3, so we fetch the
// platform-specific zip directly from the cimon-releases GitHub release.
const CIMON_RELEASES_API =
    'https://api.github.com/repos/cycodelabs/cimon-releases/releases/latest';

const httpClient = new http.HttpClient('cimon-action');

async function downloadToFile(url, filePath) {
    const response = await httpClient.get(url);
    const responseBody = await response.readBody();
    fs.writeFileSync(filePath, responseBody);
}

// installCimonWindows fetches the cross-platform cimon.exe attest binary
// from the latest cimon-releases GitHub release and returns the path to
// the extracted executable. The hardening agent does not exist on Windows,
// so this binary only exposes the `attest` and `generate-key-pair`
// subcommands — sufficient for this action's purposes.
//
// `githubToken` is the action's github-token input (defaults to
// ${{ github.token }}). Without it, the latest-release lookup uses the
// unauthenticated REST limit (60 req/IP/hour) which busy self-hosted
// fleets behind a shared egress IP can exhaust — leading to 403/429s
// before any download runs. The same token is passed to tc.downloadTool
// for the asset download; that URL eventually 302s to objects-origin
// which ignores Authorization, but using it on the api.github.com side
// is what matters.
async function installCimonWindows(githubToken) {
    const installDir = CIMON_EXECUTABLE_DIR;
    const exePath = path.join(installDir, 'cimon.exe');

    // SECURITY: wipe any stale state before install, even within the
    // per-job subdir computed at module load. This defends against a
    // malicious step earlier in this same job planting a pre-built
    // cimon.exe at our expected path.
    if (fs.existsSync(installDir)) {
        fs.rmSync(installDir, { recursive: true, force: true });
    }
    fs.mkdirSync(installDir, { recursive: true });

    const authHeaders = {};
    if (githubToken) {
        authHeaders['Authorization'] = `Bearer ${githubToken}`;
        authHeaders['X-GitHub-Api-Version'] = '2022-11-28';
    } else {
        core.warning(
            'No github-token provided; falling back to unauthenticated ' +
                'GitHub API (60 req/IP/hour). On busy self-hosted runners ' +
                'this can rate-limit before cimon.exe is downloaded.'
        );
    }

    // Resolve the latest tag. Pinning by tag in customer pipelines is
    // recommended, but this action mirrors the Linux flow (install.sh
    // installs latest) for parity.
    const latest = await httpClient.getJson(CIMON_RELEASES_API, authHeaders);
    const tag = latest.result && latest.result.tag_name;
    if (!tag) {
        throw new Error(
            'Failed resolving latest cimon-releases tag (no tag_name in API response)'
        );
    }

    const zipUrl =
        `https://github.com/cycodelabs/cimon-releases/releases/download/` +
        `${tag}/cimon_windows_x86_64.zip`;

    core.info(`Downloading cimon ${tag} for Windows from ${zipUrl}`);
    const zipPath = await tc.downloadTool(
        zipUrl,
        undefined,
        githubToken ? `Bearer ${githubToken}` : undefined
    );
    await tc.extractZip(zipPath, installDir);

    if (!fs.existsSync(exePath)) {
        throw new Error(
            `cimon.exe not found after extracting ${zipUrl} into ${installDir}`
        );
    }
    return exePath;
}

function getActionConfig() {
    return {
        cimon: {
            logLevel: core.getInput('log-level'),
            clientId: core.getInput('client-id'),
            secret: core.getInput('secret'),
            url: core.getInput('url'),
            releasePath: core.getInput('release-path'),
        },
        github: {
            token: core.getInput('github-token'),
        },
        attest: {
            subjects: core.getInput('subjects'),
            imageRef: core.getInput('image-ref'),
            signKey: core.getInput('sign-key'),
            keyless: core.getBooleanInput('keyless'),
            tlogUpload: core.getBooleanInput('tlog-upload'),
            includeTimestamp: core.getBooleanInput('include-timestamp'),
            fulcioServerUrl: core.getInput('fulcio-server-url'),
            rekorServerUrl: core.getInput('rekor-server-url'),
            timestampServerUrl: core.getInput('timestamp-server-url'),
            allowSubmitDataToPublicSigstore: core.getBooleanInput(
                'allow-submit-data-to-public-sigstore'
            ),
            provenanceOutput: core.getInput('provenance-output'),
            signedProvenanceOutput: core.getInput('signed-provenance-output'),
            sourcePath: core.getInput('source-path'),
            skipSourceTreeCheck: core.getBooleanInput(
                'skip-source-tree-check'
            ),
            sbom: core.getInput('sbom'),
            signedSbomOutput: core.getInput('signed-sbom-output'),
        },
        report: {
            reportJobSummary: core.getBooleanInput('report-job-summary'),
            reportArtifact: core.getBooleanInput('report-artifact'),
        },
    };
}

// backendArgs returns the Cycode backend and logging flags shared by every
// `cimon attest` subcommand.
function backendArgs(config) {
    const args = [];
    if (config.cimon.clientId !== '')
        args.push('--client-id', config.cimon.clientId);
    if (config.cimon.secret !== '') args.push('--secret', config.cimon.secret);
    if (config.cimon.url !== '') args.push('--url', config.cimon.url);
    if (config.cimon.logLevel !== '')
        args.push('--log-level', config.cimon.logLevel);
    return args;
}

// signingArgs returns the key / keyless / Sigstore / timestamp flags shared
// by `attest generate-and-sign` and `attest sbom`, so both attestations are
// signed the same way.
function signingArgs(config) {
    const args = [];
    if (config.attest.signKey !== '') args.push('--key', config.attest.signKey);
    if (config.attest.keyless) {
        args.push('--keyless');

        args.push(`--tlog-upload=${config.attest.tlogUpload}`);
        args.push(`--include-timestamp=${config.attest.includeTimestamp}`);
        args.push(`--yes=${config.attest.allowSubmitDataToPublicSigstore}`);

        if (config.attest.fulcioServerUrl !== '') {
            args.push(`--fulcio-server-url=${config.attest.fulcioServerUrl}`);
        }

        if (config.attest.rekorServerUrl !== '') {
            args.push(`--rekor-server-url=${config.attest.rekorServerUrl}`);
        }

        if (config.attest.timestampServerUrl !== '') {
            args.push(
                `--timestamp-server-url=${config.attest.timestampServerUrl}`
            );
        }
    } else if (config.attest.signKey !== '' && config.attest.includeTimestamp) {
        // Key-based signing only timestamps on an explicit request, so the
        // inputs are forwarded only when include-timestamp is true. Older
        // cimon releases accept and ignore them.
        args.push('--include-timestamp=true');

        if (config.attest.timestampServerUrl !== '') {
            args.push(
                `--timestamp-server-url=${config.attest.timestampServerUrl}`
            );
        }
    }
    return args;
}

async function run(config) {
    let releasePath;

    if (config.cimon.releasePath !== '') {
        core.info(
            `Running Cimon from release path: ${config.cimon.releasePath}`
        );

        if (!fs.existsSync(config.cimon.releasePath)) {
            throw new Error(
                `Cimon release path does not exist: ${config.cimon.releasePath}`
            );
        }

        releasePath = config.cimon.releasePath;
    } else if (IS_WINDOWS) {
        // Windows: bootstrap via the cimon_windows_x86_64.zip release asset.
        // No hardening agent on Windows; this is the attest-only binary.
        core.info('Running Cimon Attest from latest release (Windows)');
        releasePath = await installCimonWindows(config.github.token);
    } else {
        core.info('Running Cimon from latest release path');

        // SECURITY: wipe any stale state under the per-job subdir before
        // install, then always re-download the install script. Defends
        // against a malicious earlier step in this job planting an
        // install script or pre-built cimon binary at our expected paths.
        if (fs.existsSync(CIMON_TMP_DIR)) {
            fs.rmSync(CIMON_TMP_DIR, { recursive: true, force: true });
        }
        fs.mkdirSync(CIMON_TMP_DIR, { recursive: true });

        await downloadToFile(CIMON_SCRIPT_DOWNLOAD_URL, CIMON_SCRIPT_PATH);

        {
            let params = [CIMON_SCRIPT_PATH, '-b', CIMON_EXECUTABLE_DIR];
            if (
                config.cimon.logLevel == 'debug' ||
                config.cimon.logLevel == 'trace'
            ) {
                params.push('-d');
            }
            let retval = await exec.exec('sh', params);
            if (retval !== 0) {
                throw new Error(`Failed installing Cimon: ${retval}`);
            }
        }

        releasePath = CIMON_EXECUTABLE_PATH;
    }

    // Expose the installed binary location to downstream workflow steps so
    // they don't have to reconstruct the per-job tmpdir layout. Three
    // surfaces, each for a different consumption pattern:
    //   - PATH: a later `cimon.exe attest verify ...` step just works.
    //   - CIMON_PATH env var: an absolute path for callers that bypass PATH
    //     (e.g. self-hosted runners with locked-down PATH lookup).
    //   - step output `cimon-path`: chains cleanly into another job via
    //     ${{ steps.<id>.outputs.cimon-path }}.
    core.addPath(path.dirname(releasePath));
    core.exportVariable('CIMON_PATH', releasePath);
    core.setOutput('cimon-path', releasePath);

    if (config.attest.imageRef !== '') {
        core.warning(
            'image-ref parameter is deprecated and will be removed in future versions. Please use subjects parameter instead.'
        );
        config.attest.subjects = config.attest.imageRef;
    }

    const provenanceArgs = ['attest', 'generate-and-sign'];
    if (config.attest.subjects !== '')
        provenanceArgs.push('--subjects', config.attest.subjects);
    if (config.attest.provenanceOutput !== '')
        provenanceArgs.push('--output-prov', config.attest.provenanceOutput);
    if (config.attest.signedProvenanceOutput !== '')
        provenanceArgs.push(
            '--output-signed-prov',
            config.attest.signedProvenanceOutput
        );
    if (config.attest.sourcePath !== '')
        provenanceArgs.push('--source-path', config.attest.sourcePath);
    if (config.attest.skipSourceTreeCheck)
        provenanceArgs.push('--skip-source-tree-check');
    if (config.report.reportJobSummary)
        provenanceArgs.push('--report-job-summary');
    provenanceArgs.push(...backendArgs(config), ...signingArgs(config));

    const execOptions = {
        env: {
            ...process.env,
            GITHUB_TOKEN: config.github.token,
        },
    };

    await exec.exec(releasePath, provenanceArgs, execOptions);

    const client = config.report.reportArtifact
        ? new DefaultArtifactClient()
        : null;
    const jobId = process.env.GITHUB_JOB;
    const randomSuffix = Math.floor(Math.random() * 1000);

    if (client) {
        client.uploadArtifact(
            `provenance-${jobId}-${randomSuffix}`,
            [config.attest.provenanceOutput],
            path.dirname(config.attest.provenanceOutput),
            { continueOnError: true }
        );
        if (config.attest.signKey !== '') {
            client.uploadArtifact(
                `signed-provenance-${jobId}-${randomSuffix}`,
                [config.attest.signedProvenanceOutput],
                path.dirname(config.attest.signedProvenanceOutput),
                { continueOnError: true }
            );
        }
    }

    core.info(`Build runtime SLSA provenance finished successfully`);

    // Optional SBOM attestation: wrap an SBOM produced by another tool in a
    // signed in-toto statement over the same subjects. On Windows/macOS
    // the agent (automatic SBOM generation) does not exist, so this is the
    // only way to get an SBOM attestation there. The path is checked only
    // here, after the provenance run, so a bad value for this optional
    // input never blocks the provenance attestation.
    if (config.attest.sbom !== '') {
        if (!fs.existsSync(config.attest.sbom)) {
            throw new Error(
                `SBOM file does not exist: ${config.attest.sbom}. Generate it ` +
                `with an SBOM tool (syft, sbom-tool, cyclonedx-py, ...) in an ` +
                `earlier step, or unset the sbom input.`
            );
        }

        const sbomArgs = ['attest', 'sbom', '--sbom', config.attest.sbom];
        if (config.attest.subjects !== '')
            sbomArgs.push('--subjects', config.attest.subjects);
        if (config.attest.signedSbomOutput !== '')
            sbomArgs.push('--output-signed-sbom', config.attest.signedSbomOutput);
        sbomArgs.push(...backendArgs(config), ...signingArgs(config));

        await exec.exec(releasePath, sbomArgs, execOptions);

        if (config.attest.signedSbomOutput !== '') {
            core.setOutput('signed-sbom-path', config.attest.signedSbomOutput);
            if (client) {
                client.uploadArtifact(
                    `signed-sbom-${jobId}-${randomSuffix}`,
                    [config.attest.signedSbomOutput],
                    path.dirname(config.attest.signedSbomOutput),
                    { continueOnError: true }
                );
            }
        }

        core.info(`SBOM attestation finished successfully`);
    }
}

try {
    await run(getActionConfig());
} catch (error) {
    const failOnError = core.getBooleanInput('fail-on-error');
    const log = error.message;
    if (failOnError) {
        core.setFailed(log);
    } else {
        core.warning(log);
    }
}
