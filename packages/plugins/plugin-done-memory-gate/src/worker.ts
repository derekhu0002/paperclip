import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
import { handleIssueUpdated } from "./gate.js";

const plugin = definePlugin({
  async setup(ctx) {
    ctx.logger.info("done-memory-gate plugin setup");

    ctx.events.on("issue.updated", async (event) => {
      try {
        const outcome = await handleIssueUpdated(ctx, event);
        if (outcome.action !== "ignored" && outcome.action !== "passed") {
          ctx.logger.info("done-memory-gate enforced a done transition", {
            issueId: event.entityId,
            outcome,
          });
        }
      } catch (error) {
        ctx.logger.error("done-memory-gate failed to evaluate a done transition", {
          issueId: event.entityId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  },

  async onHealth() {
    return { status: "ok", message: "done-memory-gate ready" };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
