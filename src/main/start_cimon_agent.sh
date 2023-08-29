#!/bin/bash
set -ueo pipefail

subcmd=agent

get_os() {
    local os
    os=$(uname -s | awk '{print tolower($0)}')
    echo "$os"
}

get_arch() {
    local arch
    arch=$(uname -m | awk '{print tolower($0)}')
    echo "$arch"
}

log() {
	if [ "$CIMON_LOG_LEVEL" = "debug" ] || [ "$CIMON_LOG_LEVEL" = "trace" ]; then
		echo "$1"
	fi
}

fetch_latest_release() {
    local repository="cycodelabs/cimon-releases"
    local api_url="https://api.github.com/repos/${repository}/releases/latest"

    log "Fetching latest release from ${api_url}"
    local response
    response=$(curl -s "$api_url")

    os=$(get_os)
    arch=$(get_arch)
    log "Detected OS: ${os}"
    log "Detected architecture: ${arch}"
    local asset
    local name="cimon_${os}_${arch}.tar.gz"
    asset=$(echo "$response" | jq '.assets[] | select(.name=="'"$name"'")')
    if [[ -z "$asset" ]]; then
        >&2 echo "No compatible asset found for os ${os} and architecture ${arch} in the latest release."
        exit 1
    fi
    log "Found release asset: ${asset}"

    local download_url
    download_url=$(echo "$asset" | jq -r .browser_download_url)
    log "Downloading from ${download_url}"

    local download_path="/tmp/${name}"
    curl -sL -o "$download_path" "$download_url"
    log "Downloaded to ${download_path}"

    extract_tar "$download_path"
}

extract_tar() {
    local artifact_path=$1

    local extract_dir
    extract_dir=$(mktemp -d)
    tar -xzf "$artifact_path" -C "$extract_dir"

    local unpacked_exe="${extract_dir}/cimon"

    if [[ -z "$unpacked_exe" ]]; then
      >&2 echo "Failed to find the unpacked executable."
      exit 1
    fi
    log "Unpacked executable: ${unpacked_exe}"

    mv "$unpacked_exe" ./cimon 2>/dev/null || true
}

wait_for_init() {
    log "Waiting for Cimon agent to be healthy"

    local max_attempts=45
    local attempt=0
    local retval=1
    while [[ "$retval" -ne 0 && "$attempt" -lt "$max_attempts" ]]; do
        sleep 1
        retval=$($1 healthcheck 2>/dev/null || echo 1)
        attempt=$((attempt + 1))
    done
    if [[ "$retval" -ne 0 ]]; then
        >&2 echo "Failed reaching healthy container status for Cimon agent"
        exit 1
    fi
    log "Cimon agent is healthy"
}

if [ "$#" -eq 1 ]; then
    log "Using provided path to Cimon agent: $1"
    cimon_path=$1
    if [[ ! -f "$cimon_path" ]]; then
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
./cimon $subcmd 1>cimon.log 2>cimon.err &

wait_for_init ./cimon

echo "Build runtime security agent started successfully."