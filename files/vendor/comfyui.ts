/**
 * Local ComfyUI Moody ZIB+ZIT provider for ToonFlow.
 * @version 2.0
 */

interface TextModel {
  name: string;
  modelName: string;
  type: "text";
  think: boolean;
}

interface ImageModel {
  name: string;
  modelName: string;
  type: "image";
  mode: ("text" | "singleImage" | "multiReference")[];
}

interface VideoModel {
  name: string;
  modelName: string;
  type: "video";
  mode: ("text" | "singleImage")[];
  audio: "optional" | false | true;
  durationResolutionMap: { duration: number[]; resolution: string[] }[];
}

interface TTSModel {
  name: string;
  modelName: string;
  type: "tts";
  voices: { title: string; voice: string }[];
}

interface VendorConfig {
  id: string;
  version: string;
  name: string;
  author: string;
  description?: string;
  inputs: { key: string; label: string; type: "text" | "password" | "url"; required: boolean; placeholder?: string }[];
  inputValues: Record<string, string>;
  models: (TextModel | ImageModel | VideoModel | TTSModel)[];
}

interface ImageConfig {
  prompt: string;
  referenceList?: {
    type: "image";
    sourceType: "base64";
    base64: string;
  }[];
  size: "1K" | "2K" | "4K";
  aspectRatio: `${number}:${number}`;
}

interface PollResult {
  completed: boolean;
  data?: string;
  error?: string;
}

declare const urlToBase64: (url: string) => Promise<string>;
declare const pollTask: (fn: () => Promise<PollResult>, interval?: number, timeout?: number) => Promise<PollResult>;
declare const exports: {
  vendor: VendorConfig;
  textRequest: (m: TextModel, t: boolean, tl: 0 | 1 | 2 | 3) => any;
  imageRequest: (c: ImageConfig, m: ImageModel) => Promise<string>;
  videoRequest: (c: any, m: VideoModel) => Promise<string>;
  ttsRequest: (c: any, m: TTSModel) => Promise<string>;
};

const vendor: VendorConfig = {
  id: "comfyui",
  version: "2.0",
  author: "Local",
  name: "ComfyUI Local",
  description: "调用本机 ComfyUI，以 Moody ZIB+ZIT 双模型生图；角色自动启用 SeedVR2，场景和道具默认关闭。",
  inputs: [
    { key: "baseUrl", label: "ComfyUI 地址", type: "url", required: true, placeholder: "http://127.0.0.1:8188" },
  ],
  inputValues: {
    baseUrl: "http://127.0.0.1:8188",
  },
  models: [
    { name: "Moody ZIB+ZIT Local", modelName: "moody-zib-zit-local", type: "image", mode: ["text"] },
  ],
};

const textRequest = () => {
  throw new Error("ComfyUI Local 不提供文本模型");
};

const imageRequest = async (config: ImageConfig): Promise<string> => {
  const baseUrl = vendor.inputValues.baseUrl.replace(/\/+$/, "");
  const isCharacterTask = /(角色标准|角色设定|角色描述|人物角色|人物设定|人物形象|人像特写|四视图|正视图.*侧视图.*后视图|character\s+(?:sheet|design|turnaround)|portrait\s+sheet)/i.test(config.prompt);
  const isSceneTask = /(场景设定|场景描述|场景图|环境设定|环境概念图|地点设定|scene\s+(?:design|sheet|concept)|environment\s+(?:design|concept)|location\s+design)/i.test(config.prompt);
  const isPropTask = /(道具设定|道具描述|道具图|物品设定|物品图|武器设定|prop\s+(?:design|sheet|concept)|object\s+design)/i.test(config.prompt);
  const forceEnableUpscale = /((需要|开启|启用|使用|进行).{0,6}(高清放大|SeedVR2)|高清场景|场景高清)/i.test(config.prompt);
  const forceDisableUpscale = /((不需要|不要|关闭|禁用|无需).{0,6}(高清放大|SeedVR2))/i.test(config.prompt);
  // Explicit prompt instructions override automatic character/scene/prop routing.
  const enableSeedVR2Upscale = !forceDisableUpscale && (forceEnableUpscale || (isCharacterTask && !isSceneTask && !isPropTask));
  const ratioParts = String(config.aspectRatio || "16:9").split(":").map(Number);
  const ratioWidth = ratioParts[0] > 0 ? ratioParts[0] : 16;
  const ratioHeight = ratioParts[1] > 0 ? ratioParts[1] : 9;
  const isTurnaround = /(四视图|character\s+(?:design\s+sheet|turnaround)|正视图.*侧视图.*后视图)/i.test(config.prompt);
  const baseLongSideMap: Record<string, number> = { "1K": 640, "2K": 768, "4K": 960 };
  const seedResolutionMap: Record<string, [number, number]> = {
    "1K": [1024, 1536],
    "2K": [1536, 2304],
    "4K": [2048, 3072],
  };
  const longSide = baseLongSideMap[config.size] || 768;
  let [seedResolution, seedMaxResolution] = seedResolutionMap[config.size] || seedResolutionMap["2K"];
  const roundTo16 = (value: number) => Math.max(256, Math.round(value / 16) * 16);
  const roundTo64 = (value: number) => Math.max(512, Math.round(value / 64) * 64);
  const landscape = ratioWidth >= ratioHeight;
  let width = landscape ? longSide : roundTo16((longSide * ratioWidth) / ratioHeight);
  let height = landscape ? roundTo16((longSide * ratioHeight) / ratioWidth) : longSide;
  if (isTurnaround) {
    width = Math.max(longSide, 768);
    height = roundTo16(width * 0.5);
    seedResolution = Math.max(seedResolution, 1152);
    seedMaxResolution = Math.max(seedMaxResolution, 2304);
  }
  const decodedWidth = roundTo16(width * 1.6);
  const decodedHeight = roundTo16(height * 1.6);
  const tileWidth = roundTo64((decodedWidth * 1.5 + 64) / 2);
  const tileHeight = roundTo64((decodedHeight * 1.5 + 64) / 2);
  const randomSeed = () => Math.floor(Math.random() * 9007199254740990);
  const randomSeed32 = () => Math.floor(Math.random() * 4294967296);
  const normalizedPrompt = isTurnaround
    ? config.prompt
        .replace(/角色标准四视图/g, "角色四栏合成图")
        .replace(/四视图设定图/g, "四栏角色设定图")
        .replace(/四视图一致性/g, "四栏人物一致性")
        .replace(/character\s+turnaround/gi, "character sheet")
    : config.prompt;
  const turnaroundConstraint = isTurnaround
    ? "严格生成一张横向四栏角色设定图，总共只能出现四个人物图像，不是传统的正反左右四视图。四张图总数必须等于四，从左到右依次为：第一栏一张人像特写；第二栏一张完整正视全身；第三栏一张完整左侧视全身；第四栏一张完整后视全身。全身图总共只能三张，侧视图总共只能一张。禁止生成右侧视图，禁止同时生成左右两个侧面，禁止第五个人物。三张全身图等高、等比例、头脚完整、互不遮挡、间距均匀、身份和服装完全一致。 Exactly four人物 images total: one close-up plus exactly three full-body views. Use front, left profile and back only. Never add a right profile or a fifth person. "
    : "";
  const generationPrompt = `${turnaroundConstraint}${normalizedPrompt}`;
  const negativePrompt = `泛黄，模糊，低分辨率，低质量图像，诡异的外观，多余手臂，多余腿部，丑陋，噪点，网格感，JPEG压缩条纹，水印，乱码，意义不明的字符${isTurnaround ? "，三栏，五栏，第五个人物，缺少正视图，右侧视图，左右两个侧面，重复视角，重复侧视图，裁切脚部，人物互相遮挡" : ""}`;

  const prompt: Record<string, any> = {
    "1": {
      class_type: "SaveImage",
      inputs: { filename_prefix: "ToonFlow/moody-zib-zit", images: [enableSeedVR2Upscale ? "21" : "18", 0] },
    },
    "2": {
      class_type: "CLIPLoader",
      inputs: { clip_name: "qwen_3_4b.safetensors", type: "lumina2", device: "default" },
    },
    "3": {
      class_type: "VAELoader",
      inputs: { vae_name: "z_image_vae.safetensors" },
    },
    "4": {
      class_type: "CLIPTextEncode",
      inputs: { text: generationPrompt, clip: ["2", 0] },
    },
    "5": {
      class_type: "CLIPTextEncode",
      inputs: { text: negativePrompt, clip: ["2", 0] },
    },
    "6": {
      class_type: "ConditioningZeroOut",
      inputs: { conditioning: ["5", 0] },
    },
    "7": {
      class_type: "UNETLoader",
      inputs: { unet_name: "Z-image/moodyWildMix_v10Base50steps.safetensors", weight_dtype: "default" },
    },
    "8": {
      class_type: "UNETLoader",
      inputs: { unet_name: "Z-image/moodyPornMix_fp8V10DPOFP8.safetensors", weight_dtype: "default" },
    },
    "9": {
      class_type: "ModelSamplingAuraFlow",
      inputs: { shift: 3, model: ["7", 0] },
    },
    "10": {
      class_type: "ModelSamplingAuraFlow",
      inputs: { shift: 3, model: ["8", 0] },
    },
    "11": {
      class_type: "ModelSamplingAuraFlow",
      inputs: { shift: 3.5, model: ["8", 0] },
    },
    "12": {
      class_type: "EmptySD3LatentImage",
      inputs: { width, height, batch_size: 1 },
    },
    "13": {
      class_type: "KSamplerAdvanced",
      inputs: {
        add_noise: "enable",
        noise_seed: randomSeed(),
        steps: 15,
        cfg: 4,
        sampler_name: "res_multistep",
        scheduler: "simple",
        start_at_step: 0,
        end_at_step: 12,
        return_with_leftover_noise: "enable",
        model: ["9", 0],
        positive: ["4", 0],
        negative: ["5", 0],
        latent_image: ["12", 0],
      },
    },
    "14": {
      class_type: "LatentUpscaleBy",
      inputs: { upscale_method: "bislerp", scale_by: 1.6, samples: ["13", 0] },
    },
    "15": {
      class_type: "KSamplerAdvanced",
      inputs: {
        add_noise: "disable",
        noise_seed: randomSeed(),
        steps: 12,
        cfg: 1,
        sampler_name: "sa_solver",
        scheduler: "beta",
        start_at_step: 4,
        end_at_step: 10000,
        return_with_leftover_noise: "disable",
        model: ["10", 0],
        positive: ["4", 0],
        negative: ["6", 0],
        latent_image: ["14", 0],
      },
    },
    "16": {
      class_type: "VAEDecode",
      inputs: { samples: ["15", 0], vae: ["3", 0] },
    },
    "17": {
      class_type: "UpscaleModelLoader",
      inputs: { model_name: "1x-ITF-SkinDiffDetail-Lite-v1.pth" },
    },
    "18": {
      class_type: "UltimateSDUpscale",
      inputs: {
        upscale_by: 1.5,
        seed: randomSeed(),
        steps: 3,
        cfg: 1,
        sampler_name: "euler_ancestral",
        scheduler: "beta",
        denoise: 0.2,
        mode_type: "Linear",
        tile_width: tileWidth,
        tile_height: tileHeight,
        mask_blur: 64,
        tile_padding: 32,
        seam_fix_mode: "None",
        seam_fix_denoise: 1,
        seam_fix_width: 64,
        seam_fix_mask_blur: 8,
        seam_fix_padding: 16,
        force_uniform_tiles: true,
        tiled_decode: false,
        batch_size: 1,
        image: ["16", 0],
        model: ["11", 0],
        positive: ["4", 0],
        negative: ["6", 0],
        vae: ["3", 0],
        upscale_model: ["17", 0],
      },
    },
    "19": {
      class_type: "SeedVR2LoadVAEModel",
      inputs: {
        model: "ema_vae_fp16.safetensors",
        device: "mps",
        encode_tiled: true,
        encode_tile_size: 768,
        encode_tile_overlap: 96,
        decode_tiled: true,
        decode_tile_size: 768,
        decode_tile_overlap: 96,
        tile_debug: "false",
        offload_device: "none",
        cache_model: false,
      },
    },
    "20": {
      class_type: "SeedVR2LoadDiTModel",
      inputs: {
        model: "seedvr2_ema_7b-Q4_K_M.gguf",
        device: "mps",
        blocks_to_swap: 0,
        swap_io_components: false,
        offload_device: "none",
        cache_model: false,
        attention_mode: "sdpa",
      },
    },
    "21": {
      class_type: "SeedVR2VideoUpscaler",
      inputs: {
        seed: randomSeed32(),
        resolution: seedResolution,
        max_resolution: seedMaxResolution,
        batch_size: 1,
        uniform_batch_size: false,
        color_correction: "lab",
        temporal_overlap: 0,
        prepend_frames: 0,
        input_noise_scale: 0.1,
        latent_noise_scale: 0,
        offload_device: "none",
        enable_debug: false,
        image: ["18", 0],
        dit: ["20", 0],
        vae: ["19", 0],
      },
    },
  };

  const createResponse = await fetch(`${baseUrl}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, client_id: `toonflow-${Date.now()}` }),
  });
  if (!createResponse.ok) throw new Error(`ComfyUI 创建任务失败: ${await createResponse.text()}`);
  const createData = await createResponse.json();
  if (!createData.prompt_id) throw new Error("ComfyUI 未返回 prompt_id");

  const result = await pollTask(
    async (): Promise<PollResult> => {
      const historyResponse = await fetch(`${baseUrl}/history/${createData.prompt_id}`);
      if (!historyResponse.ok) throw new Error(`ComfyUI 查询任务失败: ${await historyResponse.text()}`);
      const history = await historyResponse.json();
      const task = history[createData.prompt_id];
      if (!task) return { completed: false };
      if (task.status?.status_str === "error") {
        const message = task.status?.messages?.find((item: any[]) => item[0] === "execution_error")?.[1]?.exception_message;
        return { completed: true, error: message || "ComfyUI 生图失败" };
      }
      const images = Object.values(task.outputs || {}).flatMap((output: any) => output.images || []);
      if (!images.length) return { completed: false };
      const image = images[0] as any;
      const query = [
        `filename=${encodeURIComponent(image.filename)}`,
        `subfolder=${encodeURIComponent(image.subfolder || "")}`,
        `type=${encodeURIComponent(image.type || "output")}`,
      ].join("&");
      return { completed: true, data: `${baseUrl}/view?${query}` };
    },
    1500,
    1800000,
  );

  if (result.error) throw new Error(result.error);
  if (!result.data) throw new Error("ComfyUI 未返回图片");
  return await urlToBase64(result.data);
};

const videoRequest = async (): Promise<string> => "";
const ttsRequest = async (): Promise<string> => "";

exports.vendor = vendor;
exports.textRequest = textRequest;
exports.imageRequest = imageRequest;
exports.videoRequest = videoRequest;
exports.ttsRequest = ttsRequest;

export {};
