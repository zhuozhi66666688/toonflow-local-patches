#!/usr/bin/env python3
"""
Derived from the ComfyUI discussion workaround:
https://github.com/Comfy-Org/ComfyUI/discussions/13273

ComfyUI Apple Silicon FP8/MPS local patcher

Purpose:
- Applies local CPU fallbacks for known FP8-on-MPS failure paths in ComfyUI and comfy-kitchen.
- Designed for macOS / Apple Silicon users running ComfyUI with the MPS backend.
- Useful when ComfyUI updates overwrite local patches.

What it patches:
1. comfy/float.py
   - stochastic_rounding()
   - stochastic_round_quantize_nvfp4()
   - stochastic_round_quantize_nvfp4_by_block()

2. comfy/quant_ops.py
   - _TensorCoreFP8LayoutBase.quantize()

3. comfy_kitchen/backends/eager/quantization.py
   - dequantize_per_tensor_fp8()

Important:
- This is a local workaround, not an official upstream fix.
- Review the printed file paths before relying on the result.
- The script creates timestamped backups before modifying files.
"""

from __future__ import annotations

import argparse
import os
import py_compile
import shutil
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Callable, Iterable


STAMP = datetime.now().strftime("%Y%m%d_%H%M%S")


@dataclass
class PatchResult:
    path: Path
    target: str
    status: str
    message: str


def log(message: str) -> None:
    print(message, flush=True)


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def write_text(path: Path, text: str) -> None:
    path.write_text(text, encoding="utf-8")


def backup_file(path: Path, backup_dir: Path | None = None) -> Path:
    if backup_dir:
        backup_dir.mkdir(parents=True, exist_ok=True)
        backup = backup_dir / f"{path.name}.bak_{STAMP}"
    else:
        backup = path.with_name(path.name + f".bak_{STAMP}")

    shutil.copy2(path, backup)
    return backup


def compile_check(path: Path) -> None:
    py_compile.compile(str(path), doraise=True)


def find_next_top_level_def_or_class(text: str, start: int) -> int:
    """Return index of next top-level def/class after start, or len(text)."""
    import re

    m = re.search(r"\n(?:def|class)\s+\w+", text[start:])
    if not m:
        return len(text)
    return start + m.start()


def replace_range(text: str, start: int, end: int, replacement: str) -> str:
    prefix = text[:start]
    suffix = text[end:]
    if prefix and not prefix.endswith("\n"):
        prefix += "\n"
    if suffix and not suffix.startswith("\n"):
        suffix = "\n" + suffix
    return prefix + replacement.rstrip() + "\n" + suffix


# ==============================================================================
# Patch blocks
# ==============================================================================

PATCHED_STOCHASTIC_ROUNDING = """def stochastic_rounding(value, dtype, seed=0):
    if dtype == torch.float32:
        return value.to(dtype=torch.float32)
    if dtype == torch.float16:
        return value.to(dtype=torch.float16)
    if dtype == torch.bfloat16:
        return value.to(dtype=torch.bfloat16)
    if dtype == torch.float8_e4m3fn or dtype == torch.float8_e5m2:
        on_mps = value.device.type == "mps"
        if on_mps:
            value = value.cpu()

        generator = torch.Generator(device=value.device)
        generator.manual_seed(seed)

        output = torch.empty_like(value, dtype=dtype)
        num_slices = max(1, (value.numel() / (4096 * 4096)))
        slice_size = max(1, round(value.shape[0] / num_slices))

        for i in range(0, value.shape[0], slice_size):
            output[i:i+slice_size].copy_(
                manual_stochastic_round_to_float8(
                    value[i:i+slice_size], dtype, generator=generator
                )
            )

        return output

    return value.to(dtype=dtype)
"""


PATCHED_NVFP4 = """def stochastic_round_quantize_nvfp4(x, per_tensor_scale, pad_16x, seed=0):
    def roundup(x: int, multiple: int) -> int:
        \"\"\"Round up x to the nearest multiple.\"\"\"
        return ((x + multiple - 1) // multiple) * multiple

    # MPS does not support FP8 dtypes used for block scales.
    # Move this quantization step to CPU when the input is on MPS.
    if x.device.type == "mps":
        x = x.cpu()
        if isinstance(per_tensor_scale, torch.Tensor):
            per_tensor_scale = per_tensor_scale.cpu()

    generator = torch.Generator(device=x.device)
    generator.manual_seed(seed)

    # Handle padding
    if pad_16x:
        rows, cols = x.shape
        padded_rows = roundup(rows, 16)
        padded_cols = roundup(cols, 16)
        if padded_rows != rows or padded_cols != cols:
            x = torch.nn.functional.pad(x, (0, padded_cols - cols, 0, padded_rows - rows))

    x, blocked_scaled = stochastic_round_quantize_nvfp4_block(x, per_tensor_scale, generator)
    return x, to_blocked(blocked_scaled, flatten=False)
"""


PATCHED_NVFP4_BY_BLOCK = """def stochastic_round_quantize_nvfp4_by_block(x, per_tensor_scale, pad_16x, seed=0, block_size=4096 * 4096):
    def roundup(x: int, multiple: int) -> int:
        \"\"\"Round up x to the nearest multiple.\"\"\"
        return ((x + multiple - 1) // multiple) * multiple

    # MPS does not support FP8 dtypes used for block scales.
    # Move this quantization step to CPU when the input is on MPS.
    if x.device.type == "mps":
        x = x.cpu()
        if isinstance(per_tensor_scale, torch.Tensor):
            per_tensor_scale = per_tensor_scale.cpu()

    orig_shape = x.shape

    # Handle padding
    if pad_16x:
        rows, cols = x.shape
        padded_rows = roundup(rows, 16)
        padded_cols = roundup(cols, 16)
        if padded_rows != rows or padded_cols != cols:
            x = torch.nn.functional.pad(x, (0, padded_cols - cols, 0, padded_rows - rows))
            orig_shape = x.shape

    orig_shape = list(orig_shape)
    output_fp4 = torch.empty(orig_shape[:-1] + [orig_shape[-1] // 2], dtype=torch.uint8, device=x.device)
    output_block = torch.empty(orig_shape[:-1] + [orig_shape[-1] // 16], dtype=torch.float8_e4m3fn, device=x.device)

    generator = torch.Generator(device=x.device)
    generator.manual_seed(seed)

    num_slices = max(1, (x.numel() / block_size))
    slice_size = max(1, (round(x.shape[0] / num_slices)))
    for i in range(0, x.shape[0], slice_size):
        fp4, block = stochastic_round_quantize_nvfp4_block(x[i: i + slice_size], per_tensor_scale, generator=generator)
        output_fp4[i:i + slice_size].copy_(fp4)
        output_block[i:i + slice_size].copy_(block)

    return output_fp4, to_blocked(output_block, flatten=False)
"""


PATCHED_FP8_LAYOUT_QUANTIZE = """    @classmethod
    def quantize(cls, tensor, scale=None, stochastic_rounding=0, inplace_ops=False):
        if cls.FP8_DTYPE is None:
            raise NotImplementedError(f"{cls.__name__} must define FP8_DTYPE")

        orig_dtype = tensor.dtype
        orig_shape = tuple(tensor.shape)

        if isinstance(scale, str) and scale == "recalculate":
            scale = torch.amax(tensor.abs()).to(dtype=torch.float32) / torch.finfo(cls.FP8_DTYPE).max

        if tensor.dtype not in [torch.float32, torch.bfloat16]:
            # Prevent scale from being too small
            tensor_info = torch.finfo(tensor.dtype)
            scale = (1.0 / torch.clamp((1.0 / scale), min=tensor_info.min, max=tensor_info.max))

        if scale is None:
            scale = torch.ones((), device=tensor.device, dtype=torch.float32)
        if not isinstance(scale, torch.Tensor):
            scale = torch.tensor(scale, device=tensor.device, dtype=torch.float32)

        # MPS does not support FP8 dtypes.
        # Move this quantization step to CPU when the source tensor is on MPS.
        if tensor.device.type == "mps":
            tensor = tensor.cpu()
            scale = scale.cpu()

        if stochastic_rounding > 0:
            if inplace_ops:
                tensor *= (1.0 / scale).to(tensor.dtype)
            else:
                tensor = tensor * (1.0 / scale).to(tensor.dtype)
            qdata = comfy.float.stochastic_rounding(tensor, dtype=cls.FP8_DTYPE, seed=stochastic_rounding)
        else:
            qdata = ck.quantize_per_tensor_fp8(tensor, scale, cls.FP8_DTYPE)

        params = cls.Params(scale=scale.float(), orig_dtype=orig_dtype, orig_shape=orig_shape)
        return qdata, params
"""


PATCHED_DEQUANTIZE_PER_TENSOR_FP8 = """def dequantize_per_tensor_fp8(
    x: torch.Tensor, scale: torch.Tensor, output_type: torch.dtype = torch.bfloat16
) -> torch.Tensor:
    target_device = x.device

    # MPS does not support FP8 dtypes.
    # Perform dequantization on CPU, then move the dequantized output back.
    if x.device.type == "mps":
        x = x.cpu()
        scale = scale.cpu()

    dq_tensor = x.to(dtype=output_type) * scale.to(dtype=output_type)

    if target_device.type == "mps":
        dq_tensor = dq_tensor.to(target_device)

    return dq_tensor
"""


# ==============================================================================
# Patch functions
# ==============================================================================

def patch_float_py_text(text: str) -> tuple[str, list[str]]:
    changes: list[str] = []

    if 'on_mps = value.device.type == "mps"' not in text:
        start = text.find("def stochastic_rounding(value, dtype, seed=0):")
        if start == -1:
            raise RuntimeError("Could not find stochastic_rounding() in float.py")
        end = text.find("\n# TODO: improve this?", start)
        if end == -1:
            end = find_next_top_level_def_or_class(text, start + 1)
        text = replace_range(text, start, end, PATCHED_STOCHASTIC_ROUNDING)
        changes.append("stochastic_rounding()")
    else:
        changes.append("stochastic_rounding() already patched")

    if "def stochastic_round_quantize_nvfp4(" in text:
        start = text.find("def stochastic_round_quantize_nvfp4(x, per_tensor_scale, pad_16x, seed=0):")
        if start != -1:
            end = text.find("\ndef stochastic_round_quantize_nvfp4_by_block", start)
            if end == -1:
                end = find_next_top_level_def_or_class(text, start + 1)
            block = text[start:end]
            if 'if x.device.type == "mps"' not in block:
                text = replace_range(text, start, end, PATCHED_NVFP4)
                changes.append("stochastic_round_quantize_nvfp4()")
            else:
                changes.append("stochastic_round_quantize_nvfp4() already patched")
    else:
        changes.append("stochastic_round_quantize_nvfp4() not found, skipped")

    if "def stochastic_round_quantize_nvfp4_by_block(" in text:
        start = text.find("def stochastic_round_quantize_nvfp4_by_block(")
        if start != -1:
            end = find_next_top_level_def_or_class(text, start + 1)
            block = text[start:end]
            if 'if x.device.type == "mps"' not in block:
                text = replace_range(text, start, end, PATCHED_NVFP4_BY_BLOCK)
                changes.append("stochastic_round_quantize_nvfp4_by_block()")
            else:
                changes.append("stochastic_round_quantize_nvfp4_by_block() already patched")
    else:
        changes.append("stochastic_round_quantize_nvfp4_by_block() not found, skipped")

    return text, changes


def patch_quant_ops_py_text(text: str) -> tuple[str, list[str]]:
    changes: list[str] = []

    class_start = text.find("class _TensorCoreFP8LayoutBase")
    if class_start == -1:
        raise RuntimeError("Could not find class _TensorCoreFP8LayoutBase in quant_ops.py")

    quantize_start = text.find("    @classmethod\n    def quantize(cls, tensor", class_start)
    if quantize_start == -1:
        quantize_start = text.find("    def quantize(cls, tensor", class_start)
        if quantize_start == -1:
            raise RuntimeError("Could not find _TensorCoreFP8LayoutBase.quantize() in quant_ops.py")

    next_class = text.find("\nclass ", quantize_start + 1)
    if next_class == -1:
        next_class = len(text)

    block = text[quantize_start:next_class]
    if 'if tensor.device.type == "mps"' in block and "tensor = tensor.cpu()" in block:
        changes.append("_TensorCoreFP8LayoutBase.quantize() already patched")
        return text, changes

    text = replace_range(text, quantize_start, next_class, PATCHED_FP8_LAYOUT_QUANTIZE)
    changes.append("_TensorCoreFP8LayoutBase.quantize()")
    return text, changes


def patch_kitchen_quantization_py_text(text: str) -> tuple[str, list[str]]:
    changes: list[str] = []

    start = text.find("def dequantize_per_tensor_fp8(")
    if start == -1:
        raise RuntimeError("Could not find dequantize_per_tensor_fp8() in comfy-kitchen quantization.py")

    end = find_next_top_level_def_or_class(text, start + 1)
    block = text[start:end]

    if 'target_device = x.device' in block and 'if x.device.type == "mps"' in block:
        changes.append("dequantize_per_tensor_fp8() already patched")
        return text, changes

    text = replace_range(text, start, end, PATCHED_DEQUANTIZE_PER_TENSOR_FP8)
    changes.append("dequantize_per_tensor_fp8()")
    return text, changes


# ==============================================================================
# Discovery
# ==============================================================================

def default_search_roots(extra_roots: list[Path]) -> list[Path]:
    home = Path.home()
    roots = [
        Path("/Applications/ComfyUI.app/Contents/Resources/ComfyUI"),
        Path("/Applications/ComfyUI.app"),
        home / "ComfyUI",
        home / "Applications",
        home / "Downloads",
        Path.cwd(),
    ]
    roots.extend(extra_roots)

    unique: list[Path] = []
    seen: set[str] = set()
    for root in roots:
        try:
            root = root.expanduser().resolve()
        except Exception:
            root = root.expanduser()

        if root.exists() and str(root) not in seen:
            unique.append(root)
            seen.add(str(root))
    return unique


def should_skip_dir(dirname: str) -> bool:
    skip = {
        ".git",
        "__pycache__",
        "models",
        "output",
        "input",
        "temp",
        "cache",
        ".cache",
        "node_modules",
        ".Trash",
        "Photos Library.photoslibrary",
        "Library",
    }
    return dirname in skip


def iter_candidate_files(roots: Iterable[Path], deep: bool = False) -> Iterable[Path]:
    wanted = {"float.py", "quant_ops.py", "quantization.py"}

    for root in roots:
        if root.is_file() and root.name in wanted:
            yield root
            continue

        max_depth = 8 if deep else 6
        root_parts = len(root.parts)

        for current, dirnames, filenames in os.walk(root):
            current_path = Path(current)
            depth = len(current_path.parts) - root_parts

            dirnames[:] = [
                d for d in dirnames
                if not should_skip_dir(d) and (deep or depth < max_depth)
            ]

            for filename in filenames:
                if filename in wanted:
                    path = current_path / filename
                    if ".bak_" in path.name or path.suffix != ".py":
                        continue
                    yield path


def classify_file(path: Path) -> str | None:
    try:
        text = read_text(path)
    except Exception:
        return None

    if path.name == "float.py" and "def stochastic_rounding(" in text and "torch.float8" in text:
        return "float.py"

    if path.name == "quant_ops.py" and "_TensorCoreFP8LayoutBase" in text and "quantize" in text:
        return "quant_ops.py"

    if path.name == "quantization.py" and "def dequantize_per_tensor_fp8(" in text and "comfy_kitchen" in str(path):
        return "comfy-kitchen quantization.py"

    if path.name == "quantization.py" and "def dequantize_per_tensor_fp8(" in text and "torch.float8" in text:
        return "comfy-kitchen quantization.py"

    return None


def discover_targets(roots: list[Path], deep: bool = False) -> dict[str, list[Path]]:
    targets: dict[str, list[Path]] = {
        "float.py": [],
        "quant_ops.py": [],
        "comfy-kitchen quantization.py": [],
    }

    seen: set[Path] = set()
    for path in iter_candidate_files(roots, deep=deep):
        try:
            resolved = path.resolve()
        except Exception:
            resolved = path

        if resolved in seen:
            continue
        seen.add(resolved)

        kind = classify_file(resolved)
        if kind:
            targets[kind].append(resolved)

    return targets


# ==============================================================================
# Apply
# ==============================================================================

PATCHERS: dict[str, Callable[[str], tuple[str, list[str]]]] = {
    "float.py": patch_float_py_text,
    "quant_ops.py": patch_quant_ops_py_text,
    "comfy-kitchen quantization.py": patch_kitchen_quantization_py_text,
}


def apply_patch_to_file(path: Path, kind: str, dry_run: bool, backup_dir: Path | None) -> PatchResult:
    try:
        original = read_text(path)
        patcher = PATCHERS[kind]
        patched, changes = patcher(original)

        if patched == original:
            return PatchResult(path, kind, "ok", "; ".join(changes))

        if dry_run:
            return PatchResult(path, kind, "would-patch", "; ".join(changes))

        backup = backup_file(path, backup_dir=backup_dir)
        write_text(path, patched)
        compile_check(path)
        return PatchResult(path, kind, "patched", f"{'; '.join(changes)} | backup: {backup}")

    except Exception as e:
        return PatchResult(path, kind, "error", str(e))


PATCHERS: dict[str, Callable[[str], tuple[str, list[str]]]] = {
    "float.py": patch_float_py_text,
    "quant_ops.py": patch_quant_ops_py_text,
    "comfy-kitchen quantization.py": patch_kitchen_quantization_py_text,
}


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Patch ComfyUI / comfy-kitchen FP8-on-MPS fallback paths for Apple Silicon."
    )
    parser.add_argument(
        "--root",
        action="append",
        default=[],
        help="Additional ComfyUI root path to scan. Can be used multiple times."
    )
    parser.add_argument(
        "--deep",
        action="store_true",
        help="Scan deeper inside the default roots. Slower, but useful for unusual installs."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Only show what would be patched. Do not modify files."
    )
    parser.add_argument(
        "--backup-dir",
        default=None,
        help="Optional directory where backups should be stored."
    )

    args = parser.parse_args()

    extra_roots = [Path(p).expanduser() for p in args.root]
    backup_dir = Path(args.backup_dir).expanduser() if args.backup_dir else None

    roots = default_search_roots(extra_roots)

    log("ComfyUI Apple Silicon FP8/MPS local patcher")
    log("=" * 54)
    log("Search roots:")
    for root in roots:
        log(f"  - {root}")
    log("")

    targets = discover_targets(roots, deep=args.deep)

    total_found = sum(len(v) for v in targets.values())
    if total_found == 0:
        log("[error] No matching ComfyUI / comfy-kitchen files were found.")
        log("Try running with --root /path/to/your/ComfyUI or --deep.")
        return 2

    log("Discovered targets:")
    for kind, paths in targets.items():
        if not paths:
            log(f"  - {kind}: not found")
        else:
            for path in paths:
                log(f"  - {kind}: {path}")
    log("")

    results: list[PatchResult] = []
    for kind, paths in targets.items():
        for path in paths:
            result = apply_patch_to_file(path, kind, dry_run=args.dry_run, backup_dir=backup_dir)
            results.append(result)

    log("Patch report:")
    for r in results:
        log(f"  [{r.status}] {r.target}: {r.path}")
        log(f"       {r.message}")

    errors = [r for r in results if r.status == "error"]
    if errors:
        log("")
        log("[done with errors] Some files could not be patched. See messages above.")
        return 1

    log("")
    if args.dry_run:
        log("Dry run completed. No files were modified.")
    else:
        log("Done. If the relevant active files were patched, restart ComfyUI and test your FP8 workflow.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
