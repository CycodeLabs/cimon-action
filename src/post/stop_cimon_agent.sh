#!/bin/bash
set -ueo pipefail

log() {
	if [ "$CIMON_LOG_LEVEL" = "debug" ] || [ "$CIMON_LOG_LEVEL" = "trace" ]; then
		echo "$1"
	fi
}

pidFilePath="/var/run/cimon.pid"
timeoutSeconds=15
sleepInterval=1

if [[ ! -f "$pidFilePath" ]]; then
    >&2 echo "PID file $pidFilePath not found."

    # Could happen if Cimon failed to start.
    if [ -f cimon.err ]; then
        >&2 cat cimon.err
    fi
fi

pid=$(cat "$pidFilePath")
log "Read PID from file $pidFilePath: $pid"
if [[ ! "$pid" =~ ^[0-9]+$ ]]; then
    >&2 echo "Invalid PID format in the file: $pid"
    exit 1
fi

echo "Terminating Cimon process $pid"
kill -2 "$pid"

waitedSeconds=0
while kill -0 "$pid" 2>/dev/null && [[ $waitedSeconds -lt $timeoutSeconds ]]; do
    sleep "$sleepInterval"
    ((waitedSeconds+=sleepInterval))
done

if kill -0 "$pid" 2>/dev/null; then
    >&2 echo "Failed terminating Cimon process in time"
    exit 1
fi

log "Cimon process $pid terminated successfully"

cat "cimon.log"
>&2 cat "cimon.err"

echo "Build runtime security agent finished successfully"