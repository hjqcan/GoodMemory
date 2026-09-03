// Frozen literal description of the CLI surface (ADR-010 §11). This is a data
// document printed by `goodmemory --schema`, not a command registry: routing
// stays in the hand-written switch in src/cli.ts (ADR-009 §3) and
// tests/cli/cli-schema.cases.ts proves this literal matches the help texts
// and that every path here routes to help. Regenerate by hand when a command
// or flag changes; the parity test fails until the literal is updated.

export const CLI_SCHEMA_VERSION = "goodmemory.cli/v1";

export interface CliSchemaFlag {
  choices?: string[];
  name: string;
  type: "boolean" | "string";
}

export interface CliSchemaCommand {
  flags: CliSchemaFlag[];
  path: string[];
  summary: string;
}

export interface CliSchema {
  commands: CliSchemaCommand[];
  globalFlags: CliSchemaFlag[];
  schemaVersion: typeof CLI_SCHEMA_VERSION;
}

export const CLI_SCHEMA: CliSchema = {
  "schemaVersion": "goodmemory.cli/v1",
  "globalFlags": [
    {
      "name": "--help",
      "type": "boolean"
    },
    {
      "name": "--schema",
      "type": "boolean"
    },
    {
      "name": "--version",
      "type": "boolean"
    }
  ],
  "commands": [
    {
      "flags": [],
      "path": [],
      "summary": "GoodMemory CLI"
    },
    {
      "flags": [
        {
          "name": "--host",
          "type": "string",
          "choices": [
            "codex",
            "claude"
          ]
        },
        {
          "name": "--json",
          "type": "boolean"
        }
      ],
      "path": [
        "adopt"
      ],
      "summary": "GoodMemory Adopt CLI"
    },
    {
      "flags": [],
      "path": [
        "claude"
      ],
      "summary": "GoodMemory Claude CLI"
    },
    {
      "flags": [],
      "path": [
        "claude",
        "bootstrap"
      ],
      "summary": "GoodMemory Claude Bootstrap"
    },
    {
      "flags": [],
      "path": [
        "claude",
        "hook"
      ],
      "summary": "GoodMemory Claude Hook"
    },
    {
      "flags": [],
      "path": [
        "claude",
        "writeback"
      ],
      "summary": "GoodMemory Claude Writeback"
    },
    {
      "flags": [],
      "path": [
        "codex"
      ],
      "summary": "GoodMemory Codex CLI"
    },
    {
      "flags": [],
      "path": [
        "codex",
        "action"
      ],
      "summary": "GoodMemory Codex Action"
    },
    {
      "flags": [],
      "path": [
        "codex",
        "bootstrap"
      ],
      "summary": "GoodMemory Codex Bootstrap"
    },
    {
      "flags": [],
      "path": [
        "codex",
        "hook"
      ],
      "summary": "GoodMemory Codex Hook"
    },
    {
      "flags": [
        {
          "name": "--from-rollout",
          "type": "boolean"
        },
        {
          "name": "--rollout-path",
          "type": "string"
        },
        {
          "name": "--sessions-root",
          "type": "string"
        },
        {
          "name": "--workspace-root",
          "type": "string"
        }
      ],
      "path": [
        "codex",
        "writeback"
      ],
      "summary": "GoodMemory Codex Writeback"
    },
    {
      "flags": [
        {
          "name": "--workspace-root",
          "type": "string"
        },
        {
          "name": "--json",
          "type": "boolean"
        }
      ],
      "path": [
        "disable"
      ],
      "summary": "GoodMemory Disable CLI"
    },
    {
      "flags": [
        {
          "name": "--workspace-root",
          "type": "string"
        },
        {
          "name": "--json",
          "type": "boolean"
        }
      ],
      "path": [
        "doctor"
      ],
      "summary": "GoodMemory Doctor CLI"
    },
    {
      "flags": [
        {
          "name": "--workspace-id",
          "type": "string"
        },
        {
          "name": "--workspace-root",
          "type": "string"
        },
        {
          "name": "--context-mode",
          "type": "string",
          "choices": [
            "fragment",
            "progressive"
          ]
        },
        {
          "name": "--writeback",
          "type": "string",
          "choices": [
            "off",
            "observe",
            "review",
            "selective"
          ]
        },
        {
          "name": "--dry-run",
          "type": "boolean"
        },
        {
          "name": "--json",
          "type": "boolean"
        }
      ],
      "path": [
        "enable"
      ],
      "summary": "GoodMemory Enable CLI"
    },
    {
      "flags": [],
      "path": [
        "eval"
      ],
      "summary": "GoodMemory Eval CLI"
    },
    {
      "flags": [],
      "path": [
        "eval",
        "export-case"
      ],
      "summary": "GoodMemory Eval Export Case"
    },
    {
      "flags": [],
      "path": [
        "eval",
        "inspect"
      ],
      "summary": "GoodMemory Eval Inspect"
    },
    {
      "flags": [],
      "path": [
        "eval",
        "trace"
      ],
      "summary": "GoodMemory Eval Trace"
    },
    {
      "flags": [
        {
          "name": "--user-id",
          "type": "string"
        },
        {
          "name": "--tenant-id",
          "type": "string"
        },
        {
          "name": "--workspace-id",
          "type": "string"
        },
        {
          "name": "--agent-id",
          "type": "string"
        },
        {
          "name": "--session-id",
          "type": "string"
        },
        {
          "name": "--storage-provider",
          "type": "string",
          "choices": [
            "memory",
            "sqlite",
            "postgres"
          ]
        },
        {
          "name": "--storage-url",
          "type": "string"
        },
        {
          "name": "--output",
          "type": "string"
        },
        {
          "name": "--include-runtime",
          "type": "boolean"
        },
        {
          "name": "--force",
          "type": "boolean"
        }
      ],
      "path": [
        "export-memory"
      ],
      "summary": "GoodMemory Export Memory"
    },
    {
      "flags": [
        {
          "name": "--user-id",
          "type": "string"
        },
        {
          "name": "--tenant-id",
          "type": "string"
        },
        {
          "name": "--workspace-id",
          "type": "string"
        },
        {
          "name": "--agent-id",
          "type": "string"
        },
        {
          "name": "--session-id",
          "type": "string"
        },
        {
          "name": "--signal",
          "type": "string"
        },
        {
          "name": "--locale",
          "type": "string"
        },
        {
          "name": "--host",
          "type": "string",
          "choices": [
            "codex",
            "claude"
          ]
        },
        {
          "name": "--workspace-root",
          "type": "string"
        },
        {
          "name": "--storage-provider",
          "type": "string",
          "choices": [
            "memory",
            "sqlite",
            "postgres"
          ]
        },
        {
          "name": "--storage-url",
          "type": "string"
        },
        {
          "name": "--json",
          "type": "boolean"
        }
      ],
      "path": [
        "feedback"
      ],
      "summary": "GoodMemory Feedback"
    },
    {
      "flags": [
        {
          "name": "--user-id",
          "type": "string"
        },
        {
          "name": "--tenant-id",
          "type": "string"
        },
        {
          "name": "--workspace-id",
          "type": "string"
        },
        {
          "name": "--agent-id",
          "type": "string"
        },
        {
          "name": "--session-id",
          "type": "string"
        },
        {
          "name": "--memory-id",
          "type": "string"
        },
        {
          "name": "--all",
          "type": "boolean"
        },
        {
          "name": "--include-runtime",
          "type": "boolean"
        },
        {
          "name": "--host",
          "type": "string",
          "choices": [
            "codex",
            "claude"
          ]
        },
        {
          "name": "--workspace-root",
          "type": "string"
        },
        {
          "name": "--storage-provider",
          "type": "string",
          "choices": [
            "memory",
            "sqlite",
            "postgres"
          ]
        },
        {
          "name": "--storage-url",
          "type": "string"
        },
        {
          "name": "--json",
          "type": "boolean"
        }
      ],
      "path": [
        "forget"
      ],
      "summary": "GoodMemory Forget"
    },
    {
      "flags": [
        {
          "name": "--input",
          "type": "string"
        },
        {
          "name": "--user-id",
          "type": "string"
        },
        {
          "name": "--tenant-id",
          "type": "string"
        },
        {
          "name": "--workspace-id",
          "type": "string"
        },
        {
          "name": "--agent-id",
          "type": "string"
        },
        {
          "name": "--storage-provider",
          "type": "string",
          "choices": [
            "memory",
            "sqlite",
            "postgres"
          ]
        },
        {
          "name": "--storage-url",
          "type": "string"
        },
        {
          "name": "--dry-run",
          "type": "boolean"
        },
        {
          "name": "--yes",
          "type": "boolean"
        },
        {
          "name": "--expect-sha256",
          "type": "string"
        },
        {
          "name": "--oversize",
          "type": "string",
          "choices": [
            "reject",
            "split"
          ]
        },
        {
          "name": "--locale",
          "type": "string"
        },
        {
          "name": "--json",
          "type": "boolean"
        }
      ],
      "path": [
        "import-memory"
      ],
      "summary": "GoodMemory Import Memory"
    },
    {
      "flags": [
        {
          "name": "--user-id",
          "type": "string"
        },
        {
          "name": "--tenant-id",
          "type": "string"
        },
        {
          "name": "--workspace-id",
          "type": "string"
        },
        {
          "name": "--agent-id",
          "type": "string"
        },
        {
          "name": "--session-id",
          "type": "string"
        },
        {
          "name": "--storage-provider",
          "type": "string",
          "choices": [
            "memory",
            "sqlite",
            "postgres"
          ]
        },
        {
          "name": "--storage-url",
          "type": "string"
        },
        {
          "name": "--include-runtime",
          "type": "boolean"
        },
        {
          "name": "--json",
          "type": "boolean"
        }
      ],
      "path": [
        "inspect"
      ],
      "summary": "GoodMemory Inspect"
    },
    {
      "flags": [
        {
          "name": "--user-id",
          "type": "boolean"
        }
      ],
      "path": [
        "inspector"
      ],
      "summary": "GoodMemory Inspector"
    },
    {
      "flags": [
        {
          "name": "--user-id",
          "type": "string"
        },
        {
          "name": "--memory-path",
          "type": "string"
        },
        {
          "name": "--storage-provider",
          "type": "string",
          "choices": [
            "sqlite",
            "postgres"
          ]
        },
        {
          "name": "--storage-url",
          "type": "string"
        },
        {
          "name": "--embedding-provider",
          "type": "string"
        },
        {
          "name": "--embedding-model",
          "type": "string"
        },
        {
          "name": "--embedding-api-key",
          "type": "string"
        },
        {
          "name": "--embedding-base-url",
          "type": "string"
        },
        {
          "name": "--llm-provider",
          "type": "string",
          "choices": [
            "openai",
            "anthropic"
          ]
        },
        {
          "name": "--llm-model",
          "type": "string"
        },
        {
          "name": "--llm-api-key",
          "type": "string"
        },
        {
          "name": "--llm-base-url",
          "type": "string"
        },
        {
          "name": "--activation-mode",
          "type": "string",
          "choices": [
            "global",
            "workspace_opt_in"
          ]
        },
        {
          "name": "--default-locale",
          "type": "string"
        },
        {
          "name": "--writeback",
          "type": "string",
          "choices": [
            "off",
            "observe",
            "review",
            "selective"
          ]
        },
        {
          "name": "--file-mirror",
          "type": "boolean"
        },
        {
          "name": "--dry-run",
          "type": "boolean"
        },
        {
          "name": "--interactive",
          "type": "boolean"
        },
        {
          "name": "--no-interactive",
          "type": "boolean"
        },
        {
          "name": "--json",
          "type": "boolean"
        }
      ],
      "path": [
        "install"
      ],
      "summary": "GoodMemory Install CLI"
    },
    {
      "flags": [],
      "path": [
        "mcp"
      ],
      "summary": "GoodMemory MCP CLI"
    },
    {
      "flags": [],
      "path": [
        "mcp",
        "serve"
      ],
      "summary": "GoodMemory MCP Serve"
    },
    {
      "flags": [
        {
          "name": "--user-id",
          "type": "string"
        },
        {
          "name": "--tenant-id",
          "type": "string"
        },
        {
          "name": "--workspace-id",
          "type": "string"
        },
        {
          "name": "--agent-id",
          "type": "string"
        },
        {
          "name": "--session-id",
          "type": "string"
        },
        {
          "name": "--message",
          "type": "string"
        },
        {
          "name": "--role",
          "type": "string",
          "choices": [
            "user",
            "assistant"
          ]
        },
        {
          "name": "--kind",
          "type": "boolean"
        },
        {
          "name": "--title",
          "type": "string"
        },
        {
          "name": "--tags",
          "type": "string"
        },
        {
          "name": "--extraction-strategy",
          "type": "string",
          "choices": [
            "auto",
            "rules-only",
            "llm-assisted"
          ]
        },
        {
          "name": "--locale",
          "type": "string"
        },
        {
          "name": "--observed-at",
          "type": "string"
        },
        {
          "name": "--timezone",
          "type": "string"
        },
        {
          "name": "--host",
          "type": "string",
          "choices": [
            "codex",
            "claude"
          ]
        },
        {
          "name": "--workspace-root",
          "type": "string"
        },
        {
          "name": "--storage-provider",
          "type": "string",
          "choices": [
            "memory",
            "sqlite",
            "postgres"
          ]
        },
        {
          "name": "--storage-url",
          "type": "string"
        },
        {
          "name": "--json",
          "type": "boolean"
        }
      ],
      "path": [
        "remember"
      ],
      "summary": "GoodMemory Remember"
    },
    {
      "flags": [
        {
          "name": "--workspace-root",
          "type": "string"
        },
        {
          "name": "--dry-run",
          "type": "boolean"
        },
        {
          "name": "--json",
          "type": "boolean"
        }
      ],
      "path": [
        "repair"
      ],
      "summary": "GoodMemory Repair CLI"
    },
    {
      "flags": [],
      "path": [
        "runtime"
      ],
      "summary": "GoodMemory Runtime CLI"
    },
    {
      "flags": [],
      "path": [
        "runtime",
        "viewer"
      ],
      "summary": "GoodMemory Runtime Viewer"
    },
    {
      "flags": [],
      "path": [
        "runtime",
        "worker"
      ],
      "summary": "GoodMemory Runtime Worker"
    },
    {
      "flags": [
        {
          "name": "--host",
          "type": "string",
          "choices": [
            "codex",
            "claude",
            "both"
          ]
        },
        {
          "name": "--user-id",
          "type": "string"
        },
        {
          "name": "--activation-mode",
          "type": "string",
          "choices": [
            "global",
            "workspace_opt_in"
          ]
        },
        {
          "name": "--context-mode",
          "type": "string",
          "choices": [
            "fragment",
            "progressive"
          ]
        },
        {
          "name": "--default-locale",
          "type": "string"
        },
        {
          "name": "--writeback",
          "type": "string",
          "choices": [
            "off",
            "observe",
            "review",
            "selective"
          ]
        },
        {
          "name": "--file-mirror",
          "type": "boolean"
        },
        {
          "name": "--dry-run",
          "type": "boolean"
        },
        {
          "name": "--interactive",
          "type": "boolean"
        },
        {
          "name": "--no-interactive",
          "type": "boolean"
        },
        {
          "name": "--json",
          "type": "boolean"
        }
      ],
      "path": [
        "setup"
      ],
      "summary": "GoodMemory Setup CLI"
    },
    {
      "flags": [
        {
          "name": "--user-id",
          "type": "string"
        },
        {
          "name": "--tenant-id",
          "type": "string"
        },
        {
          "name": "--workspace-id",
          "type": "string"
        },
        {
          "name": "--agent-id",
          "type": "string"
        },
        {
          "name": "--session-id",
          "type": "string"
        },
        {
          "name": "--storage-provider",
          "type": "string",
          "choices": [
            "memory",
            "sqlite",
            "postgres"
          ]
        },
        {
          "name": "--storage-url",
          "type": "string"
        },
        {
          "name": "--include-runtime",
          "type": "boolean"
        },
        {
          "name": "--json",
          "type": "boolean"
        }
      ],
      "path": [
        "stats"
      ],
      "summary": "GoodMemory Stats"
    },
    {
      "flags": [
        {
          "name": "--workspace-root",
          "type": "string"
        },
        {
          "name": "--json",
          "type": "boolean"
        }
      ],
      "path": [
        "status"
      ],
      "summary": "GoodMemory Status CLI"
    },
    {
      "flags": [],
      "path": [
        "storage"
      ],
      "summary": "GoodMemory Storage CLI"
    },
    {
      "flags": [
        {
          "name": "--storage-provider",
          "type": "boolean"
        },
        {
          "name": "--storage-url",
          "type": "string"
        },
        {
          "name": "--storage-schema",
          "type": "string"
        },
        {
          "name": "--json",
          "type": "boolean"
        }
      ],
      "path": [
        "storage",
        "migrate"
      ],
      "summary": "GoodMemory Postgres Document Index Migration"
    },
    {
      "flags": [
        {
          "name": "--user-id",
          "type": "string"
        },
        {
          "name": "--tenant-id",
          "type": "string"
        },
        {
          "name": "--workspace-id",
          "type": "string"
        },
        {
          "name": "--agent-id",
          "type": "string"
        },
        {
          "name": "--session-id",
          "type": "string"
        },
        {
          "name": "--query",
          "type": "string"
        },
        {
          "name": "--retrieval-profile",
          "type": "string",
          "choices": [
            "general_chat",
            "coding_agent"
          ]
        },
        {
          "name": "--strategy",
          "type": "string",
          "choices": [
            "auto",
            "rules-only",
            "hybrid",
            "llm-assisted"
          ]
        },
        {
          "name": "--locale",
          "type": "string"
        },
        {
          "name": "--reference-time",
          "type": "string"
        },
        {
          "name": "--timezone",
          "type": "string"
        },
        {
          "name": "--ignore-memory",
          "type": "boolean"
        },
        {
          "name": "--json",
          "type": "boolean"
        },
        {
          "name": "--storage-provider",
          "type": "string",
          "choices": [
            "memory",
            "sqlite",
            "postgres"
          ]
        },
        {
          "name": "--storage-url",
          "type": "string"
        }
      ],
      "path": [
        "trace"
      ],
      "summary": "GoodMemory Trace"
    },
    {
      "flags": [],
      "path": [
        "uninstall"
      ],
      "summary": "GoodMemory Uninstall CLI"
    }
  ]
};

export function renderCliSchema(version: string): string {
  return `${JSON.stringify({ version, ...CLI_SCHEMA }, null, 2)}\n`;
}
