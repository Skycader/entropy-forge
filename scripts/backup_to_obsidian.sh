#!/usr/bin/env bash
# Backup of this project as a .zip into the Obsidian vault (synced to clouds, disks, phone) —
# an extra safety layer in case the GitHub/GitLab account is lost.
#
# Usage:  bash scripts/backup_to_obsidian.sh [--dest "<folder>"]
#
# The archive is exactly the committed tree of HEAD (git archive): no .git, no uncommitted changes.
# Name: <Project>_<YYYY-MM-DD>_<HHMM>_<hash8>.zip; skipped if an archive of this commit already exists.
set -euo pipefail

DEFAULT_DEST='C:\Users\Skycader\Documents\Obsidian Vault\12. Projects'

die(){ echo "error: $1" >&2; exit "${2:-1}"; }

# ---- arguments ----
dest="$DEFAULT_DEST"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dest)
      [[ $# -ge 2 && -n "$2" ]] || die "--dest needs a folder" 2
      dest="$2"; shift 2 ;;
    --dest=*)
      dest="${1#--dest=}"
      [[ -n "$dest" ]] || die "--dest needs a folder" 2
      shift ;;
    *)
      die "unknown argument: $1 (usage: bash scripts/backup_to_obsidian.sh [--dest \"<folder>\"])" 2 ;;
  esac
done

# ---- repository ----
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
git -C "$root" rev-parse --is-inside-work-tree >/dev/null 2>&1 \
  || die "$root is not a git repository" 1
git -C "$root" rev-parse --verify --quiet HEAD >/dev/null \
  || die "the repository has no commits yet — nothing to archive" 1

project="$(basename "$root")"
hash="$(git -C "$root" rev-parse --short=8 HEAD)"

# ---- destination (Windows path -> POSIX path in Git Bash) ----
if [[ "$dest" =~ ^[A-Za-z]:[\\/] || "$dest" == *\\* ]] && command -v cygpath >/dev/null 2>&1; then
  dest="$(cygpath -u "$dest")"
fi
mkdir -p "$dest"

# ---- already backed up? ----
shopt -s nullglob
existing=("$dest/${project}_"*"_${hash}.zip")
shopt -u nullglob
if [[ ${#existing[@]} -gt 0 ]]; then
  echo "backup skipped: commit $hash is already archived: ${existing[0]}"
  exit 0
fi

# ---- uncommitted changes are NOT in the archive ----
if [[ -n "$(git -C "$root" status --porcelain)" ]]; then
  echo "warning: there are uncommitted changes — they are NOT in the backup (the archive is exactly commit $hash)" >&2
fi

# ---- write to .partial, then move into place ----
file="$dest/${project}_$(date +%Y-%m-%d_%H%M)_${hash}.zip"
partial="$file.partial"
cleanup(){ if [[ -n "$partial" && -e "$partial" ]]; then rm -f -- "$partial"; fi; }
trap cleanup EXIT

git -C "$root" archive --format=zip --prefix="$project/" -o "$partial" HEAD
[[ -s "$partial" ]] || die "the archive came out empty: $partial" 1
mv -- "$partial" "$file"
partial=""

bytes="$(stat -c %s -- "$file")"
size="$(awk -v b="$bytes" 'BEGIN{
  if (b >= 1048576) printf "%.1f MB", b/1048576;
  else if (b >= 1024) printf "%.1f KB", b/1024;
  else printf "%d B", b }')"
echo "backup OK: $file ($size, commit $hash)"
