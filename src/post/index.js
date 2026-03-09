import core from '@actions/core';
import exec from '@actions/exec';
import fs from 'fs';
import * as http from '@actions/http-client';
import {
    parseSBOMEntries,
    isSBOMEnabled,
    writeSBOMSummary,
} from './sbom-summary.js';

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

/**
 * Determines the Cimon executable path.
 * Prefers the release-path saved by the main step so the same binary
 * is used for both start and stop.
 *
 * Backward compatibility: when the main step was run by an older version
 * of cimon-action that did not call core.saveState('release-path', ...),
 * core.getState() returns '' and we fall back to the default S3-downloaded
 * binary at /tmp/cimon/cimon — exactly the same behavior as before.
 */
function getCimonPath() {
    const savedPath = core.getState('release-path');
    if (savedPath && fs.existsSync(savedPath)) {
        return savedPath;
    }
    return CIMON_EXECUTABLE_PATH;
}

async function run(config) {
    const cimonPath = getCimonPath();

    // Ensure the Cimon binary is available (fallback: download from S3).
    if (!fs.existsSync(cimonPath)) {
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
    }

    const env = {
        ...process.env,
        CIMON_LOG_LEVEL: config.cimon.logLevel,
    };

    // Capture stdout/stderr to parse SBOM entries from the stop output.
    let stopOutput = '';
    const options = {
        env,
        silent: false,
        listeners: {
            stdout: (data) => {
                stopOutput += data.toString();
            },
            stderr: (data) => {
                stopOutput += data.toString();
            },
        },
        ignoreReturnCode: true,
    };

    var retval;
    const sudo = await sudoExists();

    if (sudo) {
        retval = await exec.exec(
            'sudo',
            ['-E', cimonPath, 'agent', 'stop'],
            options
        );
    } else {
        retval = await exec.exec(cimonPath, ['agent', 'stop'], options);
    }

    // Parse and display SBOM summary regardless of stop exit code.
    const reportJobSummary = core.getBooleanInput('report-job-summary');
    if (reportJobSummary) {
        const sbomEntries = parseSBOMEntries(stopOutput);
        const sbomEnabled = isSBOMEnabled(stopOutput);
        await writeSBOMSummary(core, sbomEntries, { sbomEnabled });
    }

    if (retval !== 0) {
        throw new Error(`Failed stopping Cimon process: ${retval}`);
    }
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
