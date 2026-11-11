import core from '@actions/core';
import exec from '@actions/exec';
import tc from '@actions/tool-cache';
import { DefaultArtifactClient } from '@actions/artifact';
import * as http from '@actions/http-client';
import path from 'path';
import fs from 'fs';
import os from 'os';
import {
    apiTokenFor,
    httpRequest,
    isConfigError,
    latestV1Tag,
    resolveRelease,
} from '../src/common/release.js';
import { installRelease } from '../src/common/install.js';

// SECURITY: scope every install under a unique per-step subdirectory so a
// malicious previous step / job on a self-hosted runner cannot plant a
// pre-existing cimon binary or install script that we'd silently reuse.
// GHES self-hosted runners commonly persist $RUNNER_TEMP between jobs;
// public hosted runners give us a fresh VM, but we apply the same
// hardening unconditionally. GITHUB_ACTION identifies the step (GitHub
// adds a numeric suffix when a job uses the action more than once), so a
// second attest step in the job does not replace the binary the first one
// installed and reported as cimon-path.
const CIMON_TMP_BASE = process.env.RUNNER_TEMP || os.tmpdir();
const CIMON_RUN_KEY = [
    process.env.GITHUB_RUN_ID || 'local',
    process.env.GITHUB_RUN_ATTEMPT || '0',
    process.env.GITHUB_JOB || 'job',
    process.env.GITHUB_ACTION || 'step',
]
    .map((s) => String(s).replace(/[^A-Za-z0-9._-]/g, '_'))
    .join('-');
const CIMON_TMP_DIR = path.join(CIMON_TMP_BASE, `cimon-${CIMON_RUN_KEY}`);

// A request that stops sending data for a minute fails (and is retried)
// instead of holding the job for the client's default of three minutes.
const httpClient = new http.HttpClient('cimon-action', [], {
    socketTimeout: 60 * 1000,
});

// latestTag looks up the newest stable v1 release with the job's
// github-token (see latestV1Tag), retrying rate limits and network failures.
async function latestTag(githubToken) {
    const token = apiTokenFor(githubToken, process.env.GITHUB_SERVER_URL);
    if (!token) {
        core.warning(
            'Looking up the latest cimon release without a github.com token, ' +
                "so it shares the runner IP address's anonymous GitHub API " +
                'limit (60 requests per hour) and can be rate-limited. Set the ' +
                'version input to skip the lookup.'
        );
    }
    core.info('Looking up the latest cimon release...');
    return latestV1Tag({
        request: httpRequest(httpClient),
        token,
        log: (message) => core.info(message),
        warn: (message) => core.warning(message),
    });
}

// installVerified installs cimon release `version` (or the latest release
// when it is '') and returns the path to the binary. Downloads go through
// tool-cache, which retries rate limits and server errors. On Windows and
// macOS the release is an attest-only build (no hardening agent), which is
// all this action needs.
async function installVerified(githubToken, version) {
    // SECURITY: wipe any stale state before install, even within the per-job
    // subdir computed at module load. This defends against a malicious step
    // earlier in this same job planting files at our expected paths.
    if (fs.existsSync(CIMON_TMP_DIR)) {
        fs.rmSync(CIMON_TMP_DIR, { recursive: true, force: true });
    }

    const tag = version || (await latestTag(githubToken));
    return installRelease({
        tag,
        pinned: version !== '',
        workDir: CIMON_TMP_DIR,
        log: (message) => core.info(message),
        download: async (url, dest) => {
            await tc.downloadTool(url, dest);
        },
        run: (command, args, options = {}) =>
            exec.exec(command, args, { ignoreReturnCode: true, ...options }),
        extract: async (archive, dest, kind) => {
            if (kind === 'zip') {
                await tc.extractZip(archive, dest);
            } else {
                await tc.extractTar(archive, dest);
            }
        },
    });
}

function getActionConfig() {
    return {
        cimon: {
            logLevel: core.getInput('log-level'),
            clientId: core.getInput('client-id'),
            secret: core.getInput('secret'),
            url: core.getInput('url'),
            releasePath: core.getInput('release-path'),
            version: core.getInput('version'),
        },
        github: {
            token: core.getInput('github-token'),
        },
        attest: {
            subjects: core.getInput('subjects'),
            imageRef: core.getInput('image-ref'),
            signKey: core.getInput('sign-key'),
            kms: core.getInput('kms'),
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

// keyBasedSigning reports whether the attestations are signed with a key file
// or a KMS key rather than keyless.
function keyBasedSigning(config) {
    return config.attest.signKey !== '' || config.attest.kms !== '';
}

// signingArgs returns the key / KMS / keyless / Sigstore / timestamp flags
// shared by `attest generate-and-sign` and `attest sbom`, so both
// attestations are signed the same way.
function signingArgs(config) {
    const args = [];
    if (config.attest.signKey !== '') args.push('--key', config.attest.signKey);
    if (config.attest.kms !== '') args.push('--kms', config.attest.kms);
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
    } else if (keyBasedSigning(config) && config.attest.includeTimestamp) {
        // Key and KMS signing only timestamp on an explicit request, so the
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
    const release = resolveRelease(
        config.cimon.releasePath,
        config.cimon.version
    );
    const releaseName = release.version || 'latest release';
    let releasePath;

    if (release.releasePath !== '') {
        core.info(`Running Cimon from release path: ${release.releasePath}`);

        if (!fs.existsSync(release.releasePath)) {
            throw new Error(
                `Cimon release path does not exist: ${release.releasePath}`
            );
        }

        releasePath = release.releasePath;
    } else {
        // Every platform takes the verified download of the release asset.
        core.info(`Running Cimon Attest from ${releaseName}`);
        releasePath = await installVerified(
            config.github.token,
            release.version
        );
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
        if (keyBasedSigning(config) || config.attest.keyless) {
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
    // signed in-toto statement over the same subjects. On macOS the agent
    // (automatic SBOM generation) does not exist, so this is the only way to
    // get an SBOM attestation there; on Linux and Windows the agent signs the
    // SBOMs it generates itself. The path is checked only
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
    // A mistake in the version input fails the step whatever fail-on-error
    // says (see ConfigError).
    if (failOnError || isConfigError(error)) {
        core.setFailed(log);
    } else {
        core.warning(log);
    }
}
