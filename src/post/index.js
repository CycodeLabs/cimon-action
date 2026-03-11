import core from '@actions/core';
import exec from '@actions/exec';
import fs from 'fs';
import path from 'path';
import * as http from '@actions/http-client';
import { DefaultArtifactClient } from '@actions/artifact';
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

    // Parse SBOM entries from the stop output (always, for upload and summary).
    const sbomEntries = parseSBOMEntries(stopOutput);
    const sbomEnabled = isSBOMEnabled(stopOutput);

    // Display SBOM summary in job summary.
    const reportJobSummary = core.getBooleanInput('report-job-summary');
    if (reportJobSummary) {
        await writeSBOMSummary(core, sbomEntries, { sbomEnabled });
    }

    // Upload SBOM files as artifacts (best-effort, never fails the workflow).
    await uploadSBOMArtifacts(sbomEntries);

    if (retval !== 0) {
        throw new Error(`Failed stopping Cimon process: ${retval}`);
    }
}

/**
 * Uploads SBOM files as GitHub Actions artifacts after cimon stop.
 * This runs in the post step — after cimon has flushed all SBOMs to disk —
 * so files are guaranteed to exist (unlike user upload steps that may race
 * with async SBOM generation).
 *
 * Best-effort: errors are logged as warnings, never fail the workflow.
 */
async function uploadSBOMArtifacts(sbomEntries) {
    if (!sbomEntries || sbomEntries.length === 0) return;

    // Collect all existing SBOM files from parsed entries.
    const filesToUpload = [];
    for (const entry of sbomEntries) {
        // Skip entries with trivial content (TryCompile noise, etc.)
        if (entry.hasStats && entry.components <= 1 && entry.relationships === 0 && entry.artifacts === 0) {
            continue;
        }
        for (const filePath of [entry.cyclonedx, entry.spdx]) {
            if (filePath && fs.existsSync(filePath)) {
                filesToUpload.push(filePath);
            }
        }
    }

    if (filesToUpload.length === 0) {
        core.info('SBOM: no files to upload as artifacts');
        return;
    }

    // Also include evidence files if they sit alongside the SBOMs.
    for (const sbomFile of [...filesToUpload]) {
        const dir = path.dirname(sbomFile);
        const evidencePath = path.join(dir, 'sbom.evidence.json');
        if (fs.existsSync(evidencePath) && !filesToUpload.includes(evidencePath)) {
            filesToUpload.push(evidencePath);
        }
    }

    // Determine the common root directory for all files.
    const rootDir = findCommonRoot(filesToUpload);

    try {
        const artifact = new DefaultArtifactClient();
        const { id, size } = await artifact.uploadArtifact(
            'cimon-sbom',
            filesToUpload,
            rootDir,
            { retentionDays: 90 }
        );
        core.info(`SBOM: uploaded ${filesToUpload.length} files as artifact (id=${id}, size=${size})`);
    } catch (err) {
        // Best-effort — never fail the workflow because of upload issues.
        core.warning(`SBOM: artifact upload failed (non-fatal): ${err.message}`);
    }
}

/**
 * Find the longest common directory prefix for a list of absolute paths.
 */
function findCommonRoot(paths) {
    if (paths.length === 0) return '/';
    if (paths.length === 1) return path.dirname(paths[0]);

    const dirs = paths.map((p) => path.dirname(p));
    const segments = dirs[0].split(path.sep);
    let common = '';
    for (let i = 0; i < segments.length; i++) {
        const candidate = segments.slice(0, i + 1).join(path.sep) || path.sep;
        if (dirs.every((d) => d.startsWith(candidate + path.sep) || d === candidate)) {
            common = candidate;
        } else {
            break;
        }
    }
    return common || path.sep;
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
