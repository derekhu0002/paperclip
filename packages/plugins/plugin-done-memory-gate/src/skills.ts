/**
 * SKILL.md for the plugin-managed `task-memory-capture` company skill.
 *
 * Kept as a TypeScript string so the compiled worker can register the skill
 * without copying non-code assets into `dist/`.
 */
export const MEMORY_CAPTURE_SKILL_MARKDOWN = `# Task Memory Capture

Write what a task taught into the project's knowledge graph before you mark it done. The graph is
the record; the issue comment only points at the element.

## When

Before every \`PATCH /api/issues/{id}\` (or comment) that sets \`status\` to \`done\` for a task you
worked on.

## What to capture

Write a concise memory element with:

- the outcome and the evidence that proves it;
- key decisions and why the alternatives were rejected;
- lessons and pitfalls, including symptoms, causes, and fixes;
- anything a future agent would otherwise have to rediscover.

Do not copy the whole run log and do not invent facts.

## Where

The project's ARGO/ArchGraph intent graph. Use the ARGO MCP tools:

1. \`addArchitectureElement\` to create the memory element in a memory view
   (Tier 2 long-term memory for the project/agent), or
2. \`updateArchitectureElement\` to extend an existing memory element.

The element id is returned by the tool. Use the graph key of the project graph
(for example \`design/KG/SystemArchitecture.json\`).

## Proof marker

In the same closing comment, add one line with the graph key and element id:

\`\`\`
memory-capture: argo:design/KG/SystemArchitecture.json#<elementId>
\`\`\`

The gate only accepts an \`argo:<graphKey>#<elementId>\` reference. A general "I learned something"
comment does not count. An operator can enable an issue-document fallback, but the default is
graph-only.
`;
