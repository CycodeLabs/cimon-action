export default async function poll(fn, fnCondition, interval = 1000, timeout = 5000) {
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
