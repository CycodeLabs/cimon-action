import core from '@actions/core';
import exec from '@actions/exec';
import artifact from '@actions/artifact';
import * as http from '@actions/http-client';
import path from 'path';
import fs from 'fs';

const CIMON_SCRIPT_DOWNLOAD_URL =
    'https://cimon-releases.s3.amazonaws.com/run.sh';
const CIMON_SCRIPT_PATH = '/tmp/install.sh';
const CIMON_SUBCMD = 'attest';

const httpClient = new http.HttpClient('cimon-action');

async function downloadToFile(url, filePath) {
    const response = await httpClient.get(url);
    const responseBody = await response.readBody();
    fs.writeFileSync(filePath, responseBody);
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
            provenanceOutput: core.getInput('provenance-output'),
            signedProvenanceOutput: core.getInput('signed-provenance-output'),
            githubContext: core.getInput('github-context'),
        },
        report: {
            reportJobSummary: core.getBooleanInput('report-job-summary'),
            reportArtifact: core.getBooleanInput('report-artifact'),
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
        CIMON_SUBJECTS: config.attest.subjects,
        CIMON_ATTEST_IMAGE_REF: config.attest.imageRef,
        CIMON_SIGN_KEY: config.attest.signKey,
        CIMON_PROVENANCE_OUTPUT: config.attest.provenanceOutput,
        CIMON_SIGNED_PROVENANCE_OUTPUT: config.attest.signedProvenanceOutput,
        CIMON_LOG_LEVEL: config.cimon.logLevel,
        CIMON_CLIENT_ID: config.cimon.clientId,
        CIMON_SECRET: config.cimon.secret,
        CIMON_URL: config.cimon.url,
        CIMON_REPORT_JOB_SUMMARY: config.report.reportJobSummary,
        CIMON_REPORT_ARTIFACT: 'false',
        GITHUB_CONTEXT: config.attest.githubContext,
        GITHUB_TOKEN: config.github.token,
    };

    var retval;
    const sudo = await sudoExists();
    const options = {
        env,
    };

    if (config.cimon.releasePath != '') {
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
    fs.rmSync(CIMON_SCRIPT_PATH);

    if (config.report.reportArtifact) {
        artifact
            .create()
            .uploadArtifact(
                'provenance',
                [config.attest.provenanceOutput],
                path.dirname(config.attest.provenanceOutput),
                { continueOnError: true }
            );
        if (config.attest.signKey != '') {
            artifact
                .create()
                .uploadArtifact(
                    'signed-provenance',
                    [config.attest.signedProvenanceOutput],
                    path.dirname(config.attest.signedProvenanceOutput),
                    { continueOnError: true }
                );
        }
    }

    core.info(`Build runtime SLSA provenance finished successfully`);
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
