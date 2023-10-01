#!/bin/sh
set -eu

logFile="/tmp/cimon.log"
errFile="/tmp/cimon.err"

log() {
    if [ "$CIMON_LOG_LEVEL" = "debug" ] || [ "$CIMON_LOG_LEVEL" = "trace" ]; then
        echo "$1"
    fi
}

pidFilePath="/var/run/cimon.pid"
timeoutSeconds=15
sleepInterval=1

if [ ! -f "$pidFilePath" ]; then
    if [ -f cimon.err ]; then
        >&2 echo "Cimon process failed to start. Error log:"
        >&2 cat cimon.err
    else
        >&2 echo "Cimon process failed to start. No error log found."
    fi
    exit 1
fi

pid=$(cat "$pidFilePath")
log "Read PID from file $pidFilePath: $pid"
case $pid in
    ''|*[!0-9]*) >&2 echo "Invalid PID format in the file: $pid" && exit 1 ;;
esac

echo "Terminating Cimon process $pid"
kill -2 "$pid"

waitedSeconds=0
while kill -0 "$pid" 2>/dev/null && [ "$waitedSeconds" -lt "$timeoutSeconds" ]; do
    sleep "$sleepInterval"
    waitedSeconds=$((waitedSeconds + sleepInterval))
done

if kill -0 "$pid" 2>/dev/null; then
    >&2 echo "Failed terminating Cimon process in time"
    exit 1
fi

log "Cimon process $pid terminated successfully"

cat "$logFile"
>&2 cat "$errFile"

echo "Build runtime security agent finished successfully"