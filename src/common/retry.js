// Retries for the release lookup and downloads, shared by the agent action
// (src/main) and the attest action (attest/). Node built-ins only, like the
// rest of src/common.

// Waits before the second, third and fourth attempts, for failures that do
// not say how long to wait.
export const RETRY_DELAYS_MS = [2000, 5000, 10000];

// The longest single wait the actions accept. A rate limit that asks for
// more (the hourly limit, which can take up to an hour to reset) fails at
// once instead of holding the job.
export const MAX_WAIT_MS = 2 * 60 * 1000;

// GitHub's wait for a secondary rate limit that names no time.
const SECONDARY_LIMIT_WAIT_MS = 60 * 1000;

// httpStatus returns the HTTP status an error carries, or 0. Downloads set
// httpStatusCode; the release lookup sets statusCode.
export function httpStatus(error) {
    if (!error) {
        return 0;
    }
    return error.httpStatusCode || error.statusCode || 0;
}

function header(headers, name) {
    const value = headers ? headers[name] : undefined;
    return Array.isArray(value) ? value[0] : value;
}

// rateLimitWait returns how long GitHub asks a client to wait after a
// response, in milliseconds, or -1 when the response is not a rate limit.
// It follows GitHub's REST API guidance: wait for retry-after when it is
// set; when x-ratelimit-remaining is 0, wait until x-ratelimit-reset;
// otherwise wait a minute. A 429 is always a rate limit; a 403 is one only
// when its headers or message say so.
//
//   headers: the response headers, with lowercase names (as Node has them).
//   message: the error message GitHub sent in the body, if any.
export function rateLimitWait(status, headers, message = '', now = Date.now()) {
    const retryAfter = header(headers, 'retry-after');
    const remaining = header(headers, 'x-ratelimit-remaining');
    const reset = header(headers, 'x-ratelimit-reset');
    const limited =
        status === 429 ||
        (status === 403 &&
            (retryAfter !== undefined ||
                remaining === '0' ||
                /rate limit/i.test(message)));
    if (!limited) {
        return -1;
    }
    if (retryAfter !== undefined) {
        const seconds = Number(retryAfter);
        if (Number.isFinite(seconds)) {
            return Math.max(0, seconds * 1000);
        }
        const date = Date.parse(retryAfter);
        if (!Number.isNaN(date)) {
            return Math.max(0, date - now);
        }
    }
    if (remaining === '0' && reset !== undefined) {
        const resetAt = Number(reset) * 1000;
        if (Number.isFinite(resetAt)) {
            // A second past the reset, so the next attempt lands after it.
            return Math.max(0, resetAt - now) + 1000;
        }
    }
    return SECONDARY_LIMIT_WAIT_MS;
}

// isRetryable reports whether a failed request is worth another attempt:
// rate limits (an error with retryAfterMs, set from rateLimitWait), 408 and
// 429, server errors, and network failures or timeouts (no HTTP status). A
// ConfigError (a mistake in the inputs) and any other HTTP error, a 404 or a
// 403 that is not a rate limit included, will not change on retry.
export function isRetryable(error) {
    if (error && error.name === 'ConfigError') {
        return false;
    }
    if (error && error.retryAfterMs !== undefined) {
        return true;
    }
    const status = httpStatus(error);
    if (status === 0) {
        return true;
    }
    return status === 408 || status === 429 || status >= 500;
}

function sleepFor(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatWait(ms) {
    const seconds = Math.ceil(ms / 1000);
    return seconds < 120 ? `${seconds}s` : `${Math.ceil(seconds / 60)} min`;
}

// withRetry runs fn, and runs it again while it fails with a retryable
// error, up to delays.length more times. Before each retry it waits for the
// longer of the next delay and the wait a rate-limited response asked for
// (error.retryAfterMs). A wait longer than maxWaitMs ends the retries. Every
// failed attempt is logged with its error, so the HTTP status of a failure
// always reaches the job log, and the last error is thrown.
export async function withRetry(
    fn,
    {
        what,
        log = () => {},
        delays = RETRY_DELAYS_MS,
        maxWaitMs = MAX_WAIT_MS,
        sleep = sleepFor,
    } = {}
) {
    for (let attempt = 0; ; attempt++) {
        try {
            return await fn();
        } catch (error) {
            if (attempt >= delays.length || !isRetryable(error)) {
                throw error;
            }
            const wait = Math.max(delays[attempt], error.retryAfterMs || 0);
            if (wait > maxWaitMs) {
                error.message +=
                    ` (rate-limited: GitHub asks to wait ${formatWait(wait)}, ` +
                    `longer than the ${formatWait(maxWaitMs)} this action waits)`;
                throw error;
            }
            log(
                `${what} failed (${error.message}); retrying in ` +
                    `${formatWait(wait)} (attempt ${attempt + 2} of ${delays.length + 1})`
            );
            await sleep(wait);
        }
    }
}
