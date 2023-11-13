import core from '@actions/core';
import exec from '@actions/exec';
import fs from 'fs';
import * as http from '@actions/http-client';

const CIMON_SCRIPT_DOWNLOAD_URL =
    'https://cimon-releases.s3.amazonaws.com/run.sh';
const CIMON_SCRIPT_PATH = '/tmp/install.sh';
const CIMON_SUBCMD = 'agent';

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
        },
        cimon: {
            logLevel: core.getInput('log-level'),
            preventionMode: core.getBooleanInput('prevent'),
            allowedIPs: core.getInput('allowed-ips'),
            allowedHosts: core.getInput('allowed-hosts'),
            ignoredIPNets: core.getInput('ignored-ip-nets'),
            applyFsEvents: core.getBooleanInput('apply-fs-events'),
            clientId: core.getInput('client-id'),
            secret: core.getInput('secret'),
            url: core.getInput('url'),
            featureGates: core.getMultilineInput('feature-gates'),
            releasePath: core.getInput('release-path'),
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
    await downloadToFile(CIMON_SCRIPT_DOWNLOAD_URL, CIMON_SCRIPT_PATH);

    const env = {
        ...process.env,
        CIMON_PREVENT: config.cimon.preventionMode,
        CIMON_ALLOWED_IPS: config.cimon.allowedIPs,
        CIMON_ALLOWED_HOSTS: config.cimon.allowedHosts,
        CIMON_IGNORED_IP_NETS: config.cimon.ignoredIPNets,
        CIMON_REPORT_GITHUB_JOB_SUMMARY: config.github.jobSummary,
        CIMON_REPORT_PROCESS_TREE: config.report.processTree,
        CIMON_SLACK_WEBHOOK_ENDPOINT: config.report.slackWebhookEndpoint,
        CIMON_APPLY_FS_EVENTS: config.cimon.applyFsEvents,
        CIMON_CLIENT_ID: config.cimon.clientId,
        CIMON_SECRET: config.cimon.secret,
        CIMON_URL: config.cimon.url,
        CIMON_FEATURE_GATES: config.cimon.featureGates,
        GITHUB_TOKEN: config.github.token,
        CIMON_LOG_LEVEL: config.cimon.logLevel,
    };

    var retval;
    const sudo = await sudoExists();
    const options = {
        env,
        detached: true,
        silent: false,
    };

    if (config.cimon.releasePath) {
        core.info(
            `Running Cimon from release path: ${config.cimon.releasePath}`
        );
        if (sudo) {
            retval = await exec.exec(
                'sudo',
                [
                    '-E',
                    'sh',
                    CIMON_SCRIPT_PATH,
                    CIMON_SUBCMD,
                    config.cimon.releasePath,
                ],
                options
            );
        } else {
            retval = await exec.exec(
                'sh',
                [CIMON_SCRIPT_PATH, CIMON_SUBCMD, config.cimon.releasePath],
                options
            );
        }
    } else {
        core.info('Running Cimon from latest release path');
        if (sudo) {
            retval = await exec.exec(
                'sudo',
                ['-E', 'sh', CIMON_SCRIPT_PATH, CIMON_SUBCMD],
                options
            );
        } else {
            retval = await exec.exec(
                'sh',
                [CIMON_SCRIPT_PATH, CIMON_SUBCMD],
                options
            );
        }
    }

    if (retval !== 0) {
        throw new Error(`Failed starting Cimon process: ${exitCode}`);
    }
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
