import core from '@actions/core';
import exec from '@actions/exec';
import fs from 'fs';

const CIMON_SCRIPT_PATH = '/tmp/install.sh';
const CIMON_SUBCMD = 'stop';

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
    const env = {
        ...process.env,
        CIMON_LOG_LEVEL: config.cimon.logLevel,
    };

    var retval;
    const sudo = await sudoExists();

    if (sudo) {
        retval = await exec.exec(
            'sudo',
            ['-E', 'sh', CIMON_SCRIPT_PATH, CIMON_SUBCMD],
            {
                env,
                silent: false,
            }
        );
    } else {
        retval = await exec.exec('sh', [CIMON_SCRIPT_PATH, CIMON_SUBCMD], {
            env,
            silent: false,
        });
    }
    fs.rmSync(CIMON_SCRIPT_PATH);

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
