"use client";

import { useState } from "react";

const MCP_URL = "https://mcp.bu.finance/mcp";

const INSTALL_OPTIONS = [
  {
    id: "claude-code",
    name: "Claude Code",
    icon: "⌘",
    command: `claude mcp add --transport http bufi-hyper ${MCP_URL}`,
    description: "One-liner for Claude Code CLI",
  },
  {
    id: "claude-desktop",
    name: "Claude Desktop",
    icon: "🖥",
    config: JSON.stringify(
      {
        mcpServers: {
          "bufi-hyper": {
            command: "npx",
            args: ["-y", "mcp-remote", MCP_URL, "--allow-http"],
          },
        },
      },
      null,
      2,
    ),
    path: "~/Library/Application Support/Claude/claude_desktop_config.json",
    description: "Add to Claude Desktop config",
  },
  {
    id: "cursor",
    name: "Cursor",
    icon: "↗",
    config: JSON.stringify(
      {
        mcpServers: {
          "bufi-hyper": {
            command: "npx",
            args: ["-y", "mcp-remote", MCP_URL, "--allow-http"],
          },
        },
      },
      null,
      2,
    ),
    path: ".cursor/mcp.json",
    description: "Add to Cursor MCP config",
  },
  {
    id: "windsurf",
    name: "Windsurf",
    icon: "🌊",
    config: JSON.stringify(
      {
        mcpServers: {
          "bufi-hyper": {
            command: "npx",
            args: ["-y", "mcp-remote", MCP_URL, "--allow-http"],
          },
        },
      },
      null,
      2,
    ),
    path: ".windsurf/mcp.json",
    description: "Add to Windsurf MCP config",
  },
  {
    id: "mcp-json",
    name: ".mcp.json",
    icon: "📄",
    config: JSON.stringify(
      {
        mcpServers: {
          "bufi-hyper": { type: "url", url: MCP_URL },
        },
      },
      null,
      2,
    ),
    path: ".mcp.json (project root)",
    description: "Universal MCP config file",
  },
] as const;

export function McpInstallDropdown() {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(INSTALL_OPTIONS[0]);
  const [copied, setCopied] = useState(false);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const textToCopy = "command" in selected ? (selected as { command: string }).command : (selected as { config: string }).config;

  return (
    <div className="relative inline-block text-left">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-2 rounded-lg border border-yellow-400/30 bg-gradient-to-r from-yellow-400/10 to-orange-400/10 px-4 py-2.5 text-sm font-medium text-yellow-200 shadow-lg shadow-yellow-400/5 backdrop-blur-sm transition-all hover:border-yellow-400/50 hover:shadow-yellow-400/10"
      >
        <span className="text-base">{selected.icon}</span>
        <span>Connect Agent</span>
        <svg
          className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[420px] origin-top-right rounded-xl border border-white/10 bg-gray-900/95 shadow-2xl backdrop-blur-xl">
          <div className="flex border-b border-white/10">
            {INSTALL_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setSelected(opt)}
                className={`flex-1 px-3 py-2.5 text-xs font-medium transition-colors ${
                  selected.id === opt.id
                    ? "border-b-2 border-yellow-400 text-yellow-300"
                    : "text-gray-400 hover:text-gray-200"
                }`}
              >
                <span className="mr-1">{opt.icon}</span>
                {opt.name}
              </button>
            ))}
          </div>

          <div className="p-4">
            <p className="mb-2 text-xs text-gray-400">{selected.description}</p>

            {"path" in selected && selected.path && (
              <p className="mb-2 text-xs text-gray-500">
                File: <code className="text-gray-400">{selected.path}</code>
              </p>
            )}

            <div className="relative">
              <pre className="overflow-x-auto rounded-lg bg-black/50 p-3 text-xs text-green-300 font-mono leading-relaxed">
                {textToCopy}
              </pre>
              <button
                type="button"
                onClick={() => copyToClipboard(textToCopy)}
                className="absolute right-2 top-2 rounded-md bg-white/10 px-2 py-1 text-xs text-gray-300 transition-colors hover:bg-white/20"
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>

            <div className="mt-3 flex items-center justify-between">
              <a
                href="https://mcp.bu.finance/mcp"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-yellow-400/70 hover:text-yellow-400"
              >
                35 tools available
              </a>
              <a
                href="https://mcp.bu.finance/llms.txt"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-gray-500 hover:text-gray-300"
              >
                llms.txt
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
