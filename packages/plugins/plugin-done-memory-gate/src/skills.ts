/**
 * SKILL.md for the plugin-managed `task-memory-capture` company skill.
 *
 * Kept as a TypeScript string so the compiled worker can register the skill
 * without copying non-code assets into `dist/`.
 */
export const MEMORY_CAPTURE_SKILL_MARKDOWN = `# Task Memory Capture

Capture what a task taught before you mark it done. The memory knowledge graph is the durable
record; the issue comment is only the pointer.

## When

Before every \`PATCH /api/issues/{id}\` (or comment) that sets \`status\` to \`done\` for a task you
worked on.

## What to capture

Write a concise memory entry with:

- the outcome and the evidence that proves it;
- key decisions and why the alternatives were rejected;
- lessons and pitfalls, including symptoms, causes, and fixes;
- anything a future agent would otherwise have to rediscover.

Do not copy the whole run log and do not invent facts.

## Where

1. Preferred: the project's ArchGraph/ARGO intent graph. Write a long-term memory element
   (Tier 2) with \`addArchitectureElement\` (or update an existing one with
   \`updateArchitectureElement\`) and remember its id.
2. Fallback when ARGO MCP is unavailable: create the issue document with key \`memory\` via
   \`PUT /api/issues/{id}/documents/memory\`. Write at least 200 characters of real content.

## Proof marker

In the same closing comment, add one line:

\`\`\`
memory-capture: <argo element id or document key or URL>
\`\`\`

A substantive \`memory\` document satisfies the gate even without the marker (200+ characters).
Without either proof, the done-memory gate sends the task back to \`in_progress\`.
`;
