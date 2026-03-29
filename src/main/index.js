import core from '@actions/core';
import exec from '@actions/exec';
import fs from 'fs';
import * as http from '@actions/http-client';

const CIMON_SCRIPT_DOWNLOAD_URL =
    'https://cimon-releases.s3.amazonaws.com/install.sh';
const CIMON_SCRIPT_PATH = '/tmp/install.sh';
const CIMON_EXECUTABLE_DIR = '/tmp/cimon';
const CIMON_EXECUTABLE_PATH = '/tmp/cimon/cimon';

// For v1+, download a specific version from GitHub releases instead of S3 latest.
const CIMON_RELEASES_GITHUB = 'https://github.com/CycodeLabs/cimon-releases/releases';

async function getLatestV1Version() {
    const response = await httpClient.getJson(
        'https://api.github.com/repos/CycodeLabs/cimon-releases/releases'
    );
    const releases = response.result;
    for (const release of releases) {
        if (release.tag_name && release.tag_name.startsWith('v1.') && !release.draft) {
            return release.tag_name;
        }
    }
    throw new Error('No v1.x release found on cimon-releases');
}

async function downloadV1Binary(version) {
    const arch = process.arch === 'arm64' ? 'arm64' : 'x86_64';
    const url = `${CIMON_RELEASES_GITHUB}/download/${version}/cimon_linux_${arch}.tar.gz`;
    const tarPath = '/tmp/cimon-v1.tar.gz';

    core.info(`Downloading cimon ${version} for ${arch}...`);
    await downloadToFile(url, tarPath);

    const extractDir = '/tmp/cimon-v1';
    fs.mkdirSync(extractDir, { recursive: true });
    await exec.exec('tar', ['-xzf', tarPath, '-C', extractDir]);
    fs.chmodSync(`${extractDir}/cimon`, 0o755);

    return `${extractDir}/cimon`;
}

const httpClient = new http.HttpClient('cimon-action');

async function downloadToFile(url, filePath) {
    const response = await httpClient.get(url);
    const responseBody = await response.readBody();
    fs.writeFileSync(filePath, responseBody);
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
    let releasePath;

    if (config.cimon.releasePath != '') {
        core.info(
            `Running Cimon from release path: ${config.cimon.releasePath}`
        );

        if (!fs.existsSync(config.cimon.releasePath)) {
            throw new Error(
                `Cimon release path does not exist: ${config.cimon.releasePath}`
            );
        }

        releasePath = config.cimon.releasePath;
    } else if (config.cimon.hardening) {
        // Hardening requires v1.x binary. Auto-download latest v1.x release.
        const version = await getLatestV1Version();
        releasePath = await downloadV1Binary(version);
    } else {
        core.info('Running Cimon from latest release path');

        if (!fs.existsSync(CIMON_SCRIPT_PATH)) {
            await downloadToFile(CIMON_SCRIPT_DOWNLOAD_URL, CIMON_SCRIPT_PATH);
        }

        if (!fs.existsSync(CIMON_EXECUTABLE_DIR)) {
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
        CIMON_FEATURE_GATES: config.cimon.featureGates,
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
        const tier = parseInt(config.cimon.hardeningTier) || 2;
        const hardeningGates = [
            'Hardening=true',
            `HardeningTier1=${tier >= 1 ? 'true' : 'false'}`,
            `HardeningTier2=${tier >= 2 ? 'true' : 'false'}`,
            `HardeningTier3=${tier >= 3 ? 'true' : 'false'}`,
        ].join(',');

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
    const sudo = await sudoExists();
    const options = {
        env,
        detached: true,
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
    if (failOnError) {
        core.setFailed(log);
    }
}
