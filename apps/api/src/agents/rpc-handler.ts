/**
 * Generic HTTP RPC handler for agents.
 *
 * Parses { method, args } from request body and calls the named method
 * on the agent instance. This bridges HTTP REST requests to @callable methods.
 *
 * Used by the /v1/agents/* REST proxy routes.
 */
export async function handleAgentRpc(
  agent: Record<string, unknown>,
  request: Request
): Promise<Response> {
  try {
    const { method, args = [] } = await request.json() as {
      method: string;
      args: unknown[];
    };

    if (!method || typeof method !== "string") {
      return Response.json({ error: "Missing method" }, { status: 400 });
    }

    const fn = agent[method];
    if (typeof fn !== "function") {
      return Response.json({ error: `Unknown method: ${method}` }, { status: 404 });
    }

    const result = await fn.apply(agent, args);
    return Response.json(result ?? null);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
