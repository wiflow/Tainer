import "server-only";

import type { ToolDefinition } from "@/lib/copilot/types";

const registry = new Map<string, ToolDefinition>();

export function registerTool(tool: ToolDefinition): void {
  if (registry.has(tool.name)) {
    // HMR can re-import the tools file in dev, so a duplicate name replaces the old tool.
    registry.delete(tool.name);
  }
  registry.set(tool.name, tool);
}

export function getTool(name: string): ToolDefinition | null {
  return registry.get(name) ?? null;
}

export function listTools(): ToolDefinition[] {
  return Array.from(registry.values());
}

export function listToolsForModel(
  isAllowed: (tool: ToolDefinition) => boolean = () => true,
): Array<{
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: ToolDefinition["input_schema"];
  };
}> {
  return listTools()
    .filter(isAllowed)
    .map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: `[${tool.klass}] ${tool.description}`,
        parameters: tool.input_schema,
      },
    }));
}
