import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager,
} from "/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/index.js";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, "..");

async function runVerify() {
  console.log("==================================================");
  console.log("🧪 Testing pi-util-commands Extension Package");
  console.log("==================================================");

  const loader = new DefaultResourceLoader({
    cwd: packageRoot,
    agentDir: getAgentDir(),
    additionalExtensionPaths: [path.join(packageRoot, "index.ts")],
  });

  await loader.reload();
  const extResult = loader.getExtensions();
  const commandsExt = extResult.extensions.find((e) => e.path.includes(packageRoot));

  if (!commandsExt) {
    throw new Error("pi-util-commands extension failed to load!");
  }
  console.log("   ✓ pi-util-commands extension loaded successfully.");

  // Test commands
  const skillsCmd = commandsExt.commands.get("skills");
  const agentsCmd = commandsExt.commands.get("agents");
  const toolsCmd = commandsExt.commands.get("tools");
  const extensionCmd = commandsExt.commands.get("extension");
  const extensionsCmd = commandsExt.commands.get("extensions");
  const allCmdsCmd = commandsExt.commands.get("commands");

  if (!skillsCmd || !agentsCmd || !toolsCmd || !extensionCmd || !extensionsCmd || !allCmdsCmd) {
    throw new Error("Missing inspection slash commands in pi-util-commands!");
  }

  let notified = "";
  const mockCtx = {
    cwd: packageRoot,
    ui: {
      notify: (msg) => {
        notified = msg;
      },
    },
  };

  await skillsCmd.handler("", mockCtx);
  console.log("   ✓ /skills command executed successfully.");

  await agentsCmd.handler("", mockCtx);
  console.log("   ✓ /agents command executed successfully.");

  // 1. Test fallback when runtime stubs throw
  await toolsCmd.handler("", mockCtx);
  if (!notified.includes("Active Tools (7)")) {
    throw new Error(`/tools fallback failed! Output:\n${notified}`);
  }
  console.log("   ✓ /tools command fallback executed successfully.");

  // 2. Test live runtime behavior where getActiveTools returns string[]
  extResult.runtime.getAllTools = () => [
    { name: "read", label: "File Reader", description: "Read file" },
    { name: "bash", label: "Bash Execution", description: "Run bash" },
    { name: "edit", label: "File Editor", description: "Edit file" },
  ];
  extResult.runtime.getActiveTools = () => ["read", "bash"];

  await toolsCmd.handler("", mockCtx);
  if (!notified.includes("Active Tools (2)") || !notified.includes("Gated / Inactive Tools (1)")) {
    throw new Error(`/tools command failed to distinguish active tools from string[]! Output:\n${notified}`);
  }
  console.log("   ✓ /tools command correctly identifies active tools from string array.");

  // Test /extension and /extensions
  await extensionCmd.handler("", mockCtx);
  if (!notified.includes("Installed Extensions") || !notified.includes("Enabled")) {
    throw new Error(`/extension command failed to list extensions! Output:\n${notified}`);
  }
  console.log("   ✓ /extension command listed installed extensions with enabled/disabled status.");

  await extensionsCmd.handler("pi-util-commands", mockCtx);
  if (!notified.includes("Extension: pi-util-commands") || !notified.includes("🟢 Enabled")) {
    throw new Error(`/extensions command failed to inspect extension! Output:\n${notified}`);
  }
  console.log("   ✓ /extensions <name> successfully inspected extension details.");

  // Test interactive custom UI with ExtensionViewerComponent
  let customUiRendered = false;
  let componentDone = false;
  const mockInteractiveCtx = {
    cwd: packageRoot,
    hasUI: true,
    ui: {
      custom: async (factory) => {
        customUiRendered = true;
        const fakeDone = () => {
          componentDone = true;
        };
        const comp = await factory(
          {},
          { fg: (_c, s) => s, bold: (s) => s },
          {},
          fakeDone
        );

        // Test navigation
        if (comp.getSelectedIndex() !== 0) throw new Error("Initial selected index should be 0");
        comp.handleInput("j");
        comp.handleInput("\x1b[B");
        comp.handleInput("k");
        comp.handleInput("\x1b[A");

        // Test toggle input
        await comp.toggleCurrent();

        // Test reload input
        await comp.reloadCurrent();

        // Test ESC to close
        comp.handleInput("\x1b");
        return comp;
      },
      notify: () => {},
    },
    reload: async () => {},
  };

  await extensionCmd.handler("", mockInteractiveCtx);
  if (!customUiRendered || !componentDone) {
    throw new Error("Interactive TUI ExtensionViewerComponent failed to render or exit on ESC!");
  }
  console.log("   ✓ ExtensionViewerComponent interactive navigation, toggle, reload, and ESC exit passed.");

  await allCmdsCmd.handler("", mockCtx);
  console.log("   ✓ /commands overview command executed successfully.");

  // 3. Practical Pi Session Integration Test
  console.log("--------------------------------------------------");
  console.log("🔌 Testing inside real AgentSession lifecycle...");

  const sessionLoader = new DefaultResourceLoader({
    cwd: packageRoot,
    agentDir: getAgentDir(),
    noExtensions: true,
    additionalExtensionPaths: [path.join(packageRoot, "index.ts")],
  });
  await sessionLoader.reload();

  let sessionNotified = "";
  const { session } = await createAgentSession({
    cwd: packageRoot,
    resourceLoader: sessionLoader,
    sessionManager: SessionManager.inMemory(packageRoot),
  });

  await session.bindExtensions({
    uiContext: {
      notify: (msg) => {
        sessionNotified = msg;
      },
    },
    mode: "interactive",
  });

  // Test default session tool listing
  await session.prompt("/tools");
  if (!sessionNotified.includes("Active Tools (4)")) {
    throw new Error(`Real session /tools failed default active tools! Got:\n${sessionNotified}`);
  }
  console.log("   ✓ Real session /tools correctly detected default 4 active tools.");

  // Test dynamic active tools modification in session
  session.setActiveToolsByName(["read", "bash"]);
  await session.prompt("/tools");
  if (!sessionNotified.includes("Active Tools (2)") || !sessionNotified.includes("Gated / Inactive Tools (5)")) {
    throw new Error(`Real session /tools failed dynamic tool changes! Got:\n${sessionNotified}`);
  }
  console.log("   ✓ Real session /tools dynamically updated when tools changed (2 active, 5 inactive).");

  // Test other slash commands in session
  await session.prompt("/skills");
  console.log("   ✓ Real session /skills dispatched successfully.");

  await session.prompt("/agents");
  console.log("   ✓ Real session /agents dispatched successfully.");

  await session.prompt("/extension");
  if (!sessionNotified.includes("Installed Extensions") || !sessionNotified.includes("Enabled")) {
    throw new Error(`Real session /extension failed! Got:\n${sessionNotified}`);
  }
  console.log("   ✓ Real session /extension dispatched successfully.");

  await session.prompt("/extension pi-util-commands");
  if (!sessionNotified.includes("pi-util-commands") || !sessionNotified.includes("Enabled")) {
    throw new Error(`Real session /extension <name> failed! Got:\n${sessionNotified}`);
  }
  console.log("   ✓ Real session /extension <name> inspected successfully.");

  await session.prompt("/commands");
  if (!sessionNotified.includes("/tools") || !sessionNotified.includes("/skills") || !sessionNotified.includes("/extension")) {
    throw new Error(`Real session /commands failed! Got:\n${sessionNotified}`);
  }
  console.log("   ✓ Real session /commands listed registered commands.");

  console.log("==================================================");
  console.log("✅ pi-util-commands verification passed!");
  console.log("==================================================");
}

runVerify().catch((err) => {
  console.error("❌ Verification failed:", err);
  process.exit(1);
});
