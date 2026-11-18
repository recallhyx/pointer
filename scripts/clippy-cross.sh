#!/usr/bin/env bash
# Runs clippy for macOS and Windows from a Linux machine. Lint only: nothing is linked.
#
# ring (rustls, via tauri-plugin-http) compiles C for the target, so each target needs its libc
# headers: zig ships the macOS ones, cargo-xwin downloads the MSVC CRT and Windows SDK (needs
# clang-cl, llvm-lib and lld-link on PATH, e.g. from /usr/lib/llvm-18/bin).
#
#   scripts/clippy-cross.sh            # both targets
#   scripts/clippy-cross.sh macos      # one of: macos, windows
set -euo pipefail

cd "$(dirname "$0")/.."
# A fixed path: cc-rs fingerprints CC, so a new path would rebuild ring every run.
shim="$PWD/target/cross-shim"
mkdir -p "$shim"

macos() {
  # zig picks the target itself and rejects cc-rs's `--target=arm64-apple-macosx`.
  cat >"$shim/zig-cc" <<'EOF'
#!/bin/sh
for a; do shift; case "$a" in --target=*) ;; *) set -- "$@" "$a" ;; esac; done
exec zig cc -target aarch64-macos "$@"
EOF
  printf '#!/bin/sh\nexec zig ar "$@"\n' >"$shim/zig-ar"
  chmod +x "$shim"/zig-*
  CC_aarch64_apple_darwin="$shim/zig-cc" AR_aarch64_apple_darwin="$shim/zig-ar" \
    cargo clippy --all-targets --target aarch64-apple-darwin -- -D warnings
}

windows() {
  PATH="/usr/lib/llvm-18/bin:$PATH" cargo xwin clippy --all-targets --target x86_64-pc-windows-msvc -- -D warnings
}

targets=("$@")
[ ${#targets[@]} -eq 0 ] && targets=(macos windows)
for t in "${targets[@]}"; do
  case "$t" in
    macos | windows) echo "== clippy $t" && "$t" ;;
    *) echo "unknown target: $t (use macos or windows)" >&2 && exit 2 ;;
  esac
done
