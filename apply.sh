#!/bin/zsh
set -euo pipefail

ROOT="${0:A:h}"
DATA="${HOME}/Library/Application Support/toonflow/data"
DB="${DATA}/db2.sqlite"
COMFY_WORKFLOWS="${HOME}/ComfyUI-Installs/ComfyUI/ComfyUI/user/default/workflows"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="${DATA}/local-patch-backups/${STAMP}"

if [[ ! -d "${DATA}" ]]; then
  print -u2 "未找到 ToonFlow 数据目录：${DATA}"
  exit 1
fi

mkdir -p \
  "${BACKUP}/vendor" \
  "${BACKUP}/bridge" \
  "${BACKUP}/skills/production_skills" \
  "${DATA}/vendor" \
  "${DATA}/bridge" \
  "${DATA}/skills/production_skills"

for relative in \
  "vendor/9router.ts" \
  "vendor/9router-video.ts" \
  "vendor/comfyui.ts" \
  "bridge/9router-toonflow-proxy.mjs" \
  "skills/production_skills/9router_grok_video.md"; do
  if [[ -f "${DATA}/${relative}" ]]; then
    cp "${DATA}/${relative}" "${BACKUP}/${relative}"
  fi
  cp "${ROOT}/files/${relative}" "${DATA}/${relative}"
done

if [[ -d "${COMFY_WORKFLOWS}" ]]; then
  cp \
    "${ROOT}/files/comfyui-workflows/YZ金鱼-Moody ZIB+ZIT Mac适配测试版.json" \
    "${COMFY_WORKFLOWS}/YZ金鱼-Moody ZIB+ZIT Mac适配测试版.json"
  cp \
    "${ROOT}/files/comfyui-workflows/YZ金鱼-Flux2+Klein+超级多合一_Mac适配版.json" \
    "${COMFY_WORKFLOWS}/YZ金鱼-Flux2+Klein+超级多合一_Mac适配版.json"
fi

if [[ -f "${DB}" ]]; then
  cp "${DB}" "${BACKUP}/db2.sqlite"
  "${ROOT}/restore-config.sh"
fi

print "补丁已恢复。"
print "备份目录：${BACKUP}"
print "请完全退出并重新打开 ToonFlow。"
print "使用本地生图前，请确认 ComfyUI 正监听 http://127.0.0.1:8188。"
