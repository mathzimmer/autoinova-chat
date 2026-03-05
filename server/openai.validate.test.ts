import { describe, it, expect } from "vitest";

describe("OpenAI API Key validation", () => {
  it("should be able to reach OpenAI API with valid credentials", async () => {
    const apiKey = process.env.OPENAI_API_KEY;
    expect(apiKey).toBeTruthy();
    expect(apiKey!.startsWith("sk-")).toBe(true);

    // Lightweight call to list models - minimal cost
    const response = await fetch("https://api.openai.com/v1/models", {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.data).toBeDefined();
    expect(Array.isArray(data.data)).toBe(true);

    // Verify gpt-4o-mini is available
    const hasGpt4oMini = data.data.some((m: any) => m.id === "gpt-4o-mini");
    expect(hasGpt4oMini).toBe(true);

    console.log(`[OpenAI] Validated API key. ${data.data.length} models available. gpt-4o-mini: ${hasGpt4oMini}`);
  });
});
