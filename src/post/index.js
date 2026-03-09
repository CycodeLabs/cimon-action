import core from '@actions/core';
import exec from '@actions/exec';
import fs from 'fs';
import * as http from '@actions/http-client';

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
 */
function getCimonPath() {
    const savedPath = core.getState('release-path');
    if (savedPath && fs.existsSync(savedPath)) {
        return savedPath;
    }
    return CIMON_EXECUTABLE_PATH;
}

/**
 * Parses SBOM file entries from cimon agent stop output.
 * Returns an array of {cyclonedx, spdx} objects.
 */
function parseSBOMEntries(output) {
    const entries = [];
    for (const line of output.split('\n')) {
        if (!line.includes('"SBOM files written"')) continue;
        try {
            const parsed = JSON.parse(line);
            if (parsed.cyclonedx || parsed.spdx) {
                entries.push({
                    cyclonedx: parsed.cyclonedx || '',
                    spdx: parsed.spdx || '',
                });
            }
        } catch {
            // Not valid JSON, skip.
        }
    }
    return entries;
}

/**
 * Builds a GitHub Actions job summary with SBOM results.
 */
async function writeSBOMSummary(sbomEntries) {
    if (sbomEntries.length === 0) return;

    const rows = [['Format', 'Path']];
    for (const entry of sbomEntries) {
        if (entry.cyclonedx) {
            rows.push(['CycloneDX', `\`${entry.cyclonedx}\``]);
        }
        if (entry.spdx) {
            rows.push(['SPDX', `\`${entry.spdx}\``]);
        }
    }

    await core.summary
        .addHeading('Cimon SBOM Report', 2)
        .addRaw(
            `**${sbomEntries.length}** SBOM${sbomEntries.length > 1 ? 's' : ''} generated during build.\n\n`
        )
        .addTable(rows)
        .write();
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
    const sbomEntries = parseSBOMEntries(stopOutput);
    if (sbomEntries.length > 0) {
        const reportJobSummary = core.getBooleanInput('report-job-summary');
        if (reportJobSummary) {
            await writeSBOMSummary(sbomEntries);
        }
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
