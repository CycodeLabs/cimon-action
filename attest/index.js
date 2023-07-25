import core from '@actions/core';
import exec from '@actions/exec';
import artifact from '@actions/artifact';
import path from 'path';


function getActionConfig() {
    return {
        cimon: {
            logLevel: core.getInput('logLevel'),
            clientId: core.getInput('clientId'),
            secret: core.getInput('secret'),
            url: core.getInput('url'),
            releasePath: core.getInput('releasePath'),
        },
        attest: {
            subjects: core.getInput('subjects'),
            imageRef: core.getInput('imageRef'),
            signKey: core.getInput('signKey'),
            provenanceOutput: core.getInput('provenanceOutput'),
            signedProvenanceOutput: core.getInput('signedProvenanceOutput'),
            githubContext: core.getInput('githubContext'),
        },
        report: {
            reportJobSummary: core.getBooleanInput('reportJobSummary'),
            reportArtifact: core.getBooleanInput('reportArtifact'),
        }
    };
}
  
async function run(config) {
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
        CIMON_REPORT_ARTIFACT: "false",
        GITHUB_CONTEXT: config.attest.githubContext,
    };

    const options = {
        env,
        silent: true,
    };
    
    const scriptPath = path.join(__dirname, 'attest.sh');
    if (config.cimon.releasePath != '') {
        await exec.exec('bash', [scriptPath, config.cimon.releasePath], options);
    } else {
        await exec.exec('bash', [scriptPath], options);
    }

    if (config.report.reportArtifact) {
        artifact.create().uploadArtifact('Cimon-provenance', [config.attest.provenanceOutput], path.dirname(config.attest.provenanceOutput), {continueOnError: true})
        artifact.create().uploadArtifact('Cimon-signed-provenance', [config.attest.signedProvenanceOutput], path.dirname(config.attest.signedProvenanceOutput), {continueOnError: true})
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