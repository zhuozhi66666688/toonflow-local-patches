import http from "node:http";

const listenHost = "127.0.0.1";
const listenPort = 20129;
const upstreamHost = "127.0.0.1";
const upstreamPort = 20128;

const server = http.createServer((request, response) => {
  const requestChunks = [];
  request.on("data", (chunk) => requestChunks.push(chunk));
  request.on("end", () => {
    const requestBody = Buffer.concat(requestChunks);
    let parsedRequest = {};
    try {
      parsedRequest = JSON.parse(requestBody.toString("utf8") || "{}");
    } catch {}
    const resultTool = Array.isArray(parsedRequest.tools)
      ? parsedRequest.tools.find((tool) => tool?.function?.name === "resultTool")
      : null;
    if (resultTool) {
      parsedRequest.tool_choice = {
        type: "function",
        function: { name: "resultTool" },
      };
    }
    const upstreamBody = resultTool
      ? Buffer.from(JSON.stringify(parsedRequest))
      : requestBody;
    const upstreamHeaders = {
      ...request.headers,
      host: `${upstreamHost}:${upstreamPort}`,
      "content-length": String(upstreamBody.length),
    };

    const upstream = http.request(
      {
        hostname: upstreamHost,
        port: upstreamPort,
        path: request.url,
        method: request.method,
        headers: upstreamHeaders,
      },
      (upstreamResponse) => {
        const contentType = String(upstreamResponse.headers["content-type"] || "");

        if (!contentType.includes("text/event-stream")) {
          response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
          upstreamResponse.pipe(response);
          return;
        }

        const chunks = [];
        upstreamResponse.on("data", (chunk) => chunks.push(chunk));
        upstreamResponse.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          if (!parsedRequest.stream) {
            const events = text
              .split(/\r?\n/)
              .filter((line) => line.startsWith("data: "))
              .map((line) => line.slice(6).trim())
              .filter((line) => line && line !== "[DONE]")
              .flatMap((line) => {
                try {
                  return [JSON.parse(line)];
                } catch {
                  return [];
                }
              });
            const first = events[0] || {};
            const last = events[events.length - 1] || {};
            const content = events.map((event) => event.choices?.[0]?.delta?.content || "").join("");
            const reasoningContent = events.map((event) => event.choices?.[0]?.delta?.reasoning_content || "").join("");
            const message = { role: "assistant", content };
            if (reasoningContent) message.reasoning_content = reasoningContent;
            const toolCallsByIndex = new Map();
            for (const event of events) {
              for (const call of event.choices?.[0]?.delta?.tool_calls || []) {
                const index = call.index ?? 0;
                const current = toolCallsByIndex.get(index) || {
                  id: "",
                  type: "function",
                  function: { name: "", arguments: "" },
                };
                if (call.id) current.id += call.id;
                if (call.type) current.type = call.type;
                if (call.function?.name) current.function.name += call.function.name;
                if (call.function?.arguments) {
                  current.function.arguments += call.function.arguments;
                }
                toolCallsByIndex.set(index, current);
              }
            }
            const toolCalls = [...toolCallsByIndex.entries()]
              .sort(([a], [b]) => a - b)
              .map(([, call]) => call);
            if (toolCalls.length) message.tool_calls = toolCalls;
            const jsonResponse = {
              id: first.id || `chatcmpl-${Date.now()}`,
              object: "chat.completion",
              created: first.created || Math.floor(Date.now() / 1000),
              model: first.model || parsedRequest.model,
              choices: [{
                index: 0,
                message,
                finish_reason:
                  last.choices?.[0]?.finish_reason ||
                  (toolCalls.length ? "tool_calls" : "stop"),
              }],
              usage: last.usage,
            };
            response.writeHead(upstreamResponse.statusCode || 200, {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            });
            response.end(JSON.stringify(jsonResponse));
            return;
          }

          response.writeHead(upstreamResponse.statusCode || 200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Access-Control-Allow-Origin": "*",
          });
          const completed = text.includes("data: [DONE]")
            ? text
            : `${text.trim()}\n\ndata: [DONE]\n\n`;
          response.end(completed);
        });
      },
    );

    upstream.on("error", (error) => {
      if (response.headersSent) {
        response.end();
        return;
      }
      response.writeHead(502, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: { message: `9router bridge: ${error.message}` } }));
    });
    upstream.end(upstreamBody);
  });
});

server.listen(listenPort, listenHost, () => {
  console.log(`ToonFlow 9router bridge listening on http://${listenHost}:${listenPort}`);
});
