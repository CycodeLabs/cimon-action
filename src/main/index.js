import core from '@actions/core';
import exec from '@actions/exec';
import docker from '../docker/docker.js';
import poll from '../poll/poll.js';

function getActionConfig() {
    const dockerImage = core.getInput('docker-image');
    const dockerImagePull = core.getBooleanInput('docker-image-pull');
    const dockerUsername = core.getInput('docker-username');
    const dockerPassword = core.getInput('docker-password');

    const token = core.getInput('github-token');

    const logLevel = core.getInput('log-level');
    const preventionMode = core.getBooleanInput('prevent');
    const allowedIPs = core.getInput('allowed-ips');
    const allowedHosts = core.getInput('allowed-hosts');

    const applyFsEvents = core.getBooleanInput('apply-fs-events');
    const clientId = core.getInput('client-id');
    const secret = core.getInput('secret');

    const reportJobSummary = core.getBooleanInput('report-job-summary');
    const reportProcessTree = core.getBooleanInput('report-process-tree');
    const reportArtifactLog = core.getBooleanInput('report-artifact-log');
    const slackWebhookEndpoint = core.getInput('slack-webhook-endpoint');
    const featureGates = core.getMultilineInput('feature-gates');

    return {
        docker: {
            image: dockerImage,
            imagePull: dockerImagePull,
            username: dockerUsername,
            password: dockerPassword,
        },
        github: {
            token: token,
        },
        cimon: {
            logLevel: logLevel,
            preventionMode: preventionMode,
            allowedIPs: allowedIPs,
            allowedHosts: allowedHosts,
            applyFsEvents: applyFsEvents,
            clientId: clientId,
            secret: secret,
            featureGates: featureGates,
        },
        report: {
            jobSummary: reportJobSummary,
            processTree: reportProcessTree,
            reportArtifactLog: reportArtifactLog,
            slackWebhookEndpoint: slackWebhookEndpoint,
        },
    };
}

async function run(config) {
    if (config.docker.username !== "" && config.docker.password !== "") {
        await docker.login(config.docker.username, config.docker.password);
    }

    if (config.docker.imagePull) {
        await docker.imagePull(config.docker.image);
    }

    const args = ['container', 'run',
        '--detach',
        '--name', 'cimon',
        '--privileged',
        '--pid=host',
        '--network=host',
        '--cgroupns=host',
        '--volume', '/sys/kernel/debug:/sys/kernel/debug:ro',
        '--volume', '/home/runner/work:/github_workspace',
        '--env', `CIMON_LOG_LEVEL=${config.cimon.logLevel}`,
        '--env', 'GITHUB_ACTIONS=true',
        '--env', `GITHUB_TOKEN=${config.github.token}`,
        '--env', `GITHUB_SHA`,
        '--env', `GITHUB_REPOSITORY`,
        '--env', `GITHUB_REPOSITORY_ID`,
        '--env', `GITHUB_WORKFLOW`,
        '--env', `GITHUB_WORKFLOW_REF`,
        '--env', `GITHUB_REF_NAME`,
        '--env', `GITHUB_REF_PROTECTED`,
        '--env', `GITHUB_HEAD_REF`,
        '--env', `GITHUB_ACTOR`,
        '--env', `GITHUB_JOB`,
        '--env', `GITHUB_EVENT_NAME`,
        '--env', `GITHUB_RUN_ID`,
        '--env', `RUNNER_ARCH`,
        '--env', `RUNNER_NAME`,
        '--env', `RUNNER_OS`,
    ];

    if (config.cimon.preventionMode) {
        args.push('--env', 'CIMON_PREVENT=1');
    }

    if (config.cimon.allowedIPs !== "") {
        args.push('--env', `CIMON_ALLOWED_IPS=${config.cimon.allowedIPs}`);
    }

    if (config.cimon.allowedHosts !== "") {
        args.push('--env', `CIMON_ALLOWED_HOSTS=${config.cimon.allowedHosts}`);
        // TODO Remove the CIMON_ALLOWED_DOMAIN_NAMES setting when we upgrade the default image used by this action.
        args.push('--env', `CIMON_ALLOWED_DOMAIN_NAMES=${config.cimon.allowedHosts}`);
    }

    if (config.report.jobSummary) {
        args.push('--env', 'CIMON_REPORT_GITHUB_JOB_SUMMARY=1');
    }

    if (config.report.processTree) {
        args.push('--env', 'CIMON_REPORT_PROCESS_TREE=1');
    }

    if (config.report.slackWebhookEndpoint) {
        args.push('--env', `CIMON_SLACK_WEBHOOK_ENDPOINT=${config.report.slackWebhookEndpoint}`);
    }

    if (config.cimon.applyFsEvents) {
        args.push('--env', 'CIMON_APPLY_FS_EVENTS=1');
    }

    if (config.cimon.clientId !== "") {
        args.push('--env', `CIMON_CLIENT_ID=${config.cimon.clientId}`);
    }

    if (config.cimon.secret !== "") {
        args.push('--env', `CIMON_SECRET=${config.cimon.secret}`);
    }

    if (config.cimon.featureGates !== "") {
        args.push('--env', `CIMON_FEATURE_GATES=${config.cimon.featureGates}`);
    }

    
    args.push(config.docker.image);

    const exitCode = await exec.exec('docker', args, {
        silent: false,
    });

    if (exitCode !== 0) {
        throw new Error('Failed executing docker run command for Cimon container');
    }

    const health = await poll(async () => {
        const state = await docker.getContainerState('cimon');
        core.debug(`Checking Cimon health status: ${state.Health.Status} ...`);
        return state.Health;
    }, (health) => {
        return health.Status !== docker.CONTAINER_STATUS_HEALTHY;
    }, 1000, 30 * 1000);

    if (health.Status !== docker.CONTAINER_STATUS_HEALTHY) {
        const log = health.Log;
        let message = 'Failed reaching healthy container status for Cimon container';
        if (Array.isArray(log) && log.length > 0) {
            const latestEntry = log[0];
            message += `: exit code: ${latestEntry.ExitCode}: ${latestEntry.Output}`;
        }
        throw new Error(message);
    }

    core.info(`Build runtime security agent started successfully: ${config.docker.image}`);
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