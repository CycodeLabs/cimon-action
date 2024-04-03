import core from '@actions/core';
import exec from '@actions/exec';
import artifact from '@actions/artifact';
import * as http from '@actions/http-client';
import path from 'path';
import fs from 'fs';

const CIMON_SCRIPT_DOWNLOAD_URL =
    'https://cimon-releases.s3.amazonaws.com/install.sh';
const CIMON_SCRIPT_PATH = '/tmp/install.sh';
const CIMON_EXECUTABLE_DIR = '/tmp/cimon';
const CIMON_EXECUTABLE_PATH = '/tmp/cimon/cimon';

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

    const options = {
        env,
    };

    await exec.exec(releasePath, ['attest'], options);

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
