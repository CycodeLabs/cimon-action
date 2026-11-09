// Retries for the release lookup and downloads, shared by the agent action
// (src/main) and the attest action (attest/). Node built-ins only, like the
// rest of src/common.

// Waits before the second, third and fourth attempts.
export const RETRY_DELAYS_MS = [2000, 5000, 10000];

// HTTP statuses worth another attempt: rate limits (GitHub answers 403 or
// 429), a request timeout, and server errors. Anything else, a 404 included,
// will not change on retry.
const RETRYABLE_STATUS = new Set([403, 408, 429]);

// httpStatus returns the HTTP status an error carries, or 0. Downloads set
// httpStatusCode; @actions/http-client's getJson throws errors with
// statusCode.
export function httpStatus(error) {
    if (!error) {
        return 0;
    }
    return error.httpStatusCode || error.statusCode || 0;
}

// isRetryable reports whether a failed request is worth another attempt.
// An error with no HTTP status is a network failure or a timeout, which is
// retried, unless it is a ConfigError (a mistake in the inputs).
export function isRetryable(error) {
    if (error && error.name === 'ConfigError') {
        return false;
    }
    const status = httpStatus(error);
    if (status === 0) {
        return true;
    }
    return RETRYABLE_STATUS.has(status) || status >= 500;
}

function sleepFor(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// withRetry runs fn, and runs it again after each delay while it fails with
// a retryable error. It logs every failed attempt with its error, so the
// HTTP status of a failure always reaches the job log, and throws the last
// error once the attempts run out.
export async function withRetry(
    fn,
    { what, log = () => {}, delays = RETRY_DELAYS_MS, sleep = sleepFor } = {}
) {
    for (let attempt = 0; ; attempt++) {
        try {
            return await fn();
        } catch (error) {
            if (attempt >= delays.length || !isRetryable(error)) {
                throw error;
            }
            const seconds = delays[attempt] / 1000;
            log(
                `${what} failed (${error.message}); retrying in ${seconds}s ` +
                    `(attempt ${attempt + 2} of ${delays.length + 1})`
            );
            await sleep(delays[attempt]);
        }
    }
}
