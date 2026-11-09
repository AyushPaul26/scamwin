#!/usr/bin/env bash
set -euo pipefail

# The authoring tool stays outside the checkout. Runtime assets do not need it.
version=4.5.9
archive="blender-${version}-linux-x64.tar.xz"
expected=dcdc3eca6c9825bb35a8033b689c053f3cb5a9b0cd2a61b2eac2a49436b4ad3d
install_root="${XDG_CACHE_HOME:-$HOME/.cache}/openmods/blender"
target="$install_root/blender-${version}-linux-x64"

if [[ "$(uname -s)" != Linux || "$(uname -m)" != x86_64 ]]; then
  echo 'This helper installs Blender 4.5.9 for Linux x86_64. On other platforms, install the matching official Blender release and run the Python build with its executable.' >&2
  exit 1
fi

if [[ ! -x "$target/blender" ]]; then
  mkdir -p "$install_root"
  staging="$(mktemp -d "$install_root/.download-XXXXXXXX")"
  trap 'rm -rf -- "$staging"' EXIT
  curl --fail --location --silent --show-error --retry 3 \
    "https://download.blender.org/release/Blender4.5/$archive" \
    --output "$staging/$archive"
  printf '%s  %s\n' "$expected" "$staging/$archive" | sha256sum --check --status
  tar -xf "$staging/$archive" -C "$staging"
  mv "$staging/blender-${version}-linux-x64" "$target"
fi

printf '%s\n' "$target/blender"
