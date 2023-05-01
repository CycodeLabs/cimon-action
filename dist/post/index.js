import { createRequire as __WEBPACK_EXTERNAL_createRequire } from "module";
/******/ var __webpack_modules__ = ({

/***/ 870:
/***/ ((module) => {

module.exports = eval("require")("@actions/artifact");


/***/ }),

/***/ 244:
/***/ ((module) => {

module.exports = eval("require")("@actions/core");


/***/ }),

/***/ 3:
/***/ ((module) => {

module.exports = eval("require")("@actions/exec");


/***/ }),

/***/ 147:
/***/ ((module) => {

module.exports = __WEBPACK_EXTERNAL_createRequire(import.meta.url)("fs");

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


/***/ }),

/***/ 905:
/***/ ((__webpack_module__, __unused_webpack___webpack_exports__, __nccwpck_require__) => {

__nccwpck_require__.a(__webpack_module__, async (__webpack_handle_async_dependencies__, __webpack_async_result__) => { try {
/* harmony import */ var _actions_core__WEBPACK_IMPORTED_MODULE_0__ = __nccwpck_require__(244);
/* harmony import */ var _actions_artifact__WEBPACK_IMPORTED_MODULE_1__ = __nccwpck_require__(870);
/* harmony import */ var fs__WEBPACK_IMPORTED_MODULE_2__ = __nccwpck_require__(147);
/* harmony import */ var _docker_docker_js__WEBPACK_IMPORTED_MODULE_3__ = __nccwpck_require__(625);
/* harmony import */ var _poll_poll_js__WEBPACK_IMPORTED_MODULE_4__ = __nccwpck_require__(245);






function getActionConfig() {
    return {
        job: process.env.GITHUB_JOB,
        createArtifact: new Boolean(process.env.CIMON_UPLOAD_ARTIFACT),
    };
}

async function run(config) {
    await _docker_docker_js__WEBPACK_IMPORTED_MODULE_3__/* ["default"].stopContainer */ .Z.stopContainer('cimon');

    const logs = await _docker_docker_js__WEBPACK_IMPORTED_MODULE_3__/* ["default"].getContainerLogs */ .Z.getContainerLogs('cimon');
    _actions_core__WEBPACK_IMPORTED_MODULE_0__.info(logs.stdout);
    if (logs.stderr !== '') {
        _actions_core__WEBPACK_IMPORTED_MODULE_0__.error(logs.stderr);
    }

    if (config.createArtifact) {
        const logFile = `cimon-${config.job}-logs.txt`;
        fs__WEBPACK_IMPORTED_MODULE_2__.writeFileSync(logFile, logs.stdout);

        if (logs.stderr !== '') {
            fs__WEBPACK_IMPORTED_MODULE_2__.appendFileSync(logFile, logs.stderr);
        }

        // The random generator used to differentiate between matrix builds having same job name.
        const artifactName = `cimon-${config.job}-${Math.floor(Math.random() * 10000)}`;
        const artifactFiles = [
            logFile,
        ];
        const options = {
            continueOnError: false
        };
        const artifactClient = _actions_artifact__WEBPACK_IMPORTED_MODULE_1__.create();
        await artifactClient.uploadArtifact(artifactName, artifactFiles, '.', options);
    }

    const containerState = await (0,_poll_poll_js__WEBPACK_IMPORTED_MODULE_4__/* ["default"] */ .Z)(async () => {
        const state = await _docker_docker_js__WEBPACK_IMPORTED_MODULE_3__/* ["default"].getContainerState */ .Z.getContainerState('cimon');
        _actions_core__WEBPACK_IMPORTED_MODULE_0__.debug(`Checking Cimon state: ${state.Status} ...`);
        return state;
    }, (state) => {
        return state.Status !== _docker_docker_js__WEBPACK_IMPORTED_MODULE_3__/* ["default"].CONTAINER_STATUS_EXITED */ .Z.CONTAINER_STATUS_EXITED;
    }, 1000, 30 * 1000);

    if (logs.stderr !== '') {
        throw new Error(logs.stderr);
    }

    if (containerState.ExitCode !== 0) {
        throw new Error(`Container exited with error: ${containerState.ExitCode}`);
    }

    _actions_core__WEBPACK_IMPORTED_MODULE_0__.info(`Build runtime security agent finished successfully`);
}

try {
    await run(getActionConfig());
} catch (error) {
    const failOnError = _actions_core__WEBPACK_IMPORTED_MODULE_0__.getBooleanInput('fail-on-error');
    const log = error.message;
    if (failOnError) {
        _actions_core__WEBPACK_IMPORTED_MODULE_0__.setFailed(log);
    } else {
        await _actions_core__WEBPACK_IMPORTED_MODULE_0__.summary.addHeading('Cimon Security Report - Failure')
            .addRaw('Cimon encountered an error and was shut down due to the "fail-on-error=false" flag. Details of the error are below:')
            .addCodeBlock(log)
            .write()
    }
}
__webpack_async_result__();
} catch(e) { __webpack_async_result__(e); } }, 1);

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
/******/ var __webpack_exports__ = __nccwpck_require__(905);
/******/ __webpack_exports__ = await __webpack_exports__;
/******/ 
