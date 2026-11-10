import core from '@actions/core';
import exec from '@actions/exec';
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as http from '@actions/http-client';
import {
    CIMON_COSIGN_PUBLIC_KEY,
    COSIGN_SHA256,
    checksumFor,
    COSIGN_VERSION,
    installRelease,
    sha256File,
} from '../common/install.js';
import {
    apiTokenFor,
    httpRequest,
    CIMON_RELEASES_URL,
    ConfigError,
    isConfigError,
    latestV1Tag,
    resolveRelease,
} from '../common/release.js';
import { rateLimitWait, withRetry } from '../common/retry.js';

const IS_WINDOWS = process.platform === 'win32';

// Where the Windows release is downloaded: the runner's temp directory.
const DOWNLOAD_DIR = IS_WINDOWS ? (process.env.RUNNER_TEMP || os.tmpdir()) : '/tmp';

// latestVersion looks up the newest stable v1 release with the job's
// github-token (see latestV1Tag), retrying rate limits and network failures.
async function latestVersion(githubToken) {
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

async function installCosign() {
    // Download cosign for signature verification, pinned by version and
    // SHA256. A cosign already at this path (from an earlier step or job on
    // a persistent runner) is reused only if it is the pinned binary.
    const name = `cosign-linux-${process.arch === 'arm64' ? 'arm64' : 'amd64'}`;
    const expected = COSIGN_SHA256[name];
    const cosignUrl = `https://github.com/sigstore/cosign/releases/download/${COSIGN_VERSION}/${name}`;
    const cosignPath = '/tmp/cosign';

    if (!fs.existsSync(cosignPath) || (await sha256File(cosignPath)) !== expected) {
        core.info(`Installing cosign ${COSIGN_VERSION}...`);
        await downloadBinaryToFile(cosignUrl, cosignPath);
        const actual = await sha256File(cosignPath);
        if (actual !== expected) {
            throw new Error(
                `SHA256 mismatch for ${name} ${COSIGN_VERSION}: expected ` +
                    `${expected}, got ${actual}. Refusing to run it.`
            );
        }
        fs.chmodSync(cosignPath, 0o755);
    }
    return cosignPath;
}

// downloadV1Binary downloads and verifies cimon `version`. With pinned set
// (the version input chose it), a release that does not exist is a
// ConfigError.
async function downloadV1Binary(version, { pinned = false } = {}) {
    const arch = process.arch === 'arm64' ? 'arm64' : 'x86_64';
    const baseUrl = `${CIMON_RELEASES_URL}/download/${version}`;
    const tarName = `cimon_linux_${arch}.tar.gz`;
    const tarPath = '/tmp/cimon-v1.tar.gz';
    const checksumPath = '/tmp/cimon-v1-checksums.txt';
    const checksumSigPath = '/tmp/cimon-v1-checksums.txt.sig';

    core.info(`Downloading cimon ${version} for ${arch}...`);
    try {
        await downloadBinaryToFile(`${baseUrl}/${tarName}`, tarPath);
    } catch (error) {
        // A missing tarball is almost always a mistyped or unpublished
        // version; say so before the signature check reports it as an
        // unsigned release.
        const Kind = pinned && error.httpStatusCode === 404 ? ConfigError : Error;
        throw new Kind(
            `Could not download cimon ${version} (${error.message}). Check ` +
                `that ${version} is a published release at ${CIMON_RELEASES_URL}.`
        );
    }
    await downloadBinaryToFile(`${baseUrl}/checksums.txt`, checksumPath);

    // Step 1: Verify cosign signature on checksums.txt.
    // This proves the checksums were signed by Cycode's private key.
    // Even if an attacker compromises the GitHub release, they can't
    // forge a valid signature without the private key.
    // MANDATORY: if signature is missing or invalid, abort.
    core.info('Downloading cosign signature...');
    try {
        await downloadBinaryToFile(`${baseUrl}/checksums.txt.sig`, checksumSigPath);
    } catch (error) {
        if (error.httpStatusCode !== 404) {
            throw error;
        }
        throw new Error(
            `Cosign signature file not found for ${version} (HTTP 404).\n` +
            `All v1.x releases must be signed. This may indicate a compromised or incomplete release.`
        );
    }

    const cosignPath = await installCosign();

    // The public key ships inside the action, not with the release (which
    // an attacker could replace).
    const pubKeyPath = '/tmp/cimon-cosign-verify.pub';
    fs.writeFileSync(pubKeyPath, CIMON_COSIGN_PUBLIC_KEY);

    core.info('Verifying cosign signature...');
    const verifyResult = await exec.exec(cosignPath, [
        'verify-blob',
        '--key', pubKeyPath,
        '--signature', checksumSigPath,
        '--insecure-ignore-tlog',
        checksumPath,
    ], { ignoreReturnCode: true, silent: true });

    if (verifyResult !== 0) {
        throw new Error(
            `Cosign signature verification FAILED for ${version}!\n` +
            `The checksums file was not signed by Cycode's key.\n` +
            `This may indicate a compromised release. Aborting.`
        );
    }
    core.info('Cosign signature verified — checksums are authentic');

    // Step 2: Verify SHA256 checksum of the binary.
    core.info('Verifying SHA256 checksum...');
    const checksumContent = fs.readFileSync(checksumPath, 'utf8');
    const expectedHash = checksumFor(checksumContent, tarName);

    if (!expectedHash) {
        throw new Error(`Checksum not found for ${tarName} in checksums.txt`);
    }

    const { createHash } = await import('crypto');
    const fileBuffer = fs.readFileSync(tarPath);
    const actualHash = createHash('sha256').update(fileBuffer).digest('hex');

    if (actualHash !== expectedHash) {
        throw new Error(
            `SHA256 checksum mismatch for ${tarName}!\n` +
            `  Expected: ${expectedHash}\n` +
            `  Got:      ${actualHash}\n` +
            `  This may indicate a compromised release. Aborting.`
        );
    }

    core.info(`Binary verified (cosign + SHA256): ${actualHash.substring(0, 16)}...`);

    // Extract into an empty directory, so a binary an earlier job left
    // there on a persistent self-hosted runner can never be the one that
    // runs.
    const extractDir = '/tmp/cimon-v1';
    fs.rmSync(extractDir, { recursive: true, force: true });
    fs.mkdirSync(extractDir, { recursive: true });
    await exec.exec('tar', ['-xzf', tarPath, '-C', extractDir]);
    fs.chmodSync(`${extractDir}/cimon`, 0o755);

    return `${extractDir}/cimon`;
}

// On Windows the release zip goes through the installer the attest action
// uses: the cosign signature on checksums.txt, then the zip's SHA256, before
// anything is extracted. There is no Windows install script.
async function downloadWindowsBinary(version, { pinned = false } = {}) {
    return installRelease({
        tag: version,
        pinned,
        workDir: path.join(DOWNLOAD_DIR, 'cimon-v1'),
        log: (message) => core.info(message),
        download: downloadBinaryToFile,
        run: (command, args) => exec.exec(command, args, { ignoreReturnCode: true }),
        // Windows' own tar.exe (bsdtar) extracts zip archives.
        extract: async (archive, dest) => {
            const code = await exec.exec('tar', ['-xf', archive, '-C', dest], {
                ignoreReturnCode: true,
            });
            if (code !== 0) {
                throw new Error(`Extracting ${archive} failed (${code})`);
            }
        },
    });
}

// The Windows agent observes builds through ETW and generates C/C++ SBOMs.
// It has no hardening, network policy, file integrity or memory protection,
// so asking for them is an error rather than a silent no-op.
function verifyWindowsInputs(config) {
    const unsupported = [];
    if (config.cimon.preventionMode) unsupported.push('prevent');
    if (config.cimon.hardening) unsupported.push('hardening');
    if (config.cimon.fileIntegrity) unsupported.push('file-integrity');
    if (config.cimon.memoryProtection) unsupported.push('memory-protection');
    if (unsupported.length > 0) {
        throw new Error(
            `On Windows, Cimon generates C/C++ SBOMs only; these inputs are ` +
            `Linux-only: ${unsupported.join(', ')}.`
        );
    }
}

// Releases before the Windows agent shipped carry an attest-only cimon.exe.
async function verifyWindowsAgent(releasePath) {
    const retval = await exec.exec(releasePath, ['agent', '--help'], {
        ignoreReturnCode: true,
        silent: true,
    });
    if (retval !== 0) {
        throw new Error(
            `${releasePath} has no Windows agent. This cimon release is an ` +
            `attest-only build; use a release that includes the Windows agent, ` +
            `or set release-path to a cimon.exe that does.`
        );
    }
}

// A request that stops sending data for a minute fails (and is retried)
// instead of holding the job for the client's default of three minutes.
const httpClient = new http.HttpClient('cimon-action', [], {
    socketTimeout: 60 * 1000,
});

// downloadBinaryToFile downloads url to filePath, retrying rate limits (for
// as long as GitHub asks), server errors and network failures. Any other
// HTTP error throws an error
// carrying httpStatusCode. The body is kept as bytes: readBody() returns a
// string, which corrupts binary data through UTF-8 re-encoding.
async function downloadBinaryToFile(url, filePath) {
    await withRetry(() => downloadOnce(url, filePath), {
        what: `Downloading ${url}`,
        log: (message) => core.info(message),
    });
}

async function downloadOnce(url, filePath) {
    const response = await httpClient.get(url);
    const message = response.message;
    if (message.statusCode !== 200) {
        message.resume();
        const error = new Error(`HTTP ${message.statusCode} from ${url}`);
        error.httpStatusCode = message.statusCode;
        const wait = rateLimitWait(message.statusCode, message.headers);
        if (wait >= 0) {
            error.retryAfterMs = wait;
        }
        throw error;
    }
    const chunks = [];
    await new Promise((resolve, reject) => {
        message.on('data', (chunk) => chunks.push(chunk));
        message.on('end', resolve);
        message.on('error', reject);
    });
    fs.writeFileSync(filePath, Buffer.concat(chunks));
}

function getActionConfig() {
    return {
        github: {
            token: core.getInput('github-token'),
            jobSummary: core.getBooleanInput('report-job-summary'),
            prSummary: core.getBooleanInput('report-pr-summary'),
        },
        cimon: {
            logLevel: core.getInput('log-level'),
            preventionMode: core.getBooleanInput('prevent'),
            allowedIPs: core.getInput('allowed-ips'),
            allowedHosts: core.getInput('allowed-hosts'),
            fileIntegrity: core.getBooleanInput('file-integrity'),
            memoryProtection: core.getBooleanInput('memory-protection'),
            ignoredIPNets: core.getInput('ignored-ip-nets'),
            applyFsEvents: core.getBooleanInput('apply-fs-events'),
            clientId: core.getInput('client-id'),
            secret: core.getInput('secret'),
            url: core.getInput('url'),
            featureGates: core.getMultilineInput('feature-gates'),
            releasePath: core.getInput('release-path'),
            version: core.getInput('version'),
            hardening: core.getInput('hardening') === 'true',
            hardeningTier: core.getInput('hardening-tier') || '2',
            hardeningDisabledRules: core.getInput('hardening-disabled-rules') || '',
        },
        report: {
            processTree: core.getBooleanInput('report-process-tree'),
            slackWebhookEndpoint: core.getInput('slack-webhook-endpoint'),
        },
    };
}

async function sudoExists() {
    try {
        const retval = await exec.exec('sudo', ['-v'], {
            silent: true,
        });
        return retval === 0;
    } catch (error) {
        return false;
    }
}

async function run(config) {
    // The Cimon agent runs on Linux (eBPF) and, for C/C++ SBOM generation
    // only, on Windows (ETW). The macOS cimon release is an attest-only
    // build with no `agent` command, so bail out before downloading
    // anything rather than failing later with `unknown command "agent"`.
    if (process.platform !== 'linux' && !IS_WINDOWS) {
        throw new Error(
            `cimon-action runs the Cimon agent, which supports Linux and ` +
            `Windows runners; this runner is ${process.platform}. On macOS ` +
            `use the attest sub-action (cycodelabs/cimon-action/attest@v1) ` +
            `for provenance and SBOM attestation instead.`
        );
    }
    if (IS_WINDOWS) {
        verifyWindowsInputs(config);
    }

    const release = resolveRelease(
        config.cimon.releasePath,
        config.cimon.version
    );
    if (release.version !== '' && !release.version.startsWith('v1.')) {
        throw new ConfigError(
            `version ${release.version} is not supported: this action ` +
                `runs cimon v1.x releases.`
        );
    }
    let releasePath;

    if (release.releasePath !== '') {
        core.info(`Running Cimon from release path: ${release.releasePath}`);

        if (!fs.existsSync(release.releasePath)) {
            throw new Error(
                `Cimon release path does not exist: ${release.releasePath}`
            );
        }

        releasePath = release.releasePath;
    } else if (IS_WINDOWS) {
        // The version input names a release, such as a release candidate,
        // which the latest-v1 lookup never picks.
        const version =
            release.version || (await latestVersion(config.github.token));
        core.info(
            release.version !== ''
                ? `Running Cimon ${version} (pinned by the version input)`
                : `Running Cimon ${version}, the latest v1 release`
        );
        releasePath = await downloadWindowsBinary(version, {
            pinned: release.version !== '',
        });
    } else if (release.version !== '') {
        // A pinned version skips the lookup, so nothing fetched at run time
        // decides which binary runs.
        core.info(`Running Cimon ${release.version} (pinned by the version input)`);
        releasePath = await downloadV1Binary(release.version, { pinned: true });
    } else {
        // Every other run takes the latest v1 release through the same
        // verified download (cosign signature on checksums.txt, then the
        // tarball's SHA256).
        const version = await latestVersion(config.github.token);
        core.info(`Running Cimon ${version} (the latest release)`);
        releasePath = await downloadV1Binary(version);
    }

    if (IS_WINDOWS) {
        await verifyWindowsAgent(releasePath);
        // MSBuild worker nodes otherwise outlive the build that started
        // them, and a later build's links would run outside that build's
        // process tree, where the agent cannot attribute them.
        core.exportVariable('MSBUILDDISABLENODEREUSE', '1');
    }

    // Save release path so the post step uses the same binary for stop.
    core.saveState('release-path', releasePath);

    const env = {
        ...process.env,
        CIMON_PREVENT: config.cimon.preventionMode,
        CIMON_ALLOWED_IPS: config.cimon.allowedIPs,
        CIMON_ALLOWED_HOSTS: config.cimon.allowedHosts,
        CIMON_FILE_INTEGRITY: config.cimon.fileIntegrity,
        CIMON_MEM_PROT: config.cimon.memoryProtection,
        CIMON_IGNORED_IP_NETS: config.cimon.ignoredIPNets,
        CIMON_REPORT_GITHUB_JOB_SUMMARY: config.github.jobSummary,
        CIMON_REPORT_PR_SUMMARY: config.github.prSummary,
        CIMON_REPORT_PROCESS_TREE: config.report.processTree,
        CIMON_SLACK_WEBHOOK_ENDPOINT: config.report.slackWebhookEndpoint,
        CIMON_APPLY_FS_EVENTS: config.cimon.applyFsEvents,
        CIMON_CLIENT_ID: config.cimon.clientId,
        CIMON_SECRET: config.cimon.secret,
        CIMON_URL: config.cimon.url,
        CIMON_FEATURE_GATES: (config.cimon.featureGates || []).filter(Boolean).join(','),
        GITHUB_TOKEN: config.github.token,
        CIMON_LOG_LEVEL: config.cimon.logLevel,
        CIMON_ENABLE_GITHUB_NETWORK_POLICY: true,
    };

    if (config.cimon.fileIntegrity) {
        // Feature flags that required for the file integrity module.
        env.CIMON_FEATURE_GATES = 'FSSensor=1,DataAnalysis=1';

        // Remove FS performance to catch large files.
        env.CIMON_FS_SENSOR_PERF_MODE = false;
    }

    if (config.cimon.memoryProtection) {
        // Feature flags that required for the memory protection module.
        env.CIMON_FEATURE_GATES = 'FSSensor=1';
    }

    if (config.cimon.hardening) {
        // Build hardening feature gates based on tier level.
        // Also enable FSSensor — required for FS-based hardening rules
        // (sensitive-reads, proc-mem-read, systemd-install, etc.)
        const tier = parseInt(config.cimon.hardeningTier) || 2;
        const hardeningGates = [
            'Hardening=true',
            'FSSensor=true',
            `HardeningTier1=${tier >= 1 ? 'true' : 'false'}`,
            `HardeningTier2=${tier >= 2 ? 'true' : 'false'}`,
            `HardeningTier3=${tier >= 3 ? 'true' : 'false'}`,
        ].join(',');

        // Enable FS events for both hardening rules and detailed process tree.
        env.CIMON_APPLY_FS_EVENTS = true;

        // Append to existing feature gates rather than overwriting.
        if (env.CIMON_FEATURE_GATES) {
            env.CIMON_FEATURE_GATES += ',' + hardeningGates;
        } else {
            env.CIMON_FEATURE_GATES = hardeningGates;
        }

        if (config.cimon.hardeningDisabledRules) {
            env.CIMON_HARDENING_DISABLED_RULES =
                config.cimon.hardeningDisabledRules;
        }
    }

    var retval;
    // GitHub-hosted Windows runners run elevated, which the Windows agent
    // needs; a self-hosted runner's account that is not an administrator
    // needs the kernel provider grant the docs describe. There is no sudo.
    // start-background itself detaches the agent.
    const sudo = !IS_WINDOWS && (await sudoExists());
    const options = {
        env,
        detached: !IS_WINDOWS,
        silent: false,
    };

    if (sudo) {
        retval = await exec.exec(
            'sudo',
            ['-E', releasePath, 'agent', 'start-background'],
            options
        );
    } else {
        retval = await exec.exec(
            releasePath,
            ['agent', 'start-background'],
            options
        );
    }

    if (retval !== 0) {
        throw new Error(`Failed starting Cimon process: ${retval}`);
    }

    // Save the release path so the post step uses the same binary for stop.
    core.saveState('release-path', releasePath);
}

try {
    await run(getActionConfig());
} catch (error) {
    const failOnError = core.getBooleanInput('fail-on-error');
    const log = error.message;
    core.error(`Cimon action error: ${log}`);
    // A mistake in the version input fails the step whatever fail-on-error
    // says (see ConfigError).
    if (failOnError || isConfigError(error)) {
        core.setFailed(log);
    }
}
