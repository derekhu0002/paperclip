# Company Agent Router (Direct Workspace)

> Copy this file to the company project root as `AGENTS.md`. Keep it role-neutral.
> In direct workspace mode, the project's `AGENTS.md` is what the runtime loads; this router dispatches each Agent to its own role file.

Your role is **not** defined in this file. It is defined by your Paperclip Agent identity.

1. Read `.paperclip/agents/roles.json` from this project.
2. Find the entry whose key equals your `PAPERCLIP_AGENT_ID`.
3. Read the role file named by that entry and follow it as your role instructions.
4. Never read another role's file. Never write role-specific memory or private notes into this router.
5. If no entry matches, stop and report a configuration error. Do not guess a role.

Role files are separate:

- `.paperclip/agents/company-ceo.AGENTS.md`
- `.paperclip/agents/company-knowledge-manager.AGENTS.md`

The shared project context belongs here; the role contract belongs in the role file. Use Paperclip issues/documents or the Actor's memory view for role-specific memory.
