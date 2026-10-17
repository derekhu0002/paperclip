import { configFieldsForSection } from "../config-sections";
import type { AdapterConfigFieldsProps } from "../types";
import {
  Field,
  ToggleField,
  DraftInput,
  help,
} from "../../components/agent-config-primitives";
import { ChoosePathButton } from "../../components/PathInstructionsModal";

const inputClass =
  "w-full rounded-md border border-border px-2.5 py-1.5 bg-transparent outline-none text-sm font-mono placeholder:text-muted-foreground/40";
const instructionsFileHint =
  "Absolute path to a markdown file (e.g. AGENTS.md) that defines this agent's behavior. Injected into the system prompt at runtime.";

export function OpenCodeLocalConfigFields({
  section,
  isCreate,
  values,
  set,
  config,
  eff,
  mark,
  hideInstructionsFile,
}: AdapterConfigFieldsProps) {
  return configFieldsForSection(section, (
    <>
      {!hideInstructionsFile && (
        <Field label="Agent instructions file" hint={instructionsFileHint}>
          <div className="flex items-center gap-2">
            <DraftInput
              value={
                isCreate
                  ? values!.instructionsFilePath ?? ""
                  : eff(
                      "adapterConfig",
                      "instructionsFilePath",
                      String(config.instructionsFilePath ?? ""),
                    )
              }
              onCommit={(v) =>
                isCreate
                  ? set!({ instructionsFilePath: v })
                  : mark("adapterConfig", "instructionsFilePath", v || undefined)
              }
              immediate
              className={inputClass}
              placeholder="/absolute/path/to/AGENTS.md"
            />
            <ChoosePathButton />
          </div>
        </Field>
      )}
      <ToggleField
        label="Skip permissions"
        hint={help.dangerouslySkipPermissions}
        checked={
          isCreate
            ? values!.dangerouslySkipPermissions
            : eff(
                "adapterConfig",
                "dangerouslySkipPermissions",
                config.dangerouslySkipPermissions !== false,
              )
        }
        onChange={(v) =>
          isCreate
            ? set!({ dangerouslySkipPermissions: v })
            : mark("adapterConfig", "dangerouslySkipPermissions", v)
        }
      />
      <ToggleField
        label="Direct remote workspace"
        hint="Run OpenCode in the execution environment's existing project directory instead of staging a per-run copy. Use when the agent's remote environment points at the real project checkout."
        checked={
          isCreate
            ? Boolean(values!.directRemoteWorkspace)
            : eff(
                "adapterConfig",
                "directRemoteWorkspace",
                Boolean(config.directRemoteWorkspace),
              )
        }
        onChange={(v) =>
          isCreate
            ? set!({ directRemoteWorkspace: v })
            : mark("adapterConfig", "directRemoteWorkspace", v)
        }
      />
    </>
  ));
}
