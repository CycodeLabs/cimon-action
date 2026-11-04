// stopBinary decides which binary the post step runs `agent stop` with.
//
// The main step saves the release-path state only after it has resolved
// (and, for downloads, verified) the binary, and the main and post steps
// always come from the same copy of the action. So:
//   - no saved path: the main step failed before a binary existed, no agent
//     can be running, and the post step has nothing to do;
//   - a saved path that exists: stop with that same binary;
//   - a saved path that is gone: fail rather than install some other
//     release, which could differ from the one the workflow selected.
//
// Returns { path } or { skip: reason }, or throws.
export function stopBinary(savedPath, exists) {
    if (!savedPath) {
        return {
            skip:
                'The main step did not install Cimon, so there is no agent to stop.',
        };
    }
    if (!exists(savedPath)) {
        throw new Error(
            `The Cimon binary the main step ran (${savedPath}) no longer ` +
                `exists, so the agent cannot be stopped.`
        );
    }
    return { path: savedPath };
}
