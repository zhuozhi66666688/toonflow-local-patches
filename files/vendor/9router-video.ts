/**
 * Bafang Grok Imagine Video provider for ToonFlow.
 * @version 1.0
 */

type VideoMode = "singleImage" | "text";

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
  mode: VideoMode[];
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

type ReferenceList = { type: "image"; sourceType?: "base64"; base64: string };

interface VideoConfig {
  duration: number;
  resolution: string;
  aspectRatio: "16:9" | "9:16";
  prompt: string;
  referenceList?: ReferenceList[];
  audio?: boolean;
  mode: VideoMode[] | VideoMode;
}

interface PollResult {
  completed: boolean;
  data?: string;
  error?: string;
}

declare const axios: any;
declare const logger: (msg: string) => void;
declare const zipImage: (base64: string, size: number) => Promise<string>;
declare const urlToBase64: (url: string) => Promise<string>;
declare const pollTask: (fn: () => Promise<PollResult>, interval?: number, timeout?: number) => Promise<PollResult>;
declare const exports: {
  vendor: VendorConfig;
  textRequest: (m: TextModel, t: boolean, tl: 0 | 1 | 2 | 3) => any;
  imageRequest: (c: any, m: ImageModel) => Promise<string>;
  videoRequest: (c: VideoConfig, m: VideoModel) => Promise<string>;
  ttsRequest: (c: any, m: TTSModel) => Promise<string>;
};

const durations = Array.from({ length: 15 }, (_, index) => index + 1);

const vendor: VendorConfig = {
  id: "9router-video",
  version: "1.0",
  author: "Local",
  name: "9router Grok Video",
  description: "使用本机 9router 中已启用的 Bafang 凭据，调用 Grok Imagine Video 1.5 首帧图生视频。",
  inputs: [
    { key: "apiKey", label: "Bafang API密钥", type: "password", required: true },
    { key: "baseUrl", label: "请求地址", type: "url", required: true, placeholder: "https://bafang.me/v1" },
  ],
  inputValues: { apiKey: "", baseUrl: "https://bafang.me/v1" },
  models: [
    {
      name: "Grok Imagine Video 1.5 720p",
      modelName: "grok-imagine-video-1.5-720p",
      type: "video",
      mode: ["singleImage"],
      audio: false,
      durationResolutionMap: [{ duration: durations, resolution: ["720P"] }],
    },
    {
      name: "Grok Imagine Video 1.5 1080p",
      modelName: "grok-imagine-video-1.5-1080p",
      type: "video",
      mode: ["singleImage"],
      audio: false,
      durationResolutionMap: [{ duration: durations, resolution: ["1080P"] }],
    },
  ],
};

const headers = () => {
  const apiKey = vendor.inputValues.apiKey.replace(/^Bearer\s+/i, "");
  return { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
};

const textRequest = () => {
  throw new Error("该供应商仅支持视频生成");
};

const imageRequest = async (): Promise<string> => {
  throw new Error("该供应商仅支持视频生成");
};

const videoRequest = async (config: VideoConfig, model: VideoModel): Promise<string> => {
  if (!vendor.inputValues.apiKey) throw new Error("缺少 Bafang API Key");
  const prompt = config.prompt?.trim();
  if (!prompt) throw new Error("缺少视频动态提示词");
  if (!Number.isInteger(config.duration) || config.duration < 1 || config.duration > 15) {
    throw new Error("视频时长必须为 1–15 秒整数");
  }

  const images = (config.referenceList || []).filter((item) => item.type === "image");
  if (images.length !== 1) throw new Error("Grok Imagine Video 需要且仅支持一张首帧图片");
  const rawImage = images[0].base64;
  const imageWithHead = rawImage.startsWith("data:")
    ? rawImage
    : `data:image/png;base64,${rawImage}`;
  const firstFrame = await zipImage(imageWithHead, 10 * 1024);
  const baseUrl = vendor.inputValues.baseUrl.replace(/\/+$/, "");

  logger("提交 Grok Imagine Video 任务；失败时不会自动重试");
  const submit = await axios.post(
    `${baseUrl}/videos/generations`,
    {
      model: model.modelName,
      prompt,
      image: { url: firstFrame },
      duration: config.duration,
      aspect_ratio: config.aspectRatio || "16:9",
    },
    { headers: headers(), timeout: 120000 },
  );
  const requestId = submit.data?.request_id;
  if (!requestId) {
    throw new Error("视频提交未返回 request_id；结果不确定，未自动重试");
  }
  logger(`Grok 视频任务已提交，request_id: ${requestId}`);

  const result = await pollTask(
    async () => {
      try {
        const response = await axios.get(`${baseUrl}/videos/${encodeURIComponent(requestId)}`, {
          headers: headers(),
          timeout: 30000,
        });
        const status = response.data?.status;
        if (status === "done") {
          const videoUrl = response.data?.video?.url;
          return videoUrl
            ? { completed: true, data: videoUrl }
            : { completed: true, error: "任务完成但未返回 video.url" };
        }
        if (status === "failed" || status === "expired") {
          return {
            completed: true,
            error: `视频任务 ${requestId} 状态为 ${status}: ${response.data?.error?.message || response.data?.message || ""}`,
          };
        }
        logger(`Grok 视频任务状态：${status || "pending"}`);
        return { completed: false };
      } catch (error: any) {
        return {
          completed: true,
          error: `查询视频任务 ${requestId} 失败；未重新提交：${error?.response?.data?.error?.message || error?.message || String(error)}`,
        };
      }
    },
    5000,
    900000,
  );

  if (result.error) throw new Error(result.error);
  if (!result.data) throw new Error(`视频任务 ${requestId} 超时或未返回下载地址；未重新提交`);
  return await urlToBase64(result.data);
};

const ttsRequest = async (): Promise<string> => {
  throw new Error("该供应商仅支持视频生成");
};

exports.vendor = vendor;
exports.textRequest = textRequest;
exports.imageRequest = imageRequest;
exports.videoRequest = videoRequest;
exports.ttsRequest = ttsRequest;

export {};
