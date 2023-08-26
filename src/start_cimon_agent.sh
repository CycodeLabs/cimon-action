#!/bin/bash
set -ueo pipefail

subcmd=agent

fetch_latest_release() {
    local repository="cycodelabs/cimon-releases"
    local api_url="https://api.github.com/repos/${repository}/releases/latest"

    local response
    response=$(curl -s "$api_url")

    local arch
    local os
    local asset
    arch=$(uname -m | awk '{print tolower($0)}')
    os=$(uname -s | awk '{print tolower($0)}')
    local name="cimon_${os}_${arch}.tar.gz"
    asset=$(echo "$response" | jq '.assets[] | select(.name=="'"$name"'")')
    if [[ -z "$asset" ]]; then
        echo "No compatible asset found for os ${os} and architecture ${arch} in the latest release." >&2
        exit 1
    fi

    local download_url
    download_url=$(echo "$asset" | jq -r .browser_download_url)
    local download_path="/tmp/${name}"
    curl -sL -o "$download_path" "$download_url"
    echo "$download_path"
}

extract_and_run() {
    local artifact_path=$1

    # Extract the artifact
    local extract_dir
    extract_dir=$(mktemp -d)
    tar -xzf "$artifact_path" -C "$extract_dir"

    local unpacked_exe="${extract_dir}/cimon"

    if [[ -z "$unpacked_exe" ]]; then
      echo "Failed to find the unpacked executable." >&2
      exit 1
    fi

    chmod +x "$unpacked_exe"
    "$unpacked_exe" $subcmd
}

if [ "$#" -eq 1 ]; then
    cimon_path=$1
    if [[ ! -f "$cimon_path" ]]; then
        echo "The provided path is not a file." >&2
        exit 1
    fi
    "$cimon_path" $subcmd
else
    release_tar=$(fetch_latest_release)
    extract_and_run "$release_tar"
fi