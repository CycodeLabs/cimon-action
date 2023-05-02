import core from '@actions/core';
import artifact from '@actions/artifact';
import fs from 'fs';
import docker from './../docker/docker.js';
import poll from "../poll/poll.js";

function getActionConfig() {
    return {
        job: process.env.GITHUB_JOB,
        createArtifact: core.getBooleanInput('report-artifact-log'),
    };
}

async function run(config) {
    await docker.stopContainer('cimon');

    const logs = await docker.getContainerLogs('cimon');
    core.info(logs.stdout);
    if (logs.stderr !== '') {
        core.error(logs.stderr);
    }

    if (config.createArtifact) {
        const logFile = `cimon-${config.job}-logs.txt`;
        fs.writeFileSync(logFile, logs.stdout);

        if (logs.stderr !== '') {
            fs.appendFileSync(logFile, logs.stderr);
        }

        // The random generator used to differentiate between matrix builds having same job name.
        const artifactName = `cimon-${config.job}-${Math.floor(Math.random() * 10000)}`;
        const artifactFiles = [
            logFile,
        ];
        const options = {
            continueOnError: false
        };
        const artifactClient = artifact.create();
        await artifactClient.uploadArtifact(artifactName, artifactFiles, '.', options);
    }

    const containerState = await poll(async () => {
        const state = await docker.getContainerState('cimon');
        core.debug(`Checking Cimon state: ${state.Status} ...`);
        return state;
    }, (state) => {
        return state.Status !== docker.CONTAINER_STATUS_EXITED;
    }, 1000, 30 * 1000);

    if (logs.stderr !== '') {
        throw new Error(logs.stderr);
    }

    if (containerState.ExitCode !== 0) {
        throw new Error(`Container exited with error: ${containerState.ExitCode}`);
    }

    core.info(`Build runtime security agent finished successfully`);
}

try {
    await run(getActionConfig());
} catch (error) {
    const failOnError = core.getBooleanInput('fail-on-error');
    const log = error.message;
    if (failOnError) {
        core.setFailed(log);
    } else {
        await core.summary
            .addHeading('Cimon Security Report - Failure')
            .addRaw('Cimon encountered an error and was shut down due to the "fail-on-error=false" flag. Details of the error are below:')
            .addCodeBlock(log)
            .write()
    }
}