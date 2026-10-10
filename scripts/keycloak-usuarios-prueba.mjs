// Crea (o actualiza) en el realm los usuarios de prueba ficticios de infra/keycloak/usuarios-prueba.json,
// con la contraseña KEYCLOAK_TEST_USER_PASSWORD y su rol de realm. Es idempotente. Solo para dev.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { RAIZ, adminApi, cargarEntorno, requerida, tokenAdmin } from "./lib/keycloak.mjs";

cargarEntorno();
const usuarios = JSON.parse(readFileSync(resolve(RAIZ, "infra/keycloak/usuarios-prueba.json"), "utf8"));
const contrasena = requerida("KEYCLOAK_TEST_USER_PASSWORD");
const api = adminApi(await tokenAdmin());

for (const u of usuarios) {
  const { datos: existentes } = await api("GET", `/users?exact=true&username=${encodeURIComponent(u.username)}`);
  let id = existentes[0]?.id;
  if (!id) {
    const { res } = await api("POST", "/users", {
      username: u.username,
      email: u.username,
      firstName: u.firstName,
      lastName: u.lastName,
      enabled: true,
      emailVerified: true,
    });
    id = res.headers.get("location").split("/").pop();
  }
  await api("PUT", `/users/${id}/reset-password`, { type: "password", value: contrasena, temporary: false });
  const { datos: rol } = await api("GET", `/roles/${encodeURIComponent(u.rol)}`);
  await api("POST", `/users/${id}/role-mappings/realm`, [{ id: rol.id, name: rol.name }]);
  console.log(`${u.username}: listo (rol ${u.rol}, ${existentes[0] ? "actualizado" : "creado"})`);
}
