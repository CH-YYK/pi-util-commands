import {
  DefaultResourceLoader,
  getAgentDir,
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
  const allCmdsCmd = commandsExt.commands.get("commands");

  if (!skillsCmd || !agentsCmd || !toolsCmd || !allCmdsCmd) {
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

  await toolsCmd.handler("", mockCtx);
  if (!notified.includes("Active Tools")) {
    throw new Error("/tools command failed to list active tools!");
  }
  console.log("   ✓ /tools command executed successfully.");

  await allCmdsCmd.handler("", mockCtx);
  console.log("   ✓ /commands overview command executed successfully.");

  console.log("==================================================");
  console.log("✅ pi-util-commands verification passed!");
  console.log("==================================================");
}

runVerify().catch((err) => {
  console.error("❌ Verification failed:", err);
  process.exit(1);
});
