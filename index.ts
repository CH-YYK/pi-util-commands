/**
 * Pi Commands Extension (pi_commands)
 *
 * Interactive inspection slash commands for Pi Agent:
 * - `/skills [name]`: Discover and inspect agent skills (global and project-local)
 * - `/agents [name]`: Discover and inspect subagents and their directives (agents/*.md)
 * - `/tools`: Inspect active vs gated LLM tools for the current session
 * - `/commands`: Overview of all available slash commands
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";

export interface DiscoveredSkill {
  name: string;
  description: string;
  path: string;
  isProject: boolean;
}

export interface DiscoveredAgent {
  name: string;
  description: string;
  tools: string[];
  path: string;
  isProject: boolean;
  instructions: string;
}

function parseFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: content };
  }
  const rawYaml = match[1];
  const body = match[2];
  const frontmatter: Record<string, string> = {};
  for (const line of rawYaml.split(/\r?\n/)) {
    const colonIdx = line.indexOf(":");
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const val = line.slice(colonIdx + 1).trim();
      frontmatter[key] = val;
    }
  }
  return { frontmatter, body };
}

/**
 * Scan and load all available skills from global and project directories.
 */
export function loadAllSkills(cwd: string): DiscoveredSkill[] {
  const skills: DiscoveredSkill[] = [];
  const dirs = [
    { dir: path.join(getAgentDir(), "skills"), isProject: false },
    { dir: path.join(os.homedir(), ".pi", "skills"), isProject: false },
    { dir: path.join(cwd, CONFIG_DIR_NAME, "skills"), isProject: true },
    { dir: path.join(cwd, "skills"), isProject: true },
  ];

  const seen = new Set<string>();

  for (const { dir, isProject } of dirs) {
    if (!fs.existsSync(dir)) continue;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skillMd = path.join(dir, entry.name, "SKILL.md");
          if (fs.existsSync(skillMd)) {
            const content = fs.readFileSync(skillMd, "utf-8");
            const { frontmatter } = parseFrontmatter(content);
            const name = frontmatter.name || entry.name;
            if (!seen.has(name)) {
              seen.add(name);
              skills.push({
                name,
                description: frontmatter.description || "No description provided",
                path: skillMd,
                isProject,
              });
            }
          }
        } else if (entry.isFile() && entry.name.endsWith(".md")) {
          const name = entry.name.replace(/\.md$/, "");
          if (!seen.has(name)) {
            seen.add(name);
            const content = fs.readFileSync(path.join(dir, entry.name), "utf-8");
            const { frontmatter } = parseFrontmatter(content);
            skills.push({
              name: frontmatter.name || name,
              description: frontmatter.description || "No description provided",
              path: path.join(dir, entry.name),
              isProject,
            });
          }
        }
      }
    } catch {
      // ignore
    }
  }

  return skills;
}

/**
 * Scan and load all available subagents from global and project directories.
 */
export function loadAllAgents(cwd: string): DiscoveredAgent[] {
  const agents: DiscoveredAgent[] = [];
  const dirs = [
    { dir: path.join(getAgentDir(), "agents"), isProject: false },
    { dir: path.join(os.homedir(), ".pi", "agents"), isProject: false },
    { dir: path.join(cwd, CONFIG_DIR_NAME, "agents"), isProject: true },
    { dir: path.join(cwd, "agents"), isProject: true },
  ];

  const seen = new Set<string>();

  for (const { dir, isProject } of dirs) {
    if (!fs.existsSync(dir)) continue;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(".md")) {
          const name = entry.name.replace(/\.md$/, "");
          if (!seen.has(name)) {
            seen.add(name);
            const filePath = path.join(dir, entry.name);
            const content = fs.readFileSync(filePath, "utf-8");
            const { frontmatter, body } = parseFrontmatter(content);
            const tools = frontmatter.tools
              ? frontmatter.tools.split(",").map((t) => t.trim()).filter(Boolean)
              : [];
            agents.push({
              name: frontmatter.name || name,
              description: frontmatter.description || "Subagent persona",
              tools,
              path: filePath,
              isProject,
              instructions: body.trim(),
            });
          }
        }
      }
    } catch {
      // ignore
    }
  }

  return agents;
}

export default async function piCommandsExtension(pi: ExtensionAPI) {
  // Built-in tools fallback for inspection outside active session
  const defaultTools = [
    { name: "read", label: "File Reader", description: "Read file contents from filesystem" },
    { name: "bash", label: "Bash Execution", description: "Execute terminal shell commands" },
    { name: "edit", label: "File Editor", description: "Edit existing files with exact replacements" },
    { name: "write", label: "File Writer", description: "Create or overwrite files" },
    { name: "grep", label: "Regex Search", description: "Search file contents using regex" },
    { name: "find", label: "File Finder", description: "Find files and directories by pattern" },
    { name: "ls", label: "Directory Listing", description: "List files and subdirectories" },
  ];

  // 1. Command: /skills - List all discovered skills or inspect a skill
  pi.registerCommand("skills", {
    description: "List all discovered skills or inspect details (/skills <name>)",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const skills = loadAllSkills(ctx.cwd);
      const query = args.trim().toLowerCase();

      if (query) {
        const found = skills.find((s) => s.name.toLowerCase() === query);
        if (!found) {
          ctx.ui.notify(`Skill "${args.trim()}" not found.`, "warning");
          return;
        }
        let detail = `🧠 Skill: ${found.name}\n` +
          `Scope: ${found.isProject ? "Project-Local" : "Global"}\n` +
          `Path: ${found.path}\n\n` +
          `Description:\n${found.description}`;
        ctx.ui.notify(detail, "info");
        return;
      }

      if (skills.length === 0) {
        ctx.ui.notify("No skills discovered in ~/.pi/agent/skills/ or project skills/.", "info");
        return;
      }

      const globalSkills = skills.filter((s) => !s.isProject);
      const projectSkills = skills.filter((s) => s.isProject);

      let msg = `🧠 Discovered Agent Skills (${skills.length} total):\n\n`;
      if (globalSkills.length > 0) {
        msg += `🌐 Global Skills (~/.pi/agent/skills/):\n` +
          globalSkills.map((s) => `  • ${s.name}: ${s.description}`).join("\n") + "\n\n";
      }
      if (projectSkills.length > 0) {
        msg += `📁 Project Skills (skills/):\n` +
          projectSkills.map((s) => `  • ${s.name}: ${s.description}`).join("\n") + "\n\n";
      }
      msg += `💡 Tip: Inspect skill details with \`/skills <name>\``;
      ctx.ui.notify(msg, "info");
    },
  });

  // 2. Command: /agents (or /subagents) - List all discovered subagents or inspect instructions
  pi.registerCommand("agents", {
    description: "List all subagent personas or inspect instructions (/agents <name>)",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const agents = loadAllAgents(ctx.cwd);
      const query = args.trim().toLowerCase();

      if (query) {
        const found = agents.find((a) => a.name.toLowerCase() === query);
        if (!found) {
          ctx.ui.notify(`Subagent "${args.trim()}" not found.`, "warning");
          return;
        }
        let detail = `🤖 Subagent: ${found.name}\n` +
          `Scope: ${found.isProject ? "Project-Local" : "Global"}\n` +
          `Tools: ${found.tools.length > 0 ? found.tools.join(", ") : "inherit all"}\n` +
          `Path: ${found.path}\n\n` +
          `Description: ${found.description}\n\n` +
          `Directives & Instructions:\n${found.instructions}`;
        ctx.ui.notify(detail, "info");
        return;
      }

      if (agents.length === 0) {
        ctx.ui.notify("No subagents found in ~/.pi/agent/agents/ or project agents/.", "info");
        return;
      }

      let msg = `🤖 Available Subagents (${agents.length}):\n\n`;
      for (const a of agents) {
        msg += `• ${a.name} (${a.isProject ? "Project" : "Global"})\n` +
          `    ${a.description}\n` +
          `    Tools: ${a.tools.length > 0 ? a.tools.join(", ") : "inherit all"}\n\n`;
      }
      msg += `💡 Tip: View subagent instructions with \`/agents <name>\``;
      ctx.ui.notify(msg, "info");
    },
  });

  // 3. Command: /tools - List active and available tools in the session
  pi.registerCommand("tools", {
    description: "List active and available LLM tools in current session",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      let allTools: Array<{ name: string; label?: string; description?: string }> = [];
      try {
        allTools = pi.getAllTools();
      } catch {
        allTools = defaultTools;
      }

      let rawActive: any[] = [];
      try {
        rawActive = pi.getActiveTools();
      } catch {
        rawActive = allTools.map((t) => t.name);
      }

      const activeNames = new Set(
        rawActive.map((t) => (typeof t === "string" ? t : t.name)).filter(Boolean)
      );
      const activeToolsList: string[] = [];
      const inactiveToolsList: string[] = [];

      for (const tool of allTools) {
        const isActive = activeNames.has(tool.name);
        const item = `• ${tool.name} (${tool.label || "Tool"})\n    ${tool.description}`;
        if (isActive) {
          activeToolsList.push(item);
        } else {
          inactiveToolsList.push(item);
        }
      }

      let msg = `🛠️ LLM Toolset Overview:\n\n`;
      msg += `🟢 Active Tools (${activeToolsList.length}) — Available to LLM in current session:\n`;
      msg += (activeToolsList.join("\n\n") || "  (none)") + "\n\n";

      if (inactiveToolsList.length > 0) {
        msg += `⚪ Gated / Inactive Tools (${inactiveToolsList.length}) — Disabled by profile or settings:\n`;
        msg += inactiveToolsList.join("\n\n") + "\n\n";
      }

      msg += `💡 Tip: Persona profiles can restrict or expand active tools.`;
      ctx.ui.notify(msg, "info");
    },
  });

  // 4. Command: /commands - Overview of all registered slash commands
  pi.registerCommand("commands", {
    description: "List all registered slash commands and templates",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      let commands: Array<{ name: string; description?: string }> = [];
      try {
        commands = pi.getCommands();
      } catch {
        commands = [
          { name: "profiles", description: "List all prebuilt and custom profiles" },
          { name: "profile", description: "Show current session profile details" },
          { name: "skills", description: "List all discovered skills or inspect details" },
          { name: "agents", description: "List all subagent personas or inspect instructions" },
          { name: "tools", description: "List active and available LLM tools in current session" },
          { name: "commands", description: "List all registered slash commands and templates" },
        ];
      }
      let msg = `⚡ Registered Slash Commands (${commands.length}):\n\n`;
      for (const cmd of commands) {
        msg += `• /${cmd.name}\n    ${cmd.description || "No description"}\n`;
      }
      ctx.ui.notify(msg, "info");
    },
  });
}
