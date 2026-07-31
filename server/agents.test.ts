import { describe, expect, it, afterAll } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { deleteAiAgent } from "./db";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAdminContext(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "admin-user",
    email: "admin@example.com",
    name: "Admin User",
    loginMethod: "manus",
    role: "admin",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as any,
  };
}

function createUserContext(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 2,
    openId: "regular-user",
    email: "user@example.com",
    name: "Regular User",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as any,
  };
}

describe("agent router", () => {
  const adminCaller = appRouter.createCaller(createAdminContext());
  const userCaller = appRouter.createCaller(createUserContext());
  let createdAgentId: number;

  // Cleanup handled by delete test at the end

  it("returns available tools list", async () => {
    const tools = await adminCaller.agent.availableTools();
    expect(tools).toBeInstanceOf(Array);
    expect(tools.length).toBeGreaterThan(0);
    expect(tools[0]).toHaveProperty("id");
    expect(tools[0]).toHaveProperty("name");
    expect(tools[0]).toHaveProperty("description");
    // Check known tools exist
    const toolIds = tools.map(t => t.id);
    expect(toolIds).toContain("buscar_veiculos");
    expect(toolIds).toContain("enviar_botoes");
    expect(toolIds).toContain("enviar_lista");
  });

  it("creates an agent (admin only)", async () => {
    const result = await adminCaller.agent.create({
      name: "Test Agent",
      description: "Agent for testing",
      systemPrompt: "Você é um agente de teste.",
      includeCoreLayers: true,
      model: "gpt-4o-mini",
      temperature: "0.5",
      maxTokens: 512,
      enabledTools: ["buscar_veiculos", "enviar_botoes"],
      active: true,
    });

    expect(result).toHaveProperty("id");
    expect(typeof result.id).toBe("number");
    createdAgentId = result.id;
  });

  it("lists agents", async () => {
    const agents = await adminCaller.agent.list();
    expect(agents).toBeInstanceOf(Array);
    const testAgent = agents.find(a => a.id === createdAgentId);
    expect(testAgent).toBeDefined();
    expect(testAgent!.name).toBe("Test Agent");
    expect(testAgent!.enabledTools).toEqual(["buscar_veiculos", "enviar_botoes"]);
  });

  it("gets agent by id", async () => {
    const agent = await adminCaller.agent.getById({ id: createdAgentId });
    expect(agent.name).toBe("Test Agent");
    expect(agent.systemPrompt).toBe("Você é um agente de teste.");
    expect(agent.model).toBe("gpt-4o-mini");
    expect(agent.temperature).toBe("0.5");
    expect(agent.maxTokens).toBe(512);
    expect(agent.includeCoreLayers).toBe(true);
    expect(agent.active).toBe(true);
  });

  it("updates an agent", async () => {
    const result = await adminCaller.agent.update({
      id: createdAgentId,
      name: "Test Agent Updated",
      temperature: "0.8",
      enabledTools: ["buscar_veiculos"],
      active: false,
    });
    expect(result.success).toBe(true);

    const updated = await adminCaller.agent.getById({ id: createdAgentId });
    expect(updated.name).toBe("Test Agent Updated");
    expect(updated.temperature).toBe("0.8");
    expect(updated.enabledTools).toEqual(["buscar_veiculos"]);
    expect(updated.active).toBe(false);
  });

  it("lists only active agents", async () => {
    const activeAgents = await adminCaller.agent.listActive();
    const found = activeAgents.find(a => a.id === createdAgentId);
    expect(found).toBeUndefined(); // Agent was deactivated
  });

  it("sets and gets instance agents", async () => {
    // First reactivate agent
    await adminCaller.agent.update({ id: createdAgentId, active: true });

    // Set instance agent (PR A2: nível de canal removido — vínculo é por instância)
    const setResult = await adminCaller.agent.setInstanceAgent({
      instanceName: "teste-instancia-a2",
      agentId: createdAgentId,
    });
    expect(setResult.success).toBe(true);

    // Clear instance agent
    const clearResult = await adminCaller.agent.setInstanceAgent({
      instanceName: "teste-instancia-a2",
      agentId: null,
    });
    expect(clearResult.success).toBe(true);
  });

  it("regular user cannot create agents", async () => {
    await expect(
      userCaller.agent.create({
        name: "Unauthorized Agent",
        systemPrompt: "test",
      })
    ).rejects.toThrow();
  });

  it("regular user can list agents", async () => {
    const agents = await userCaller.agent.list();
    expect(agents).toBeInstanceOf(Array);
  });

  it("deletes an agent", async () => {
    const result = await adminCaller.agent.delete({ id: createdAgentId });
    expect(result.success).toBe(true);

    await expect(
      adminCaller.agent.getById({ id: createdAgentId })
    ).rejects.toThrow("Agent not found");
  });
});
