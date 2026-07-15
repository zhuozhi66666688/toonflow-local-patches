#!/bin/zsh
set -euo pipefail

ROOT="${0:A:h}"
MESSAGE="${1:-Update ToonFlow local patches}"
ASKPASS=""

cleanup() {
  [[ -n "${ASKPASS}" ]] && rm -f "${ASKPASS}"
}
trap cleanup EXIT

cd "${ROOT}"

./snapshot-config.sh
zsh -n apply.sh restore-config.sh snapshot-config.sh publish.sh
jq empty config/vendor-config.public.json
shasum -a 256 -c config/files.sha256

git add -A
if ! git diff --cached --quiet; then
  git commit -m "${MESSAGE}"
fi

if ! command -v gh >/dev/null 2>&1; then
  print -u2 "未找到 GitHub CLI：gh"
  exit 1
fi

ASKPASS="$(mktemp /tmp/toonflow-git-askpass.XXXXXX)"
cat > "${ASKPASS}" <<'SH'
#!/bin/sh
case "$1" in
  *Username*) printf '%s\n' 'x-access-token' ;;
  *Password*) printf '%s\n' "$GITHUB_TOKEN" ;;
esac
SH
chmod 700 "${ASKPASS}"

GITHUB_TOKEN="$(gh auth token)" \
GIT_ASKPASS="${ASKPASS}" \
GIT_TERMINAL_PROMPT=0 \
git push origin main

print "已推送 ToonFlow 公共补丁仓库。"
