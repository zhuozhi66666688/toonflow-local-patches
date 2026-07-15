/**
 * Local 9router provider for ToonFlow.
 * @version 1.0
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

declare const createOpenAICompatible: any;
declare const exports: {
  vendor: VendorConfig;
  textRequest: (m: TextModel, t: boolean, tl: 0 | 1 | 2 | 3) => any;
  imageRequest: (c: any, m: ImageModel) => Promise<string>;
  videoRequest: (c: any, m: VideoModel) => Promise<string>;
  ttsRequest: (c: any, m: TTSModel) => Promise<string>;
};

const vendor: VendorConfig = {
  id: "9router",
  version: "1.0",
  author: "Local",
  name: "9router Local",
  description: "本机 9router 的 OpenAI-compatible 接口，供 ToonFlow 文本模型调用。",
  inputs: [
    { key: "apiKey", label: "API密钥", type: "password", required: true },
    { key: "baseUrl", label: "请求地址", type: "url", required: true, placeholder: "http://127.0.0.1:20129/v1" },
  ],
  inputValues: {
    apiKey: "",
    baseUrl: "http://127.0.0.1:20129/v1",
  },
  models: [
    { name: "Claude KR", modelName: "claude_kr", type: "text", think: false },
    { name: "Planner Best", modelName: "planner-best", type: "text", think: true },
    {
      name: "Planner Best + Claude KR Auto",
      modelName: "planner-best-claude-kr-auto",
      type: "text",
      think: true,
    },
    { name: "Executor Mid", modelName: "executor-mid", type: "text", think: false },
    { name: "Claude DeepSeek", modelName: "claude-deepsek", type: "text", think: true },
    {
      name: "Claude DeepSeek Tool Required",
      modelName: "claude-deepsek-tool-required",
      type: "text",
      think: true,
    },
  ],
};

const textRequest = (model: TextModel) => {
  if (!vendor.inputValues.apiKey) throw new Error("缺少 API Key");
  const apiKey = vendor.inputValues.apiKey.replace(/^Bearer\s+/i, "");
  const forceToolChoice = model.modelName === "claude-deepsek-tool-required";
  const autoClaudeKr = model.modelName === "planner-best-claude-kr-auto";
  const upstreamModel = forceToolChoice
    ? "claude-deepsek"
    : autoClaudeKr
      ? "planner-best"
      : model.modelName;
  const routeToolsToClaudeKr = model.modelName === "planner-best" || autoClaudeKr;
  return createOpenAICompatible({
    name: "9router",
    baseURL: vendor.inputValues.baseUrl.replace(/\/+$/, ""),
    apiKey,
    fetch: async (url: string, options?: any) => {
      if (!options?.body) return await fetch(url, options);
      const body = JSON.parse(options.body);
      const hasTools = Array.isArray(body.tools) && body.tools.length > 0;
      if (routeToolsToClaudeKr && hasTools) {
        body.model = "claude_kr";
      }
      if (forceToolChoice && hasTools) {
        body.tool_choice = "required";
      }
      return await fetch(url, { ...options, body: JSON.stringify(body) });
    },
  }).chatModel(upstreamModel);
};

const imageRequest = async (): Promise<string> => "";
const videoRequest = async (): Promise<string> => "";
const ttsRequest = async (): Promise<string> => "";

exports.vendor = vendor;
exports.textRequest = textRequest;
exports.imageRequest = imageRequest;
exports.videoRequest = videoRequest;
exports.ttsRequest = ttsRequest;

export {};
