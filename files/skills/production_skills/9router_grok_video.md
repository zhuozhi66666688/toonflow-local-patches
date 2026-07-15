---
name: 9router_grok_video
description: 使用 9router Grok Video 从单张首帧图片生成视频，适用于 Grok 视频、首帧生视频和图生视频任务。
---

# 9router Grok 视频生成

## 触发词

`#9router视频`、`9router视频`、`Grok视频`、`Grok Imagine Video`、`首帧生视频`、`图生视频`

## 使用规则

1. 选择供应商 `9router Grok Video`。
2. 必须提供且仅提供一张首帧图片。
3. 默认选择 `Grok Imagine Video 1.5 720p`、6 秒；明确要求 1080p 时才选择 1080p 模型。
4. 提示词应描述人物动作、表情、环境运动、运镜和节奏，避免重复描述静态画面。
5. 每次提交可能计费。一次请求只提交一次任务；失败、超时或状态不明时禁止自动重试、切换模型或重新生成。
6. 仅轮询已有 `request_id`，不创建隐藏变体。
