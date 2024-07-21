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
            keyless: core.getBooleanInput('keyless'),
            allowTLog: core.getBooleanInput('allow-tlog'),
            allowTimestamp: core.getBooleanInput('allow-timestamp'),
            fulcioServerUrl: core.getInput('fulcio-server-url'),
            rekorServerUrl: core.getInput('rekor-server-url'),
            timestampServerUrl: core.getInput('timestamp-server-url'),
            provenanceOutput: core.getInput('provenance-output'),
            signedProvenanceOutput: core.getInput('signed-provenance-output'),
        },
        report: {
            reportJobSummary: core.getBooleanInput('report-job-summary'),
            reportArtifact: core.getBooleanInput('report-artifact'),
        },
    };
}

async function run(config) {
    let releasePath;

    if (config.cimon.releasePath !== '') {
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

    if (config.attest.imageRef !== '') {
        core.warning(
            'image-ref parameter is deprecated and will be removed in future versions. Please use subjects parameter instead.'
        );
        config.attest.subjects = config.attest.imageRef;
    }

    // Prepare CLI arguments conditionally
    const args = ['attest', 'generate-and-sign'];
    if (config.attest.subjects !== '')
        args.push('--subjects', config.attest.subjects);
    if (config.attest.provenanceOutput !== '')
        args.push('--output-prov', config.attest.provenanceOutput);
    if (config.attest.signedProvenanceOutput !== '')
        args.push('--output-signed-prov', config.attest.signedProvenanceOutput);
    if (config.attest.signKey !== '') args.push('--key', config.attest.signKey);
    if (config.cimon.clientId !== '')
        args.push('--client-id', config.cimon.clientId);
    if (config.cimon.secret !== '') args.push('--secret', config.cimon.secret);
    if (config.cimon.url !== '') args.push('--url', config.cimon.url);
    if (config.cimon.logLevel !== '')
        args.push('--log-level', config.cimon.logLevel);
    if (config.report.reportJobSummary) args.push('--report-job-summary');
    if (config.attest.keyless) {
        args.push('--keyless');
        
        args.push(`--allow-tlog=${config.attest.allowTLog}`);
        args.push(`--allow-timestamp=${config.attest.allowTimestamp}`);

        if (config.attest.fulcioServerUrl !== '') {
            args.push(`--fulcio-server-url=${config.attest.fulcioServerUrl}`);
        }
        
        if (config.attest.rekorServerUrl !== '') {
            args.push(`--rekor-server-url=${config.attest.rekorServerUrl}`);
        }

        if (config.attest.timestampServerUrl !== '') {
            args.push(`--timestamp-server-url=${config.attest.timestampServerUrl}`);
        }
    }

    await exec.exec(releasePath, args, {
        env: {
            ...process.env,
            GITHUB_TOKEN: config.github.token,
        },
    });

    if (config.report.reportArtifact) {
        artifact
            .create()
            .uploadArtifact(
                'provenance',
                [config.attest.provenanceOutput],
                path.dirname(config.attest.provenanceOutput),
                { continueOnError: true }
            );
        if (config.attest.signKey !== '') {
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
