#!/usr/bin/env python3
import argparse
import shutil
from pathlib import Path


ROUTE_START = '// src/routes/production/assets/batchGenerateAssetsImage.ts'
ROUTE_END = '// src/routes/production/assets/deleteAssetsDireve.ts'
MODEL_DECLARATION = (
    '        const deriveImageModel = projectSettingData?.imageModel?.startsWith("comfyui:")\n'
    '          ? "comfyui:flux2-klein-9b-reference-local"\n'
    '          : projectSettingData?.imageModel;\n'
)


def patch_route(source: str) -> tuple[str, bool]:
    start = source.find(ROUTE_START)
    end = source.find(ROUTE_END, start)
    if start < 0 or end < 0:
        raise RuntimeError("未找到衍生资产生成路由，ToonFlow 版本可能已变化")

    route = source[start:end]
    if MODEL_DECLARATION in route:
        return source, False

    settings_line = (
        '        const projectSettingData = await utils_default.db("o_project").where("id", projectId)'
        '.select("imageModel", "imageQuality", "artStyle").first();\n'
    )
    if route.count(settings_line) != 1:
        raise RuntimeError("未找到唯一的项目生图配置读取语句")

    route = route.replace(settings_line, settings_line + MODEL_DECLARATION, 1)

    old_model_record = "            model: projectSettingData?.imageModel\n"
    old_model_call = "            const imageCls = await utils_default.Ai.Image(projectSettingData?.imageModel).run(\n"
    if route.count(old_model_record) != 1 or route.count(old_model_call) != 1:
        raise RuntimeError("衍生资产模型调用结构已变化，拒绝不安全替换")

    route = route.replace(old_model_record, "            model: deriveImageModel\n", 1)
    route = route.replace(
        old_model_call,
        "            const imageCls = await utils_default.Ai.Image(deriveImageModel).run(\n",
        1,
    )
    return source[:start] + route + source[end:], True


def main() -> None:
    parser = argparse.ArgumentParser(description="将 ToonFlow 衍生资产路由到 FLUX2 Klein 9B Reference")
    parser.add_argument("--target", type=Path, required=True)
    parser.add_argument("--backup-dir", type=Path)
    args = parser.parse_args()

    target = args.target.expanduser()
    source = target.read_text(encoding="utf-8")
    patched, changed = patch_route(source)
    if not changed:
        print("衍生资产 Reference 路由已存在。")
        return

    if args.backup_dir:
        backup_dir = args.backup_dir.expanduser()
        backup_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy2(target, backup_dir / target.name)

    target.write_text(patched, encoding="utf-8")
    print("已将 ComfyUI 衍生资产切换为 FLUX2 Klein 9B Reference。")


if __name__ == "__main__":
    main()
