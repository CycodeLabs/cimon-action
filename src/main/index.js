import core from '@actions/core';
import exec from '@actions/exec';
import docker from '../docker/docker.js';
import poll from '../poll/poll.js';
import child_process from 'child_process';
import fs from 'fs';
import path from 'path';

function getActionConfig() {
    return {
        docker: {
            image: core.getInput('docker-image'),
            imagePull: core.getBooleanInput('docker-image-pull'),
            username: core.getInput('docker-username'),
            password: core.getInput('docker-password'),
        },
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
            featureGates: core.getMultilineInput('feature-gates'),
        },
        report: {
            processTree: core.getBooleanInput('report-process-tree'),
            slackWebhookEndpoint: core.getInput('slack-webhook-endpoint'),
        },
    };
}

async function run(config) {
    if (core.getBooleanInput('run-as-container')) {
        core.info('Running in a docker mode');
        await runInDocker(config);
    } else {
        core.info('Running in a native mode');
        await runInHost(config);
    }
}

async function runInHost(config) {
    const stdout = fs.openSync('cimon.log', 'a');
    const stderr = fs.openSync('cimon.log', 'a');

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
        CIMON_FEATURE_GATES: config.cimon.featureGates,
        GITHUB_TOKEN: config.github.token,
        CIMON_LOG_LEVEL: config.cimon.logLevel,
    };

    const options = {
        env,
        detached: true,
        stdio: ['ignore', stdout, stderr],
    };

    const scriptPath = path.join('start_cimon_agent.sh');
    if (config.cimon.releasePath != '') {
        const cimon = child_process.spawn(
            'sudo',
            ['-E', 'bash', scriptPath, config.cimon.releasePath],
            options
        );
    } else {
        const cimon = child_process.spawn(
            'sudo',
            ['-E', 'bash', scriptPath],
            options
        );
    }

    cimon.on('close', (code) => {
        console.log(`child process exited with code ${code}`);
    });

    cimon.on('error', (err) => {
        console.error('Failed to start subprocess.');
    });

    cimon.unref();
    // TODO wait for /var/run/cimon.pid

    core.info(`Build runtime security agent started successfully.`);
}

async function runInDocker(config) {
    if (config.docker.username !== '' && config.docker.password !== '') {
        await docker.login(config.docker.username, config.docker.password);
    }

    if (config.docker.imagePull) {
        await docker.imagePull(config.docker.image);
    }

    const envOutput = await exec.getExecOutput('env', [], {
        silent: true,
    });
    if (envOutput.exitCode !== 0) {
        throw new Error(
            `Failed fetching environment variables: ${envOutput.exitCode}: ${envOutput.stderr}`
        );
    }
    fs.writeFileSync('/tmp/.env', envOutput.stdout);

    const args = [
        'container',
        'run',
        '--detach',
        '--name',
        'cimon',
        '--privileged',
        '--pid=host',
        '--network=host',
        '--cgroupns=host',
        '--volume',
        '/sys/kernel/debug:/sys/kernel/debug:ro',
        '--volume',
        `${process.env['RUNNER_TEMP']}:${process.env['RUNNER_TEMP']}`,
        '--env',
        `CIMON_LOG_LEVEL=${config.cimon.logLevel}`,
        '--env',
        `GITHUB_TOKEN=${config.github.token}`,
        '--env-file',
        `/tmp/.env`,
    ];

    if (config.cimon.preventionMode) {
        args.push('--env', 'CIMON_PREVENT=1');
    }

    if (config.cimon.allowedIPs !== '') {
        args.push('--env', `CIMON_ALLOWED_IPS=${config.cimon.allowedIPs}`);
    }

    if (config.cimon.allowedHosts !== '') {
        args.push('--env', `CIMON_ALLOWED_HOSTS=${config.cimon.allowedHosts}`);
    }

    if (config.cimon.ignoredIPNets !== '') {
        args.push(
            '--env',
            `CIMON_IGNORED_IP_NETS=${config.cimon.ignoredIPNets}`
        );
    }

    if (config.github.jobSummary) {
        args.push('--env', 'CIMON_REPORT_GITHUB_JOB_SUMMARY=1');
    }

    if (config.report.processTree) {
        args.push('--env', 'CIMON_REPORT_PROCESS_TREE=1');
    }

    if (config.report.slackWebhookEndpoint) {
        args.push(
            '--env',
            `CIMON_SLACK_WEBHOOK_ENDPOINT=${config.report.slackWebhookEndpoint}`
        );
    }

    if (config.cimon.applyFsEvents) {
        args.push('--env', 'CIMON_APPLY_FS_EVENTS=1');
    }

    if (config.cimon.clientId !== '') {
        args.push('--env', `CIMON_CLIENT_ID=${config.cimon.clientId}`);
    }

    if (config.cimon.secret !== '') {
        args.push('--env', `CIMON_SECRET=${config.cimon.secret}`);
    }

    if (config.cimon.featureGates !== '') {
        args.push('--env', `CIMON_FEATURE_GATES=${config.cimon.featureGates}`);
    }

    args.push(config.docker.image);

    const exitCode = await exec.exec('docker', args, {
        silent: false,
    });

    if (exitCode !== 0) {
        throw new Error(
            'Failed executing docker run command for Cimon container'
        );
    }

    fs.unlinkSync('/tmp/.env');

    const health = await poll(
        async () => {
            const state = await docker.getContainerState('cimon');
            core.debug(
                `Checking Cimon health status: ${state.Health.Status} ...`
            );
            return state.Health;
        },
        (health) => {
            return health.Status !== docker.CONTAINER_STATUS_HEALTHY;
        },
        1000,
        45 * 1000
    );

    if (health.Status !== docker.CONTAINER_STATUS_HEALTHY) {
        const log = health.Log;
        let message =
            'Failed reaching healthy container status for Cimon container';
        if (Array.isArray(log) && log.length > 0) {
            const latestEntry = log[0];
            message += `: exit code: ${latestEntry.ExitCode}: ${latestEntry.Output}`;
        }
        throw new Error(message);
    }

    core.info(
        `Build runtime security agent started successfully: ${config.docker.image}`
    );
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
