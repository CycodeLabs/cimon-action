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

async function run(config) {
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

    const env = {
        ...process.env,
        CIMON_LOG_LEVEL: config.cimon.logLevel,
    };

    var retval;
    const sudo = await sudoExists();

    if (sudo) {
        retval = await exec.exec(
            'sudo',
            ['-E', CIMON_EXECUTABLE_PATH, 'agent', 'stop'],
            {
                env,
                silent: false,
            }
        );
    } else {
        retval = await exec.exec(CIMON_EXECUTABLE_PATH, ['agent', 'stop'], {
            env,
            silent: false,
        });
    }
    fs.rmSync(CIMON_SCRIPT_PATH);
    fs.rmSync(CIMON_EXECUTABLE_PATH);

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
