// Kill switch helpers. The switch file is the single source of truth:
// every delegation tool refuses to run when it is "off".
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const stateDir = path.join(ROOT, "state");
export const SWITCH_FILE = path.join(stateDir, "switch.txt");

fs.mkdirSync(stateDir, { recursive: true });
if (!fs.existsSync(SWITCH_FILE)) fs.writeFileSync(SWITCH_FILE, "off\n");

export function readSwitch() {
  try {
    return fs.readFileSync(SWITCH_FILE, "utf8").trim().toLowerCase();
  } catch {
    return "off";
  }
}

export function setSwitch(state) {
  const v = String(state).trim().toLowerCase() === "on" ? "on" : "off";
  fs.writeFileSync(SWITCH_FILE, v + "\n");
  return v;
}

// Append a line to state/log.txt (local debug, ignored by git).
export function LOG(msg) {
  try {
    fs.appendFileSync(path.join(stateDir, "log.txt"),
      `${new Date().toISOString()} ${msg}\n`);
  } catch { /* never break the main flow on logging */ }
}
