/******/ var __webpack_modules__ = ({

/***/ 244:
/***/ ((module) => {

module.exports = eval("require")("@actions/core");


/***/ }),

/***/ 3:
/***/ ((module) => {

module.exports = eval("require")("@actions/exec");


/***/ }),

/***/ 625:
/***/ ((__unused_webpack___webpack_module__, __webpack_exports__, __nccwpck_require__) => {

/* harmony export */ __nccwpck_require__.d(__webpack_exports__, {
/* harmony export */   "Z": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _actions_exec__WEBPACK_IMPORTED_MODULE_0__ = __nccwpck_require__(3);


/* Get the state of a container with the specified name. */
async function getContainerState(containerName) {
    const options = {
        silent: true,
    };

    const execOutput = await _actions_exec__WEBPACK_IMPORTED_MODULE_0__.getExecOutput("docker",
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
    const exitCode = await _actions_exec__WEBPACK_IMPORTED_MODULE_0__.exec('docker', ['container', 'stop', containerName], options);
    if (exitCode !== 0) {
        throw new Error(`Failed stopping container: ${containerName}`);
    }
}

async function getContainerLogs(containerName) {
    const execOutput = await _actions_exec__WEBPACK_IMPORTED_MODULE_0__.getExecOutput(
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
    const exitCode = await _actions_exec__WEBPACK_IMPORTED_MODULE_0__.exec('docker', ['image', 'pull', '--quiet', image], options);
    if (exitCode !== 0) {
        throw new Error(`Docker image pull failed: ${exitCode}`);
    }
}

async function login(username, password) {
    const options = {
        silent: true,
    };
    const exitCode = await _actions_exec__WEBPACK_IMPORTED_MODULE_0__.exec('docker', ['login', '--username', username, '--password', password], options);
    if (exitCode !== 0) {
        throw new Error(`Docker login failed: ${exitCode}`);
    }
}

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = ({
    login: login,
    imagePull: imagePull,
    getContainerState: getContainerState,
    stopContainer: stopContainer,
    getContainerLogs: getContainerLogs,
    CONTAINER_STATUS_HEALTHY: 'healthy',
    CONTAINER_STATUS_EXITED: 'exited',
});


/***/ }),

/***/ 868:
/***/ ((__webpack_module__, __unused_webpack___webpack_exports__, __nccwpck_require__) => {

__nccwpck_require__.a(__webpack_module__, async (__webpack_handle_async_dependencies__, __webpack_async_result__) => { try {
/* harmony import */ var _actions_core__WEBPACK_IMPORTED_MODULE_0__ = __nccwpck_require__(244);
/* harmony import */ var _actions_exec__WEBPACK_IMPORTED_MODULE_1__ = __nccwpck_require__(3);
/* harmony import */ var _docker_docker_js__WEBPACK_IMPORTED_MODULE_2__ = __nccwpck_require__(625);
/* harmony import */ var _poll_poll_js__WEBPACK_IMPORTED_MODULE_3__ = __nccwpck_require__(245);





function getActionConfig() {
    const dockerImage = _actions_core__WEBPACK_IMPORTED_MODULE_0__.getInput('docker-image');
    const dockerImagePull = _actions_core__WEBPACK_IMPORTED_MODULE_0__.getBooleanInput('docker-image-pull');
    const dockerUsername = _actions_core__WEBPACK_IMPORTED_MODULE_0__.getInput('docker-username');
    const dockerPassword = _actions_core__WEBPACK_IMPORTED_MODULE_0__.getInput('docker-password');

    const token = _actions_core__WEBPACK_IMPORTED_MODULE_0__.getInput('github-token');

    const logLevel = _actions_core__WEBPACK_IMPORTED_MODULE_0__.getInput('log-level');
    const preventionMode = _actions_core__WEBPACK_IMPORTED_MODULE_0__.getBooleanInput('prevent');
    const allowedIPs = _actions_core__WEBPACK_IMPORTED_MODULE_0__.getInput('allowed-ips');
    const allowedHosts = _actions_core__WEBPACK_IMPORTED_MODULE_0__.getInput('allowed-hosts');
    const uploadArtifact = _actions_core__WEBPACK_IMPORTED_MODULE_0__.getBooleanInput('upload-artifact');

    const applyFsEvents = _actions_core__WEBPACK_IMPORTED_MODULE_0__.getBooleanInput('apply-fs-events');
    const clientId = _actions_core__WEBPACK_IMPORTED_MODULE_0__.getInput('client-id');
    const secret = _actions_core__WEBPACK_IMPORTED_MODULE_0__.getInput('secret');

    const reportJobSummary = _actions_core__WEBPACK_IMPORTED_MODULE_0__.getBooleanInput('report-job-summary');
    const reportProcessTree = _actions_core__WEBPACK_IMPORTED_MODULE_0__.getBooleanInput('report-process-tree');
    const slackWebhookEndpoint = _actions_core__WEBPACK_IMPORTED_MODULE_0__.getInput('slack-webhook-endpoint');
    const featureGates = _actions_core__WEBPACK_IMPORTED_MODULE_0__.getMultilineInput('feature-gates');

    return {
        docker: {
            image: dockerImage,
            imagePull: dockerImagePull,
            username: dockerUsername,
            password: dockerPassword,
        },
        github: {
            token: token,
        },
        cimon: {
            logLevel: logLevel,
            preventionMode: preventionMode,
            allowedIPs: allowedIPs,
            allowedHosts: allowedHosts,
            applyFsEvents: applyFsEvents,
            clientId: clientId,
            secret: secret,
            featureGates: featureGates,
            uploadArtifact: uploadArtifact,
        },
        report: {
            jobSummary: reportJobSummary,
            processTree: reportProcessTree,
            slackWebhookEndpoint: slackWebhookEndpoint,
        },
    };
}

async function run(config) {
    if (config.docker.username !== "" && config.docker.password !== "") {
        await _docker_docker_js__WEBPACK_IMPORTED_MODULE_2__/* ["default"].login */ .Z.login(config.docker.username, config.docker.password);
    }

    if (config.docker.imagePull) {
        await _docker_docker_js__WEBPACK_IMPORTED_MODULE_2__/* ["default"].imagePull */ .Z.imagePull(config.docker.image);
    }

    const args = ['container', 'run',
        '--detach',
        '--name', 'cimon',
        '--privileged',
        '--pid=host',
        '--network=host',
        '--cgroupns=host',
        '--volume', '/sys/kernel/debug:/sys/kernel/debug:ro',
        '--volume', '/home/runner/work:/github_workspace',
        '--env', `CIMON_LOG_LEVEL=${config.cimon.logLevel}`,
        '--env', `CIMON_UPLOAD_ARTIFACT=${config.cimon.uploadArtifact}`,
        '--env', 'GITHUB_ACTIONS=true',
        '--env', `GITHUB_TOKEN=${config.github.token}`,
        '--env', `GITHUB_SHA`,
        '--env', `GITHUB_REPOSITORY`,
        '--env', `GITHUB_REPOSITORY_ID`,
        '--env', `GITHUB_WORKFLOW`,
        '--env', `GITHUB_WORKFLOW_REF`,
        '--env', `GITHUB_REF_NAME`,
        '--env', `GITHUB_REF_PROTECTED`,
        '--env', `GITHUB_HEAD_REF`,
        '--env', `GITHUB_ACTOR`,
        '--env', `GITHUB_JOB`,
        '--env', `GITHUB_EVENT_NAME`,
        '--env', `GITHUB_RUN_ID`,
        '--env', `RUNNER_ARCH`,
        '--env', `RUNNER_NAME`,
        '--env', `RUNNER_OS`,
    ];

    if (config.cimon.preventionMode) {
        args.push('--env', 'CIMON_PREVENT=1');
    }

    if (config.cimon.allowedIPs !== "") {
        args.push('--env', `CIMON_ALLOWED_IPS=${config.cimon.allowedIPs}`);
    }

    if (config.cimon.allowedHosts !== "") {
        args.push('--env', `CIMON_ALLOWED_HOSTS=${config.cimon.allowedHosts}`);
        // TODO Remove the CIMON_ALLOWED_DOMAIN_NAMES setting when we upgrade the default image used by this action.
        args.push('--env', `CIMON_ALLOWED_DOMAIN_NAMES=${config.cimon.allowedHosts}`);
    }

    if (config.report.jobSummary) {
        args.push('--env', 'CIMON_REPORT_GITHUB_JOB_SUMMARY=1');
    }

    if (config.report.processTree) {
        args.push('--env', 'CIMON_REPORT_PROCESS_TREE=1');
    }

    if (config.report.slackWebhookEndpoint) {
        args.push('--env', `CIMON_SLACK_WEBHOOK_ENDPOINT=${config.report.slackWebhookEndpoint}`);
    }

    if (config.cimon.applyFsEvents) {
        args.push('--env', 'CIMON_APPLY_FS_EVENTS=1');
    }

    if (config.cimon.clientId !== "") {
        args.push('--env', `CIMON_CLIENT_ID=${config.cimon.clientId}`);
    }

    if (config.cimon.secret !== "") {
        args.push('--env', `CIMON_SECRET=${config.cimon.secret}`);
    }

    if (config.cimon.featureGates !== "") {
        args.push('--env', `CIMON_FEATURE_GATES=${config.cimon.featureGates}`);
    }

    
    args.push(config.docker.image);

    const exitCode = await _actions_exec__WEBPACK_IMPORTED_MODULE_1__.exec('docker', args, {
        silent: false,
    });

    if (exitCode !== 0) {
        throw new Error('Failed executing docker run command for Cimon container');
    }

    const health = await (0,_poll_poll_js__WEBPACK_IMPORTED_MODULE_3__/* ["default"] */ .Z)(async () => {
        const state = await _docker_docker_js__WEBPACK_IMPORTED_MODULE_2__/* ["default"].getContainerState */ .Z.getContainerState('cimon');
        _actions_core__WEBPACK_IMPORTED_MODULE_0__.debug(`Checking Cimon health status: ${state.Health.Status} ...`);
        return state.Health;
    }, (health) => {
        return health.Status !== _docker_docker_js__WEBPACK_IMPORTED_MODULE_2__/* ["default"].CONTAINER_STATUS_HEALTHY */ .Z.CONTAINER_STATUS_HEALTHY;
    }, 1000, 30 * 1000);

    if (health.Status !== _docker_docker_js__WEBPACK_IMPORTED_MODULE_2__/* ["default"].CONTAINER_STATUS_HEALTHY */ .Z.CONTAINER_STATUS_HEALTHY) {
        const log = health.Log;
        let message = 'Failed reaching healthy container status for Cimon container';
        if (Array.isArray(log) && log.length > 0) {
            const latestEntry = log[0];
            message += `: exit code: ${latestEntry.ExitCode}: ${latestEntry.Output}`;
        }
        throw new Error(message);
    }

    _actions_core__WEBPACK_IMPORTED_MODULE_0__.info(`Build runtime security agent started successfully: ${config.docker.image}`);
}

try {
    await run(getActionConfig());
} catch (error) {
    const failOnError = _actions_core__WEBPACK_IMPORTED_MODULE_0__.getBooleanInput('fail-on-error');
    const log = error.message;
    if (failOnError) {
        _actions_core__WEBPACK_IMPORTED_MODULE_0__.setFailed(log);
    }
}
__webpack_async_result__();
} catch(e) { __webpack_async_result__(e); } }, 1);

/***/ }),

/***/ 245:
/***/ ((__unused_webpack___webpack_module__, __webpack_exports__, __nccwpck_require__) => {

/* harmony export */ __nccwpck_require__.d(__webpack_exports__, {
/* harmony export */   "Z": () => (/* binding */ poll)
/* harmony export */ });
async function poll(fn, fnCondition, interval = 1000, timeout = 5000) {
    let hasTimedOut = false;
    let timeoutID;

    timeoutID = setTimeout(() => {
        hasTimedOut = true;
    }, timeout);

    try {
        let result = await fn();
        while (fnCondition(result)) {
            if (hasTimedOut) {
                break;
            }
            await wait(interval);
            result = await fn();
        }
        return result;
    } finally {
        clearTimeout(timeoutID);
    }
}

function wait(ms = 1000) {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}


/***/ })

/******/ });
/************************************************************************/
/******/ // The module cache
/******/ var __webpack_module_cache__ = {};
/******/ 
/******/ // The require function
/******/ function __nccwpck_require__(moduleId) {
/******/ 	// Check if module is in cache
/******/ 	var cachedModule = __webpack_module_cache__[moduleId];
/******/ 	if (cachedModule !== undefined) {
/******/ 		return cachedModule.exports;
/******/ 	}
/******/ 	// Create a new module (and put it into the cache)
/******/ 	var module = __webpack_module_cache__[moduleId] = {
/******/ 		// no module.id needed
/******/ 		// no module.loaded needed
/******/ 		exports: {}
/******/ 	};
/******/ 
/******/ 	// Execute the module function
/******/ 	var threw = true;
/******/ 	try {
/******/ 		__webpack_modules__[moduleId](module, module.exports, __nccwpck_require__);
/******/ 		threw = false;
/******/ 	} finally {
/******/ 		if(threw) delete __webpack_module_cache__[moduleId];
/******/ 	}
/******/ 
/******/ 	// Return the exports of the module
/******/ 	return module.exports;
/******/ }
/******/ 
/************************************************************************/
/******/ /* webpack/runtime/async module */
/******/ (() => {
/******/ 	var webpackQueues = typeof Symbol === "function" ? Symbol("webpack queues") : "__webpack_queues__";
/******/ 	var webpackExports = typeof Symbol === "function" ? Symbol("webpack exports") : "__webpack_exports__";
/******/ 	var webpackError = typeof Symbol === "function" ? Symbol("webpack error") : "__webpack_error__";
/******/ 	var resolveQueue = (queue) => {
/******/ 		if(queue && !queue.d) {
/******/ 			queue.d = 1;
/******/ 			queue.forEach((fn) => (fn.r--));
/******/ 			queue.forEach((fn) => (fn.r-- ? fn.r++ : fn()));
/******/ 		}
/******/ 	}
/******/ 	var wrapDeps = (deps) => (deps.map((dep) => {
/******/ 		if(dep !== null && typeof dep === "object") {
/******/ 			if(dep[webpackQueues]) return dep;
/******/ 			if(dep.then) {
/******/ 				var queue = [];
/******/ 				queue.d = 0;
/******/ 				dep.then((r) => {
/******/ 					obj[webpackExports] = r;
/******/ 					resolveQueue(queue);
/******/ 				}, (e) => {
/******/ 					obj[webpackError] = e;
/******/ 					resolveQueue(queue);
/******/ 				});
/******/ 				var obj = {};
/******/ 				obj[webpackQueues] = (fn) => (fn(queue));
/******/ 				return obj;
/******/ 			}
/******/ 		}
/******/ 		var ret = {};
/******/ 		ret[webpackQueues] = x => {};
/******/ 		ret[webpackExports] = dep;
/******/ 		return ret;
/******/ 	}));
/******/ 	__nccwpck_require__.a = (module, body, hasAwait) => {
/******/ 		var queue;
/******/ 		hasAwait && ((queue = []).d = 1);
/******/ 		var depQueues = new Set();
/******/ 		var exports = module.exports;
/******/ 		var currentDeps;
/******/ 		var outerResolve;
/******/ 		var reject;
/******/ 		var promise = new Promise((resolve, rej) => {
/******/ 			reject = rej;
/******/ 			outerResolve = resolve;
/******/ 		});
/******/ 		promise[webpackExports] = exports;
/******/ 		promise[webpackQueues] = (fn) => (queue && fn(queue), depQueues.forEach(fn), promise["catch"](x => {}));
/******/ 		module.exports = promise;
/******/ 		body((deps) => {
/******/ 			currentDeps = wrapDeps(deps);
/******/ 			var fn;
/******/ 			var getResult = () => (currentDeps.map((d) => {
/******/ 				if(d[webpackError]) throw d[webpackError];
/******/ 				return d[webpackExports];
/******/ 			}))
/******/ 			var promise = new Promise((resolve) => {
/******/ 				fn = () => (resolve(getResult));
/******/ 				fn.r = 0;
/******/ 				var fnQueue = (q) => (q !== queue && !depQueues.has(q) && (depQueues.add(q), q && !q.d && (fn.r++, q.push(fn))));
/******/ 				currentDeps.map((dep) => (dep[webpackQueues](fnQueue)));
/******/ 			});
/******/ 			return fn.r ? promise : getResult();
/******/ 		}, (err) => ((err ? reject(promise[webpackError] = err) : outerResolve(exports)), resolveQueue(queue)));
/******/ 		queue && (queue.d = 0);
/******/ 	};
/******/ })();
/******/ 
/******/ /* webpack/runtime/define property getters */
/******/ (() => {
/******/ 	// define getter functions for harmony exports
/******/ 	__nccwpck_require__.d = (exports, definition) => {
/******/ 		for(var key in definition) {
/******/ 			if(__nccwpck_require__.o(definition, key) && !__nccwpck_require__.o(exports, key)) {
/******/ 				Object.defineProperty(exports, key, { enumerable: true, get: definition[key] });
/******/ 			}
/******/ 		}
/******/ 	};
/******/ })();
/******/ 
/******/ /* webpack/runtime/hasOwnProperty shorthand */
/******/ (() => {
/******/ 	__nccwpck_require__.o = (obj, prop) => (Object.prototype.hasOwnProperty.call(obj, prop))
/******/ })();
/******/ 
/******/ /* webpack/runtime/compat */
/******/ 
/******/ if (typeof __nccwpck_require__ !== 'undefined') __nccwpck_require__.ab = new URL('.', import.meta.url).pathname.slice(import.meta.url.match(/^file:\/\/\/\w:/) ? 1 : 0, -1) + "/";
/******/ 
/************************************************************************/
/******/ 
/******/ // startup
/******/ // Load entry module and return exports
/******/ // This entry module used 'module' so it can't be inlined
/******/ var __webpack_exports__ = __nccwpck_require__(868);
/******/ __webpack_exports__ = await __webpack_exports__;
/******/ 
