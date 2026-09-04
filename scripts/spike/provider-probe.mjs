/**
 * T-009: Provider Probe — API Compatibility + Streaming + Tool Calling.
 *
 * Executes a side-effect-free probe against the specified provider to verify:
 * 1. OpenAI Responses API compatibility (preferred) OR Chat Completions API (fallback)
 * 2. SSE Streaming response parsing
 * 3. Tool Calling support
 *
 * The probe first tries the Responses API (/v1/responses). If that returns 404,
 * it falls back to the Chat Completions API (/v1/chat/completions). This reflects
 * real-world provider compatibility: many OpenAI-compatible providers only expose
 * the Chat Completions endpoint.
 *
 * The API key is NEVER written to the report or trace — only base_url and model_id.
 *
 * Usage: PROVIDER_BASE_URL=... PROVIDER_API_KEY=... PROVIDER_MODEL=... node scripts/spike/provider-probe.mjs
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, "..", "..");
const reportDir = join(projectRoot, "release-evidence");
const reportFile = join(reportDir, "provider-probe-report.json");

const BASE_URL = process.env.PROVIDER_BASE_URL || "https://api.qnaigc.com/v1";
const API_KEY = process.env.PROVIDER_API_KEY || "";
const MODEL_ID = process.env.PROVIDER_MODEL || "deepseek/deepseek-v4-flash-vision-exp";

mkdirSync(reportDir, { recursive: true });

const probeStartTime = new Date().toISOString();

// ================================================================
// Helpers: build request payloads for each API style
// ================================================================

function buildResponsesPayload(prompt, opts = {}) {
  const body = { model: MODEL_ID, input: prompt };
  if (opts.stream) body.stream = true;
  if (opts.tools) {
    body.tools = opts.tools.map((t) => ({
      type: "function",
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters,
    }));
  }
  return body;
}

function buildChatCompletionsPayload(prompt, opts = {}) {
  const body = {
    model: MODEL_ID,
    messages: [{ role: "user", content: prompt }],
    max_tokens: opts.max_tokens || 200,
  };
  if (opts.stream) body.stream = true;
  if (opts.tools) body.tools = opts.tools;
  return body;
}

const WEATHER_TOOL = [
  {
    type: "function",
    function: {
      name: "get_weather",
      description: "Get the current weather for a given location.",
      parameters: {
        type: "object",
        properties: {
          location: {
            type: "string",
            description: "The city name, e.g. 'San Francisco'",
          },
        },
        required: ["location"],
      },
    },
  },
];

const headers = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${API_KEY}`,
};

// ================================================================
// Probe 1: API Compatibility (Responses API → Chat Completions fallback)
// ================================================================
async function probeAPICompatibility() {
  // Try Responses API first
  const responsesUrl = `${BASE_URL}/responses`;
  const responsesBody = buildResponsesPayload(
    "T-009 provider probe: respond with exactly 'PROBE_OK' and nothing else.",
  );

  try {
    const response = await fetch(responsesUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(responsesBody),
    });

    if (response.ok) {
      const data = await response.json();
      const hasOutput = data.output || data.output_text || data.choices;
      return {
        pass: !!hasOutput,
        endpoint: "responses",
        status: response.status,
        hasId: !!data.id,
        hasOutput: !!hasOutput,
        responseShape: Object.keys(data).slice(0, 10),
      };
    }

    // 404 → fall back to Chat Completions
    if (response.status !== 404) {
      // Non-404 error on Responses API — record but still try fallback
      console.log(
        `[probe] Responses API returned ${response.status}, trying Chat Completions fallback...`,
      );
    } else {
      console.log(
        "[probe] Responses API not available (404), trying Chat Completions fallback...",
      );
    }
  } catch (error) {
    console.log(
      `[probe] Responses API error: ${error.message}, trying Chat Completions fallback...`,
    );
  }

  // Fallback: Chat Completions API
  const chatUrl = `${BASE_URL}/chat/completions`;
  const chatBody = buildChatCompletionsPayload(
    "T-009 provider probe: respond with exactly 'PROBE_OK' and nothing else.",
  );

  try {
    const response = await fetch(chatUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(chatBody),
    });

    if (!response.ok) {
      return {
        pass: false,
        endpoint: "chat_completions",
        status: response.status,
        statusText: response.statusText,
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    const data = await response.json();
    const hasChoices = data.choices && data.choices.length > 0;

    return {
      pass: hasChoices,
      endpoint: "chat_completions",
      status: response.status,
      hasId: !!data.id,
      hasChoices,
      responseShape: Object.keys(data).slice(0, 10),
    };
  } catch (error) {
    return {
      pass: false,
      endpoint: "chat_completions",
      error: error.message,
    };
  }
}

// ================================================================
// Probe 2: SSE Streaming
// ================================================================
async function probeSSEStreaming() {
  // Try Responses API streaming first
  const responsesUrl = `${BASE_URL}/responses`;
  const responsesBody = buildResponsesPayload("T-009 SSE probe: count from 1 to 3.", {
    stream: true,
  });

  try {
    const response = await fetch(responsesUrl, {
      method: "POST",
      headers: { ...headers, Accept: "text/event-stream" },
      body: JSON.stringify(responsesBody),
    });

    if (response.ok) {
      return await readSSEStream(response, "responses");
    }

    // 404 → fall back to Chat Completions streaming
    if (response.status === 404) {
      console.log(
        "[probe] Responses streaming not available (404), trying Chat Completions streaming...",
      );
    }
  } catch (error) {
    console.log(
      `[probe] Responses streaming error: ${error.message}, trying Chat Completions streaming...`,
    );
  }

  // Fallback: Chat Completions streaming
  const chatUrl = `${BASE_URL}/chat/completions`;
  const chatBody = buildChatCompletionsPayload("T-009 SSE probe: count from 1 to 3.", {
    stream: true,
    max_tokens: 50,
  });

  try {
    const response = await fetch(chatUrl, {
      method: "POST",
      headers: { ...headers, Accept: "text/event-stream" },
      body: JSON.stringify(chatBody),
    });

    if (!response.ok) {
      return {
        pass: false,
        endpoint: "chat_completions",
        status: response.status,
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    return await readSSEStream(response, "chat_completions");
  } catch (error) {
    return {
      pass: false,
      endpoint: "chat_completions",
      error: error.message,
    };
  }
}

async function readSSEStream(response, endpoint) {
  const contentType = response.headers.get("content-type") || "";
  const isSSE = contentType.includes("text/event-stream") || contentType.includes("stream");

  const reader = response.body?.getReader();
  if (!reader) {
    return {
      pass: false,
      endpoint,
      status: response.status,
      error: "No readable stream body",
    };
  }

  const chunks = [];
  let totalBytes = 0;
  const decoder = new TextDecoder();
  let textBuffer = "";

  const readTimeout = setTimeout(() => {
    try { reader.cancel(); } catch {}
  }, 30000);

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.length;
      textBuffer += decoder.decode(value, { stream: true });
      const lines = textBuffer.split("\n");
      for (const line of lines) {
        if (line.startsWith("data:") || line.startsWith("event:")) {
          chunks.push(line.trim().slice(0, 80));
        }
      }
      if (chunks.length > 100) break;
    }
  } finally {
    clearTimeout(readTimeout);
    try { reader.cancel(); } catch {}
  }

  return {
    pass: chunks.length > 0,
    endpoint,
    status: response.status,
    contentType,
    isSSE,
    totalChunks: chunks.length,
    totalBytes,
    sampleChunks: chunks.slice(0, 5),
  };
}

// ================================================================
// Probe 3: Tool Calling
// ================================================================
async function probeToolCalling() {
  // Try Responses API tool calling first
  const responsesUrl = `${BASE_URL}/responses`;
  const responsesBody = buildResponsesPayload(
    "What is the weather in San Francisco? Use the get_weather tool.",
    { tools: WEATHER_TOOL },
  );

  try {
    const response = await fetch(responsesUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(responsesBody),
    });

    if (response.ok) {
      const data = await response.json();
      const result = checkToolCall(data, "responses");
      if (result.pass) return result;
      // If Responses API returned 200 but no tool call, still record and try fallback
      console.log(
        "[probe] Responses API returned 200 but no tool call found, trying Chat Completions...",
      );
    } else if (response.status === 404) {
      console.log(
        "[probe] Responses API tool calling not available (404), trying Chat Completions...",
      );
    }
  } catch (error) {
    console.log(
      `[probe] Responses tool calling error: ${error.message}, trying Chat Completions...`,
    );
  }

  // Fallback: Chat Completions tool calling
  const chatUrl = `${BASE_URL}/chat/completions`;
  const chatBody = buildChatCompletionsPayload(
    "What is the weather in San Francisco? Use the get_weather tool.",
    { tools: WEATHER_TOOL, max_tokens: 100 },
  );

  try {
    const response = await fetch(chatUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(chatBody),
    });

    if (!response.ok) {
      return {
        pass: false,
        endpoint: "chat_completions",
        status: response.status,
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    const data = await response.json();
    return checkToolCall(data, "chat_completions");
  } catch (error) {
    return {
      pass: false,
      endpoint: "chat_completions",
      error: error.message,
    };
  }
}

function checkToolCall(data, endpoint) {
  let toolCallFound = false;
  let toolCallDetails = null;

  // Responses API format: output[].type === "function_call"
  if (data.output && Array.isArray(data.output)) {
    const toolItems = data.output.filter(
      (item) =>
        item.type === "function_call" ||
        item.type === "tool_use" ||
        item.type === "tool_call",
    );
    toolCallFound = toolItems.length > 0;
    if (toolCallFound) {
      toolCallDetails = toolItems.map((item) => ({
        type: item.type,
        name: item.name || item.function?.name,
        arguments: item.arguments ? "present" : "absent",
      }));
    }
  }

  // Chat Completions format: choices[].message.tool_calls[]
  if (data.choices && Array.isArray(data.choices)) {
    const toolCalls = data.choices.flatMap(
      (choice) => choice.message?.tool_calls || [],
    );
    toolCallFound = toolCallFound || toolCalls.length > 0;
    if (toolCalls.length > 0 && !toolCallDetails) {
      toolCallDetails = toolCalls.map((tc) => ({
        type: "chat_completions_tool_call",
        name: tc.function?.name,
        arguments: tc.function?.arguments ? "present" : "absent",
      }));
    }
  }

  return {
    pass: toolCallFound,
    endpoint,
    status: 200,
    toolCallFound,
    toolCallDetails,
    responseShape: Object.keys(data).slice(0, 10),
  };
}

// ================================================================
// Main
// ================================================================
async function main() {
  console.log(`[probe] Provider: ${BASE_URL}`);
  console.log(`[probe] Model: ${MODEL_ID}`);
  console.log(`[probe] Starting probes...\n`);

  const apiResult = await probeAPICompatibility();
  console.log(
    `[probe] API Compatibility (${apiResult.endpoint}): ${apiResult.pass ? "PASS" : "FAIL"}`,
  );

  const streamingResult = await probeSSEStreaming();
  console.log(
    `[probe] SSE Streaming (${streamingResult.endpoint}): ${streamingResult.pass ? "PASS" : "FAIL"}`,
  );

  const toolCallingResult = await probeToolCalling();
  console.log(
    `[probe] Tool Calling (${toolCallingResult.endpoint}): ${toolCallingResult.pass ? "PASS" : "FAIL"}`,
  );

  const probeEndTime = new Date().toISOString();

  // Stop condition: Streaming or Tool Calling must pass (US-30)
  const stopCondition = !streamingResult.pass || !toolCallingResult.pass;
  const allPass = apiResult.pass && streamingResult.pass && toolCallingResult.pass;

  const report = {
    probeStartedAt: probeStartTime,
    probeCompletedAt: probeEndTime,
    provider: {
      base_url: BASE_URL,
      model_id: MODEL_ID,
    },
    results: {
      api_compatibility: { pass: apiResult.pass, ...apiResult },
      sse_streaming: { pass: streamingResult.pass, ...streamingResult },
      tool_calling: { pass: toolCallingResult.pass, ...toolCallingResult },
    },
    overall: {
      pass: allPass,
      stopConditionTriggered: stopCondition,
      stopConditionReason: stopCondition
        ? "Streaming or Tool Calling support missing (US-30)"
        : null,
    },
    note: "API key is NOT included in this report. Only base_url and model_id are recorded.",
  };

  writeFileSync(reportFile, JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log(`\n[probe] Report saved: ${reportFile}`);
  console.log(`[probe] Overall: ${allPass ? "PASS" : "FAIL"}`);
  if (stopCondition) {
    console.log(`[probe] STOP CONDITION TRIGGERED: ${report.overall.stopConditionReason}`);
  }

  process.exitCode = allPass ? 0 : 1;
}

main().catch((error) => {
  console.error(`[probe] Fatal error: ${error.message}`);
  process.exitCode = 1;
});
