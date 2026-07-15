#!/bin/zsh
set -euo pipefail

ROOT="${0:A:h}"
DB="${HOME}/Library/Application Support/toonflow/data/db2.sqlite"
CONFIG="${ROOT}/config"

if [[ ! -f "${DB}" ]]; then
  print -u2 "未找到 ToonFlow 数据库：${DB}"
  exit 1
fi

sql_quote() {
  print -nr -- "$1" | sed "s/'/''/g"
}

jq -c '.[]' "${CONFIG}/vendor-config.public.json" | while IFS= read -r row; do
  vendor="$(jq -r '.id' <<<"${row}")"
  input_values="$(jq -c '.inputValues' <<<"${row}")"
  models="$(jq -c '.models' <<<"${row}")"
  enable="$(jq -r '.enable // 0' <<<"${row}")"

  for key in apiKey ak sk accessKey secretKey token; do
    value="$(security find-generic-password \
      -a "${vendor}" \
      -s "ToonFlow Local Patch ${key}" \
      -w 2>/dev/null || true)"
    if [[ -n "${value}" ]]; then
      input_values="$(jq -c --arg key "${key}" --arg value "${value}" \
        '. + {($key): $value}' <<<"${input_values}")"
    fi
  done

  vendor_sql="$(sql_quote "${vendor}")"
  input_sql="$(sql_quote "${input_values}")"
  models_sql="$(sql_quote "${models}")"
  sqlite3 "${DB}" "
    INSERT INTO o_vendorConfig (id, inputValues, models, enable)
    VALUES ('${vendor_sql}', '${input_sql}', '${models_sql}', ${enable})
    ON CONFLICT(id) DO UPDATE SET
      inputValues = excluded.inputValues,
      models = excluded.models,
      enable = excluded.enable;
  "
done

for table in o_agentDeploy o_skillList o_skillAttribution o_setting o_modelPrompt; do
  if [[ -s "${CONFIG}/${table}.sql" ]]; then
    sqlite3 "${DB}" < "${CONFIG}/${table}.sql"
  fi
done

print "已恢复 ToonFlow 供应商、Agent、Skill 与系统配置。"

