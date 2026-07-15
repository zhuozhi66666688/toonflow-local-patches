# ToonFlow 本地补丁包

用于在 ToonFlow 升级或数据文件被覆盖后，恢复本机定制：

公共仓库：

```text
https://github.com/zhuozhi66666688/toonflow-local-patches
```

- 9router 自动路由：普通请求使用 `planner-best`，工具调用使用 `claude_kr`
- 9router Grok Video vendor、桥接与生产 Skill
- 顶层及子级 `scriptAgent`、`productionAgent` 模型配置
- ComfyUI Moody ZIB+ZIT 双模型文生图
- Ultimate SD Upscale 与 SeedVR2 高清放大
- ComfyUI 工作流 `YZ金鱼-Moody ZIB+ZIT Mac适配测试版.json`
- FLUX2 Klein 9B FP8 单图与多图参考编辑，最多串联 6 张参考图
- 衍生资产自动使用 FLUX2 Klein 9B Reference，并传入父资产图片
- ComfyUI 工作流 `YZ金鱼-Flux2+Klein+超级多合一_Mac适配版.json`
- 全部供应商模型与地址配置
- 全部 Agent 部署配置
- Skill 列表、Skill 绑定与系统设置
- API Key 的 macOS Keychain 备份与恢复

本目录本身是独立 Git 仓库，可长期保存每次 ToonFlow 本地修复版本。

## 升级后恢复

先退出 ToonFlow，再执行：

```bash
cd "/Users/zhuozhi/Documents/自媒体/AI 漫剧/toonflow-local-patches"
./apply.sh
open "/Applications/ToonFlow.app"
```

本地图片生成还需要启动：

```bash
open -a "/Applications/Comfy Desktop.app"
```

配置发生变更后，重新生成仓库快照：

```bash
./publish.sh "Update ToonFlow local configuration snapshot"
```

`publish.sh` 会依次执行安全快照、密钥排除、文件校验、Git 提交与公共仓库推送。

## 安全说明

- Git 仓库不保存 API Key 明文。
- API Key 保存在 macOS Keychain，`restore-config.sh` 会自动写回 ToonFlow。
- `config/vendor-config.public.json` 只保存非敏感配置与模型列表。
- 每次执行前，会将被替换文件与数据库备份到：
  `~/Library/Application Support/toonflow/data/local-patch-backups/`

## 生图工作流位置

```text
~/ComfyUI-Installs/ComfyUI/ComfyUI/user/default/workflows/
YZ金鱼-Moody ZIB+ZIT Mac适配测试版.json
YZ金鱼-Flux2+Klein+超级多合一_Mac适配版.json
```

在 ComfyUI 左侧“工作流”中即可找到。
