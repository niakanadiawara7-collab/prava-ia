// Charge le fichier .env (clé API, Twilio…) avant tout le reste.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.env.TZ ||= "Europe/Paris";
const envFile = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
