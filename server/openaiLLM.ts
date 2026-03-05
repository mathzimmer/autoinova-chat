/**
 * OpenAI LLM integration - uses the user's own OpenAI API key
 * Falls back to Manus Forge LLM if OPENAI_API_KEY is not set
 */
import { ENV } from "./_core/env";
import { invokeLLM as invokeForge, type InvokeParams, type InvokeResult } from "./_core/llm";

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = "gpt-4o-mini";

/**
 * Invoke LLM using OpenAI API when OPENAI_API_KEY is available,
 * otherwise falls back to Manus Forge LLM.
 */
export async function invokeAgentLLM(params: InvokeParams): Promise<InvokeResult> {
  // If no OpenAI key, fall back to Manus Forge
  if (!ENV.openaiApiKey) {
    console.log("[LLM] No OPENAI_API_KEY, using Manus Forge LLM");
    return invokeForge(params);
  }

  const {
    messages,
    tools,
    toolChoice,
    tool_choice,
    responseFormat,
    response_format,
    maxTokens,
    max_tokens,
  } = params;

  // Normalize messages for OpenAI format
  const normalizedMessages = messages.map((msg: any) => {
    const normalized: any = { role: msg.role };

    if (msg.tool_call_id) {
      normalized.tool_call_id = msg.tool_call_id;
    }
    if (msg.name) {
      normalized.name = msg.name;
    }

    // Handle content
    if (typeof msg.content === "string") {
      normalized.content = msg.content;
    } else if (Array.isArray(msg.content)) {
      // Convert content parts
      normalized.content = msg.content.map((part: any) => {
        if (typeof part === "string") return { type: "text", text: part };
        if (part.type === "text") return part;
        if (part.type === "image_url") return part;
        // file_url is not supported by OpenAI, convert to text
        if (part.type === "file_url") return { type: "text", text: `[File: ${part.file_url?.url}]` };
        return part;
      });
    } else {
      normalized.content = msg.content;
    }

    // Preserve tool_calls for assistant messages
    if (msg.tool_calls) {
      normalized.tool_calls = msg.tool_calls;
    }

    return normalized;
  });

  // Build payload
  const payload: Record<string, unknown> = {
    model: OPENAI_MODEL,
    messages: normalizedMessages,
    max_tokens: maxTokens || max_tokens || 4096,
  };

  if (tools && tools.length > 0) {
    payload.tools = tools;
  }

  // Normalize tool_choice
  const tc = toolChoice || tool_choice;
  if (tc) {
    if (tc === "none" || tc === "auto") {
      payload.tool_choice = tc;
    } else if (tc === "required") {
      if (tools && tools.length === 1) {
        payload.tool_choice = { type: "function", function: { name: tools[0].function.name } };
      } else {
        payload.tool_choice = "auto";
      }
    } else if ("name" in tc) {
      payload.tool_choice = { type: "function", function: { name: tc.name } };
    } else {
      payload.tool_choice = tc;
    }
  }

  // Response format
  const rf = responseFormat || response_format;
  if (rf) {
    payload.response_format = rf;
  }

  console.log(`[LLM] Calling OpenAI ${OPENAI_MODEL} with ${normalizedMessages.length} messages, ${tools?.length || 0} tools`);

  const response = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${ENV.openaiApiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[LLM] OpenAI error: ${response.status} ${response.statusText} – ${errorText}`);
    
    // If OpenAI fails, try falling back to Forge
    console.log("[LLM] OpenAI failed, falling back to Manus Forge LLM");
    try {
      return await invokeForge(params);
    } catch (forgeErr) {
      throw new Error(`LLM invoke failed (both OpenAI and Forge): OpenAI: ${response.status} – ${errorText}`);
    }
  }

  const result = (await response.json()) as InvokeResult;
  console.log(`[LLM] OpenAI response: model=${result.model}, finish_reason=${result.choices?.[0]?.finish_reason}, tokens=${result.usage?.total_tokens || "?"}`);
  
  return result;
}
