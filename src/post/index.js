import core from '@actions/core';
import fs from 'fs';
import docker from './../docker/docker.js';
import poll from '../poll/poll.js';

async function run() {
    await docker.stopContainer('cimon');

    const logs = await docker.getContainerLogs('cimon');
    core.info(logs.stdout);
    if (logs.stderr !== '') {
        core.error(logs.stderr);
    }

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
    await run();
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
