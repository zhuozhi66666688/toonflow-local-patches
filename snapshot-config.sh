#!/bin/zsh
set -euo pipefail

ROOT="${0:A:h}"
DB="${HOME}/Library/Application Support/toonflow/data/db2.sqlite"
CONFIG="${ROOT}/config"

if [[ ! -f "${DB}" ]]; then
  print -u2 "未找到 ToonFlow 数据库：${DB}"
  exit 1
fi

mkdir -p "${CONFIG}"

sqlite3 -json "${DB}" \
  "SELECT id, inputValues, models, enable FROM o_vendorConfig ORDER BY id;" |
  jq '
    map(
      .inputValues = (
        (.inputValues | fromjson)
        | del(.apiKey, .ak, .sk, .accessKey, .secretKey, .token)
      )
      | .models = (.models | fromjson)
    )
  ' > "${CONFIG}/vendor-config.public.json"

for table in o_agentDeploy o_skillList o_skillAttribution o_setting o_modelPrompt; do
  query="SELECT * FROM ${table};"
  if [[ "${table}" == "o_setting" ]]; then
    query="SELECT * FROM o_setting WHERE key <> 'tokenKey';"
  fi
  sqlite3 "${DB}" ".mode insert ${table}" "${query}" |
    sed 's/^INSERT INTO/INSERT OR REPLACE INTO/' > "${CONFIG}/${table}.sql"
done

while IFS=$'\t' read -r vendor key value; do
  [[ -z "${value}" ]] && continue
  security add-generic-password \
    -a "${vendor}" \
    -s "ToonFlow Local Patch ${key}" \
    -w "${value}" \
    -U >/dev/null
done < <(
  sqlite3 -separator $'\t' "${DB}" "
    SELECT id, 'apiKey', COALESCE(json_extract(inputValues, '$.apiKey'), '')
      FROM o_vendorConfig
    UNION ALL
    SELECT id, 'ak', COALESCE(json_extract(inputValues, '$.ak'), '')
      FROM o_vendorConfig
    UNION ALL
    SELECT id, 'sk', COALESCE(json_extract(inputValues, '$.sk'), '')
      FROM o_vendorConfig
    UNION ALL
    SELECT id, 'accessKey', COALESCE(json_extract(inputValues, '$.accessKey'), '')
      FROM o_vendorConfig
    UNION ALL
    SELECT id, 'secretKey', COALESCE(json_extract(inputValues, '$.secretKey'), '')
      FROM o_vendorConfig
    UNION ALL
    SELECT id, 'token', COALESCE(json_extract(inputValues, '$.token'), '')
      FROM o_vendorConfig;
  "
)

(
  cd "${ROOT}"
  find files -type f -print0 |
    sort -z |
    xargs -0 shasum -a 256 > "${CONFIG}/files.sha256"
)

chmod 600 "${CONFIG}"/*
print "已导出 ToonFlow 配置；API Key 已保存至 macOS Keychain。"
