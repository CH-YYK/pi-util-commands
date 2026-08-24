/**
 * Pi Commands Extension (pi_commands)
 *
 * Interactive inspection slash commands for Pi Agent:
 * - `/skills [name]`: Discover and inspect agent skills (global and project-local)
 * - `/agents [name]`: Discover and inspect subagents and their directives (agents/*.md)
 * - `/tools`: Inspect active vs gated LLM tools for the current session
 * - `/extension [name]` (or `/extensions`): Discover and inspect installed extensions and enabled/disabled state
 * - `/commands`: Overview of all available slash commands
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { CONFIG_DIR_NAME, DefaultPackageManager, getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";
import { Container, getKeybindings, Spacer, Text } from "@earendil-works/pi-tui";

export interface DiscoveredExtension {
  name: string;
  source: string;
  description: string;
  path: string;
  scope: "user" | "project";
  origin: "package" | "top-level";
  enabled: boolean;
}

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

/**
 * Scan and load all installed extensions from packages, global, and project directories.
 */
export async function loadAllExtensions(cwd: string): Promise<DiscoveredExtension[]> {
  const extensions: DiscoveredExtension[] = [];
  const seenPaths = new Set<string>();

  try {
    const agentDir = getAgentDir();
    const settingsManager = SettingsManager.create(cwd, agentDir);
    const pm = new DefaultPackageManager({ cwd, agentDir, settingsManager });
    const resolved = await pm.resolve();

    for (const ext of resolved.extensions) {
      const normalizedPath = path.resolve(ext.path);
      if (seenPaths.has(normalizedPath)) continue;
      seenPaths.add(normalizedPath);

      let name = path.basename(ext.path, path.extname(ext.path));
      let description = "Extension module";

      if (ext.metadata.baseDir) {
        const pkgJson = path.join(ext.metadata.baseDir, "package.json");
        if (fs.existsSync(pkgJson)) {
          try {
            const data = JSON.parse(fs.readFileSync(pkgJson, "utf-8"));
            if (data.name) name = data.name;
            if (data.description) description = data.description;
          } catch {
            // ignore
          }
        }
      }

      extensions.push({
        name,
        source: ext.metadata.source,
        description,
        path: ext.path,
        scope: ext.metadata.scope === "project" ? "project" : "user",
        origin: ext.metadata.origin,
        enabled: ext.enabled,
      });
    }
  } catch {
    // Fallback directory discovery
    const dirs = [
      { dir: path.join(getAgentDir(), "extensions"), scope: "user" as const },
      { dir: path.join(cwd, CONFIG_DIR_NAME, "extensions"), scope: "project" as const },
      { dir: path.join(cwd, "extensions"), scope: "project" as const },
    ];

    for (const { dir, scope } of dirs) {
      if (!fs.existsSync(dir)) continue;
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const entryPath = path.join(dir, entry.name);
          if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".js"))) {
            const normalizedPath = path.resolve(entryPath);
            if (!seenPaths.has(normalizedPath)) {
              seenPaths.add(normalizedPath);
              extensions.push({
                name: entry.name.replace(/\.[tj]s$/, ""),
                source: entryPath,
                description: "Local top-level extension",
                path: entryPath,
                scope,
                origin: "top-level",
                enabled: true,
              });
            }
          } else if (entry.isDirectory()) {
            const indexTs = path.join(entryPath, "index.ts");
            const indexJs = path.join(entryPath, "index.js");
            const target = fs.existsSync(indexTs) ? indexTs : fs.existsSync(indexJs) ? indexJs : null;
            if (target) {
              const normalizedPath = path.resolve(target);
              if (!seenPaths.has(normalizedPath)) {
                seenPaths.add(normalizedPath);
                let name = entry.name;
                let description = "Directory extension";
                const pkgJson = path.join(entryPath, "package.json");
                if (fs.existsSync(pkgJson)) {
                  try {
                    const data = JSON.parse(fs.readFileSync(pkgJson, "utf-8"));
                    if (data.name) name = data.name;
                    if (data.description) description = data.description;
                  } catch {
                    // ignore
                  }
                }
                extensions.push({
                  name,
                  source: entryPath,
                  description,
                  path: target,
                  scope,
                  origin: "top-level",
                  enabled: true,
                });
              }
            }
          }
        }
      } catch {
        // ignore
      }
    }
  }

  return extensions;
}

/**
 * Toggle enable/disable status of a package extension in settings.json.
 */
export function togglePackageExtension(
  source: string,
  scope: "user" | "project",
  enable: boolean,
  cwd: string
): boolean {
  try {
    const agentDir = getAgentDir();
    const settingsManager = SettingsManager.create(cwd, agentDir);

    const packages = scope === "project"
      ? (settingsManager.getProjectSettings()?.packages ?? [])
      : settingsManager.getPackages();

    let modified = false;
    const newPackages = packages.map((pkg) => {
      const pkgSource = typeof pkg === "string" ? pkg : pkg.source;
      if (pkgSource === source) {
        modified = true;
        if (enable) {
          if (typeof pkg === "object") {
            const { extensions, ...rest } = pkg;
            if (Object.keys(rest).length === 1 && rest.source) {
              return rest.source;
            }
            return rest;
          }
          return pkg;
        } else {
          if (typeof pkg === "string") {
            return { source: pkg, extensions: [] };
          } else {
            return { ...pkg, extensions: [] };
          }
        }
      }
      return pkg;
    });

    if (modified) {
      if (scope === "project") {
        settingsManager.setProjectPackages(newPackages);
      } else {
        settingsManager.setPackages(newPackages);
      }
    }
    return modified;
  } catch {
    return false;
  }
}

export interface ExtensionViewerOptions {
  cwd: string;
  extensions: DiscoveredExtension[];
  theme: any;
  keybindings?: any;
  onToggle?: (ext: DiscoveredExtension) => Promise<boolean> | boolean;
  onReload?: () => Promise<void> | void;
  onClose: () => void;
}

/**
 * Interactive TUI component for browsing, inspecting, and toggling installed extensions.
 */
export class ExtensionViewerComponent extends Container {
  private extensions: DiscoveredExtension[];
  private selectedIndex: number = 0;
  private cwd: string;
  private theme: any;
  private onClose: () => void;
  private onToggle?: (ext: DiscoveredExtension) => Promise<boolean> | boolean;
  private onReload?: () => Promise<void> | void;

  private headerText: Text;
  private summaryText: Text;
  private listContainer: Container;
  private detailsContainer: Container;
  private statusNoticeText: Text;

  constructor(options: ExtensionViewerOptions) {
    super();
    this.cwd = options.cwd;
    this.extensions = options.extensions;
    this.theme = options.theme;
    this.onClose = options.onClose;
    this.onToggle = options.onToggle;
    this.onReload = options.onReload;

    this.addChild(new Text(this.theme.fg("border", "─".repeat(60)), 1, 0));
    this.headerText = new Text(this.theme.fg("accent", this.theme.bold("🧩 Extensions Manager")), 1, 0);
    this.addChild(this.headerText);
    this.summaryText = new Text("", 1, 0);
    this.addChild(this.summaryText);
    this.addChild(new Text(this.theme.fg("border", "─".repeat(60)), 1, 0));
    this.addChild(new Spacer(1));

    this.listContainer = new Container();
    this.addChild(this.listContainer);
    this.addChild(new Spacer(1));

    this.addChild(new Text(this.theme.fg("border", "─".repeat(60)), 1, 0));
    this.detailsContainer = new Container();
    this.addChild(this.detailsContainer);
    this.addChild(new Text(this.theme.fg("border", "─".repeat(60)), 1, 0));
    this.addChild(new Spacer(1));

    this.statusNoticeText = new Text("", 1, 0);
    this.addChild(this.statusNoticeText);

    // Keybindings hint footer
    const hints = [
      this.theme.fg("dim", "↑↓/jk") + this.theme.fg("muted", " navigate"),
      this.theme.fg("dim", "Space/Enter") + this.theme.fg("muted", " toggle enable/disable"),
      this.theme.fg("dim", "r") + this.theme.fg("muted", " reload runtime"),
      this.theme.fg("dim", "Esc/q") + this.theme.fg("muted", " exit"),
    ].join("   ");
    this.addChild(new Text(hints, 1, 0));
    this.addChild(new Text(this.theme.fg("border", "─".repeat(60)), 1, 0));

    this.updateView();
  }

  public getSelectedIndex(): number {
    return this.selectedIndex;
  }

  public setSelectedIndex(idx: number): void {
    this.selectedIndex = Math.max(0, Math.min(this.extensions.length - 1, idx));
    this.updateView();
  }

  public setStatusMessage(msg: string): void {
    this.statusNoticeText.setText(msg ? `💡 ${this.theme.fg("warning", msg)}\n` : "");
  }

  public updateExtensions(exts: DiscoveredExtension[]): void {
    this.extensions = exts;
    this.selectedIndex = Math.max(0, Math.min(this.extensions.length - 1, this.selectedIndex));
    this.updateView();
  }

  private updateView(): void {
    const enabledCount = this.extensions.filter((e) => e.enabled).length;
    const disabledCount = this.extensions.filter((e) => !e.enabled).length;
    this.summaryText.setText(
      this.theme.fg("dim", `Total: ${this.extensions.length}  |  `) +
      this.theme.fg("success", `🟢 Enabled: ${enabledCount}`) +
      this.theme.fg("dim", `  |  `) +
      this.theme.fg("muted", `⚪ Disabled: ${disabledCount}`)
    );

    // Update list
    this.listContainer.clear();
    if (this.extensions.length === 0) {
      this.listContainer.addChild(new Text(this.theme.fg("dim", "  (no extensions found)"), 1, 0));
    } else {
      for (let i = 0; i < this.extensions.length; i++) {
        const ext = this.extensions[i];
        const isSelected = i === this.selectedIndex;
        const prefix = isSelected ? this.theme.fg("accent", "→ ") : "  ";
        const statusBadge = ext.enabled ? this.theme.fg("success", "[🟢 Enabled]") : this.theme.fg("muted", "[⚪ Disabled]");
        const scopeBadge = ext.scope === "project" ? this.theme.fg("warning", "[Project]") : this.theme.fg("accent", "[Global]");
        const originBadge = ext.origin === "package" ? this.theme.fg("dim", "(pkg)") : this.theme.fg("dim", "(dir)");
        const nameText = isSelected ? this.theme.fg("accent", this.theme.bold(ext.name)) : this.theme.fg("text", ext.name);

        this.listContainer.addChild(
          new Text(`${prefix}${statusBadge} ${scopeBadge} ${nameText} ${originBadge}`, 1, 0)
        );
      }
    }

    // Update details
    this.detailsContainer.clear();
    const current = this.extensions[this.selectedIndex];
    if (current) {
      const stateBadge = current.enabled
        ? this.theme.fg("success", "🟢 Enabled")
        : this.theme.fg("muted", "⚪ Disabled");
      const lines = [
        `${this.theme.bold("Name:")} ${this.theme.fg("accent", current.name)}    ${this.theme.bold("State:")} ${stateBadge}`,
        `${this.theme.bold("Source:")} ${this.theme.fg("text", current.source)}`,
        `${this.theme.bold("Scope:")} ${current.scope === "project" ? "Project-Local" : "Global"}    ${this.theme.bold("Origin:")} ${current.origin === "package" ? "Package" : "Top-Level Directory"}`,
        `${this.theme.bold("Path:")} ${this.theme.fg("dim", current.path)}`,
        "",
        `${this.theme.bold("Description:")}`,
        this.theme.fg("text", `  ${current.description}`),
      ];
      for (const line of lines) {
        this.detailsContainer.addChild(new Text(line, 1, 0));
      }
    } else {
      this.detailsContainer.addChild(new Text(this.theme.fg("dim", "Select an extension above to view details."), 1, 0));
    }
  }

  public async toggleCurrent(): Promise<void> {
    const current = this.extensions[this.selectedIndex];
    if (!current) return;

    if (this.onToggle) {
      await this.onToggle(current);
    } else {
      togglePackageExtension(current.source, current.scope, !current.enabled, this.cwd);
      current.enabled = !current.enabled;
    }

    this.setStatusMessage(
      `Toggled "${current.name}" to ${current.enabled ? "Enabled" : "Disabled"}. Press "r" to reload session.`
    );
    this.updateView();
  }

  public async reloadCurrent(): Promise<void> {
    if (this.onReload) {
      this.setStatusMessage(`Reloading runtime extensions...`);
      await this.onReload();
      this.setStatusMessage(`Runtime reloaded successfully!`);
    } else {
      this.setStatusMessage(`Reload requested. Restart or reload session to apply changes.`);
    }
  }

  public handleInput(keyData: string): void {
    const kb = getKeybindings();
    if (kb.matches(keyData, "tui.select.cancel") || keyData === "\x1b" || keyData === "q" || keyData === "\x03") {
      this.onClose();
    } else if (kb.matches(keyData, "tui.select.up") || keyData === "k" || keyData === "\x1b[A") {
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      this.updateView();
    } else if (kb.matches(keyData, "tui.select.down") || keyData === "j" || keyData === "\x1b[B") {
      this.selectedIndex = Math.min(this.extensions.length - 1, this.selectedIndex + 1);
      this.updateView();
    } else if (keyData === " " || keyData === "t" || keyData === "\r" || keyData === "\n" || kb.matches(keyData, "tui.select.confirm")) {
      void this.toggleCurrent();
    } else if (keyData === "r" || keyData === "R") {
      void this.reloadCurrent();
    }
  }

  public dispose(): void {
    // Cleanup if necessary
  }
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

  // 4. Command: /extension (or /extensions) - List all installed extensions and enabled/disabled state
  const extensionHandler = async (args: string, ctx: ExtensionCommandContext) => {
    const query = args.trim();

    // If no query and interactive UI mode is available, open interactive TUI viewer
    if (!query && ctx.hasUI && typeof ctx.ui.custom === "function") {
      const extensions = await loadAllExtensions(ctx.cwd);
      await ctx.ui.custom((_tui, theme, _keybindings, done) => {
        return new ExtensionViewerComponent({
          cwd: ctx.cwd,
          extensions,
          theme,
          onToggle: async (ext) => {
            togglePackageExtension(ext.source, ext.scope, !ext.enabled, ctx.cwd);
            ext.enabled = !ext.enabled;
            return ext.enabled;
          },
          onReload: async () => {
            try {
              if (typeof ctx.reload === "function") {
                await ctx.reload();
              }
            } catch {
              // ignore
            }
          },
          onClose: () => done(undefined),
        });
      });
      return;
    }

    // Text fallback or specific query inspection (/extension <name>)
    const extensions = await loadAllExtensions(ctx.cwd);
    const queryLower = query.toLowerCase();

    if (queryLower) {
      const found = extensions.find(
        (e) =>
          e.name.toLowerCase() === queryLower ||
          e.source.toLowerCase() === queryLower ||
          e.path.toLowerCase().includes(queryLower)
      );
      if (!found) {
        ctx.ui.notify(`Extension "${args.trim()}" not found.`, "warning");
        return;
      }
      let detail = `🧩 Extension: ${found.name}\n` +
        `State: ${found.enabled ? "🟢 Enabled" : "⚪ Disabled"}\n` +
        `Source: ${found.source}\n` +
        `Scope: ${found.scope === "project" ? "Project-Local" : "Global"}\n` +
        `Origin: ${found.origin === "package" ? "Package" : "Top-Level"}\n` +
        `Path: ${found.path}\n\n` +
        `Description:\n${found.description}`;
      ctx.ui.notify(detail, "info");
      return;
    }

    if (extensions.length === 0) {
      ctx.ui.notify("No extensions installed or discovered.", "info");
      return;
    }

    const enabledExts = extensions.filter((e) => e.enabled);
    const disabledExts = extensions.filter((e) => !e.enabled);

    let msg = `🧩 Installed Extensions (${extensions.length} total):\n\n`;

    msg += `🟢 Enabled (${enabledExts.length}):\n`;
    if (enabledExts.length > 0) {
      msg += enabledExts
        .map(
          (e) =>
            `  • ${e.name} (${e.scope === "project" ? "Project" : "Global"} ${e.origin === "package" ? "Package" : "Extension"})\n` +
            `      Source: ${e.source}\n` +
            `      ${e.description}`
        )
        .join("\n\n") + "\n\n";
    } else {
      msg += `  (none)\n\n`;
    }

    if (disabledExts.length > 0) {
      msg += `⚪ Disabled (${disabledExts.length}):\n` +
        disabledExts
          .map(
            (e) =>
              `  • ${e.name} (${e.scope === "project" ? "Project" : "Global"} ${e.origin === "package" ? "Package" : "Extension"})\n` +
              `      Source: ${e.source}\n` +
              `      ${e.description}`
          )
          .join("\n\n") + "\n\n";
    }

    msg += `💡 Tip: Inspect extension details with \`/extension <name>\``;
    ctx.ui.notify(msg, "info");
  };

  pi.registerCommand("extension", {
    description: "List all installed extensions and their enabled/disabled state (/extension <name>)",
    handler: extensionHandler,
  });

  pi.registerCommand("extensions", {
    description: "List all installed extensions and their enabled/disabled state (/extensions <name>)",
    handler: extensionHandler,
  });

  // 5. Command: /commands - Overview of all registered slash commands
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
          { name: "extension", description: "List all installed extensions and their enabled/disabled state" },
          { name: "extensions", description: "List all installed extensions and their enabled/disabled state" },
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
