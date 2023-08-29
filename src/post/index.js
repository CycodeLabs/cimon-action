import core from '@actions/core';
import exec from '@actions/exec';
import docker from '../docker/docker.js';
import poll from '../poll/poll.js';
import fs from 'fs';
import path from 'path';

function getActionConfig() {
    return {
        cimon: {
            logLevel: core.getInput('log-level'),
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
    const env = {
        ...process.env,
        CIMON_LOG_LEVEL: config.cimon.logLevel,
    };

    const scriptPath = path.join(__dirname, 'stop_cimon_agent.sh');
    fs.chmodSync(scriptPath, '755');

    const retval = await exec.exec('sudo', ['-E', 'bash', scriptPath], {
        env,
        silent: false,
    });

    if (retval !== 0) {
        throw new Error(`Failed stopping Cimon process: ${retval}`);
    }
}

async function runInDocker(config) {
    await docker.stopContainer('cimon');

    const logs = await docker.getContainerLogs('cimon');
    core.info(logs.stdout);

    const containerState = await poll(
        async () => {
            const state = await docker.getContainerState('cimon');
            core.debug(`Checking Cimon state: ${state.Status} ...`);
            return state;
        },
        (state) => {
            return state.Status !== docker.CONTAINER_STATUS_EXITED;
        },
        1000,
        30 * 1000
    );

    await docker.removeContainer('cimon');

    if (logs.stderr !== '') {
        throw new Error(logs.stderr);
    }

    if (containerState.ExitCode !== 0) {
        throw new Error(
            `Container exited with error: ${containerState.ExitCode}`
        );
    }

    core.info(`Build runtime security agent finished successfully`);
}

try {
    await run(getActionConfig());
} catch (error) {
    const failOnError = core.getBooleanInput('fail-on-error');
    const reportJobSummary = core.getBooleanInput('report-job-summary');
    const log = error.message;
    if (failOnError) {
        core.setFailed(log);
    } else if (reportJobSummary) {
        await core.summary
            .addHeading('Cimon Security Report - Failure')
            .addRaw(
                'Cimon encountered an error and was shut down due to the "fail-on-error=false" flag. Details of the error are below:'
            )
            .addCodeBlock(log)
            .write();
    }
}
