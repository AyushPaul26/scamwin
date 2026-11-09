import { pathToFileURL } from "node:url";

const requiredVariables = [
  "AUTH0_DOMAIN",
  "AUTH0_CLIENT_ID",
  "AUTH0_CLIENT_SECRET",
  "AUTH0_SECRET",
  "APP_BASE_URL",
  "DATABASE_URL",
  "TRIGGER_SECRET_KEY",
  "DAYTONA_API_KEY",
  "OPENMODS_ENV",
];

function isHttpsOrigin(value) {
  try {
    const url = new URL(value);
    return /^https:\/\//i.test(value) && url.hostname !== "" &&
      !url.username && !url.password && !url.search && !url.hash &&
      url.pathname === "/";
  } catch {
    return false;
  }
}

function isPostgresUrl(value) {
  try {
    const url = new URL(value);
    return ["postgres:", "postgresql:"].includes(url.protocol) &&
      url.hostname !== "" && url.pathname.length > 1 && !url.hash;
  } catch {
    return false;
  }
}

// Syntax checks only: startup and health probes must not wake external services.
export function getRenderEnvErrors(env) {
  const errors = [];
  for (const key of requiredVariables) {
    const value = env[key];
    if (typeof value !== "string" || !value.trim()) {
      errors.push(`${key}: required; set it in the Render service's Environment settings.`);
      continue;
    }
    if (value !== value.trim()) {
      errors.push(`${key}: remove leading or trailing whitespace.`);
      continue;
    }
    if (key === "OPENMODS_ENV" && value !== "production") {
      errors.push("OPENMODS_ENV: use production on Render.");
    } else if (key === "APP_BASE_URL" && !isHttpsOrigin(value)) {
      errors.push("APP_BASE_URL: use an HTTPS origin without credentials, a path, query, or fragment.");
    } else if (key === "DATABASE_URL" && !isPostgresUrl(value)) {
      errors.push("DATABASE_URL: use a postgres:// or postgresql:// URL with a hostname and database name.");
    } else if (key === "AUTH0_SECRET" && !/^[a-f0-9]{64}$/i.test(value)) {
      errors.push("AUTH0_SECRET: use a stable 64-character hexadecimal secret (generate once with openssl rand -hex 32).");
    } else if (key === "TRIGGER_SECRET_KEY" && !/^tr_prod_(?!sk_$)\S+$/.test(value)) {
      errors.push("TRIGGER_SECRET_KEY: use a Trigger.dev production secret key starting with tr_prod_ (or tr_prod_sk_ for a named API key).");
    }
  }
  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const errors = getRenderEnvErrors(process.env);
  if (errors.length) {
    console.error(`Render startup configuration is invalid:\n${errors.map((error) => `- ${error}`).join("\n")}`);
    process.exitCode = 1;
  } else {
    console.log("Render startup configuration is valid.");
  }
}
