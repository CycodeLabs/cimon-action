#!/bin/sh
set -ue

subcmd=agent
pidFilePath="/var/run/cimon.pid"
logFile="/tmp/cimon.log"
errFile="/tmp/cimon.err"

is_command() {
  command -v "$1" >/dev/null
}

get_os() {
    os=$(uname -s | awk '{print tolower($0)}')
    echo "$os"
}

get_arch() {
    arch=$(uname -m | awk '{print tolower($0)}')
    echo "$arch"
}

log() {
    if [ "$CIMON_LOG_LEVEL" = "debug" ] || [ "$CIMON_LOG_LEVEL" = "trace" ]; then
        echo "$1"
    fi
}

http_download_curl() {
    output=$1
    url=$2
    silence="-s"
    if [ "$CIMON_LOG_LEVEL" = "debug" ] || [ "$CIMON_LOG_LEVEL" = "trace" ]; then
        silence=""
    fi
    
    code=$(curl -w '%{http_code}' $silence -L -o "$output" "$url")
    if [ "$code" != "200" ]; then
        return 1
    fi
    return 0
}

check_dependencies() {
    if ! is_command tar; then
        >&2 echo "tar is required to extract the latest release."
        exit 1
    fi
    if ! is_command curl; then
        >&2 echo "curl is required to download the latest release."
        exit 1
    fi
    if ! is_command jq; then
        >&2 echo "jq is required to parse the latest release."
        exit 1
    fi
}

fetch_latest_release() {
    check_dependencies

    release_dir=$(mktemp -d)

    repository="cycodelabs/cimon-releases"
    api_url="https://api.github.com/repos/${repository}/releases/latest"

    log "Fetching latest release from ${api_url}"
    http_download_curl "${release_dir}/release.json" "$api_url"

    os=$(get_os)
    arch=$(get_arch)
    log "Detected OS: ${os}"
    log "Detected architecture: ${arch}"
    name="cimon_${os}_${arch}.tar.gz"
    asset=$(cat "${release_dir}/release.json" | jq '.assets[] | select(.name=="'"$name"'")')
    if [ -z "$asset" ]; then
        >&2 echo "No compatible asset found for os ${os} and architecture ${arch} in the latest release."
        exit 1
    fi
    log "Found release asset: ${asset}"

    download_url=$(echo "$asset" | jq -r .browser_download_url)
    download_path="${release_dir}/${name}"
    log "Downloading from ${download_url}"

    http_download_curl "$download_path" "$download_url"
    log "Downloaded to $download_path"

    extract_tar "$download_path"
}

extract_tar() {
    artifact_path=$1

    extract_dir=$(mktemp -d)
    tar -xzf "$artifact_path" -C "$extract_dir"

    unpacked_exe="${extract_dir}/cimon"

    if [ -z "$unpacked_exe" ]; then
      >&2 echo "Failed to find the unpacked executable."
      exit 1
    fi
    log "Unpacked executable: ${unpacked_exe}"

    mv "$unpacked_exe" ./cimon 2>/dev/null || true
}

wait_for_init() {
    log "Waiting for Cimon agent to be healthy"

    max_attempts=45
    attempt=0
    while [ ! -f "$pidFilePath" ] && [ "$attempt" -lt "$max_attempts" ]; do
        sleep 1
        attempt=$((attempt + 1))
    done
    if [ "$attempt" -eq "$max_attempts" ]; then
        >&2 echo "Failed reaching healthy container status for Cimon agent"
        exit 1
    fi
    log "Cimon agent is healthy"
}

if [ "$#" -eq 1 ]; then
    log "Using provided path to Cimon agent: $1"
    cimon_path=$1
    if [ ! -f "$cimon_path" ]; then
        >&2 echo "The provided path is not a file."
        exit 1
    fi
    mv "$cimon_path" ./cimon 2>/dev/null || true
else
    log "Fetching latest release of Cimon agent"
    fetch_latest_release
fi

chmod +x ./cimon
log "Starting Cimon agent"

# First running Cimon in dry run mode to check configuration and setup errors.
log "Running Cimon in dry run mode"
CIMON_DRY_RUN=1 ./cimon $subcmd 1>$logFile 2>$errFile
if [ -s "$errFile" ]; then
    >&2 echo "Cimon process failed to start. Error log:"
    >&2 cat "$errFile"
    exit 1
fi
log "Running Cimon"
./cimon $subcmd 1>$logFile 2>$errFile &
wait_for_init ./cimon

echo "Build runtime security agent started successfully."
