// Rellena los secretos vacíos o con "cambiar" del .env local. No muestra los valores.
const fs = require("fs");
const crypto = require("crypto");
const ruta = process.argv[2] || ".env";
let txt = fs.readFileSync(ruta, "utf8");
const hex = (n = 24) => crypto.randomBytes(n).toString("hex");
const b64 = () => crypto.randomBytes(32).toString("base64");
const valores = {
  POSTGRES_SUPERPASSWORD: hex(),
  ADMISION_DB_PASSWORD: hex(),
  N8N_DB_PASSWORD: hex(),
  KEYCLOAK_DB_PASSWORD: hex(),
  KEYCLOAK_ADMIN_PASSWORD: hex(12),
  KEYCLOAK_API_CLIENT_SECRET: hex(),
  INTERNAL_API_TOKEN: hex(32),
  N8N_WEBHOOK_SECRET: hex(32),
  N8N_ENCRYPTION_KEY: hex(32),
  DATA_ENCRYPTION_KEY: b64(),
  DATA_HMAC_KEY: b64(),
};
for (const [clave, valor] of Object.entries(valores)) {
  const re = new RegExp(`^${clave}=(.*)$`, "m");
  const m = txt.match(re);
  if (!m) {
    console.log(`${clave}: no está en el archivo`);
    continue;
  }
  const actual = m[1].trim();
  if (actual && !actual.startsWith("cambiar")) {
    console.log(`${clave}: ya tenía valor, no se toca`);
    continue;
  }
  txt = txt.replace(re, `${clave}=${valor}`);
  console.log(`${clave}: generado`);
}
fs.writeFileSync(ruta, txt);
