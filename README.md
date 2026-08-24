# pi-util-commands

Interactive capability & runtime inspection slash commands for the **[Pi Coding Agent](https://github.com/earendil-works/pi-coding-agent)**. Part of the **[Pi-Agent Project](https://github.com/users/CH-YYK/projects/1)** ecosystem.

---

## 🌟 Commands

- **`/skills [name]`** — List all discovered Agent Skills across global (`~/.pi/agent/skills/`, `~/.pi/skills/`) and project-local (`skills/`, `.pi/skills/`) roots, or inspect details and directives for a specific skill.
- **`/agents [name]`** — List all discovered subagent personas (`agents/*.md`), permitted toolsets, and inspect full system instructions.
- **`/tools`** — Inspect active tools exposed to the LLM in the current session vs gated/inactive tools.
- **`/commands`** — High-level index overview of all registered slash commands and templates.

---

## 📦 Installation

Add to your global Pi configuration (`~/.pi/agent/settings.json`):

```json
{
  "packages": [
    "git:github.com/CH-YYK/pi-util-commands"
  ]
}
```

Or test transiently:
```bash
pi --extension /path/to/pi-util-commands/index.ts
```

---

## 🧪 Testing

```bash
npm run verify
```
