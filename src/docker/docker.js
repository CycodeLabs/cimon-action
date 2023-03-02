import exec from '@actions/exec';

/* Get the state of a container with the specified name. */
async function getContainerState(containerName) {
    const options = {
        silent: true,
    };

    const execOutput = await exec.getExecOutput("docker",
        ["inspect", "--format={{json .State}}", containerName], options);

    if (execOutput.exitCode !== 0) {
        throw new Error(`Failed getting container state: ${containerName}: ${execOutput.exitCode}: ${execOutput.stderr}`);
    }

    return JSON.parse(execOutput.stdout);
}

async function stopContainer(containerName) {
    const options = {
        silent: true,
    };
    const exitCode = await exec.exec('docker', ['container', 'stop', containerName], options);
    if (exitCode !== 0) {
        throw new Error(`Failed stopping container: ${containerName}`);
    }
}

async function getContainerLogs(containerName) {
    const execOutput = await exec.getExecOutput(
        'docker', ['container', 'logs', containerName], {
            silent: true,
            maxBuffer: 1024 * 1024 * 200,
        });
    if (execOutput.exitCode !== 0) {
        throw new Error(`Failed getting container logs: ${containerName}: ${execOutput.exitCode}: ${execOutput.stderr}`);
    }
    return {
        stderr: execOutput.stderr,
        stdout: execOutput.stdout,
    };
}

async function imagePull(image) {
    const options = {
        silent: true,
    };
    const exitCode = await exec.exec('docker', ['image', 'pull', '--quiet', image], options);
    if (exitCode !== 0) {
        throw new Error(`Docker image pull failed: ${exitCode}`);
    }
}

async function login(username, password) {
    const options = {
        silent: true,
    };
    const exitCode = await exec.exec('docker', ['login', '--username', username, '--password', password], options);
    if (exitCode !== 0) {
        throw new Error(`Docker login failed: ${exitCode}`);
    }
}

export default  {
    login: login,
    imagePull: imagePull,
    getContainerState: getContainerState,
    stopContainer: stopContainer,
    getContainerLogs: getContainerLogs,
    CONTAINER_STATUS_HEALTHY: 'healthy',
    CONTAINER_STATUS_EXITED: 'exited',
}
