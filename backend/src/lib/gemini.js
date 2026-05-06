import { GoogleGenerativeAI } from "@google/generative-ai";
import { env } from "../config/env.js";

export class GeminiTimeoutError extends Error {
  constructor(message = "Gemini request timed out") {
    super(message);
    this.name = "GeminiTimeoutError";
  }
}

let cachedModel = null;

function shouldUseOpenAiCompatible() {
  if (env.aiProvider === "openai_compatible") {
    return true;
  }

  return Boolean(env.aiBaseUrl && env.aiApiKey && env.aiModel);
}

function getGeminiModel() {
  if (!env.geminiApiKey) {
    throw new Error("GEMINI_API_KEY is not configured");
  }

  if (!cachedModel) {
    const client = new GoogleGenerativeAI(env.geminiApiKey);
    cachedModel = client.getGenerativeModel({ model: env.geminiModel });
  }

  return cachedModel;
}

function buildAbortController(timeoutMs) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return { controller: null, cleanup: () => {} };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new GeminiTimeoutError()), timeoutMs);
  return {
    controller,
    cleanup: () => clearTimeout(timer)
  };
}

function withTimeout(promise, timeoutMs) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return promise;
  }

  let timer = null;
  return Promise.race([
    promise.finally(() => {
      if (timer) {
        clearTimeout(timer);
      }
    }),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new GeminiTimeoutError()), timeoutMs);
    })
  ]);
}

function normalizeOpenAiCompatibleEndpoint(baseUrl) {
  const trimmed = `${baseUrl || ""}`.replace(/\/+$/, "");
  if (!trimmed) {
    throw new Error("AI_BASE_URL is not configured");
  }

  if (/\/chat\/completions$/i.test(trimmed)) {
    return trimmed;
  }

  return `${trimmed}/chat/completions`;
}

function extractChatCompletionText(payload) {
  const choice = payload?.choices?.[0];
  const content = choice?.message?.content ?? choice?.text;

  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .join("")
      .trim();
  }

  return "";
}

async function generateWithOpenAiCompatible(prompt, { timeoutMs }) {
  if (!env.aiApiKey) {
    throw new Error("AI_API_KEY is not configured");
  }
  if (!env.aiModel) {
    throw new Error("AI_MODEL is not configured");
  }

  const endpoint = normalizeOpenAiCompatibleEndpoint(env.aiBaseUrl);
  const { controller, cleanup } = buildAbortController(timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.aiApiKey}`
      },
      body: JSON.stringify({
        model: env.aiModel,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2
      }),
      signal: controller?.signal
    });

    const rawText = await response.text();
    let payload = {};
    try {
      payload = rawText ? JSON.parse(rawText) : {};
    } catch {
      payload = { raw: rawText };
    }

    if (!response.ok) {
      const errorMessage =
        payload?.error?.message ||
        payload?.message ||
        rawText ||
        `AI service request failed with status ${response.status}`;
      throw new Error(`[AI Service ${response.status}] ${errorMessage}`);
    }

    const text = extractChatCompletionText(payload);
    if (!text) {
      throw new Error("AI service returned an empty response");
    }

    return text;
  } finally {
    cleanup();
  }
}

export async function generateAnswer(prompt, { timeoutMs = 8000 } = {}) {
  if (shouldUseOpenAiCompatible()) {
    return generateWithOpenAiCompatible(prompt, { timeoutMs });
  }

  const model = getGeminiModel();
  const response = await withTimeout(model.generateContent(prompt), timeoutMs);
  const text = response?.response?.text?.()?.trim();

  if (!text) {
    throw new Error("Gemini returned an empty response");
  }

  return text;
}
