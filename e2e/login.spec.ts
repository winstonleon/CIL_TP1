// S0-C6: inicio de sesión real de punta a punta (Vue → Keycloak → Vue) con los usuarios de prueba ficticios.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

interface UsuarioPrueba {
  username: string;
  rol: string;
}
const usuarios: UsuarioPrueba[] = JSON.parse(readFileSync(resolve(import.meta.dirname, "../infra/keycloak/usuarios-prueba.json"), "utf8"));
const usuarioDeRol = (rol: string) => usuarios.find((u) => u.rol === rol)!.username;

const casos = [
  { ruta: "/gestion", cliente: "gestion-interna", rol: "secretaria", area: "Gestión interna" },
  { ruta: "/portal", cliente: "portal-familias", rol: "familia", area: "Portal de familias" },
];

for (const caso of casos) {
  test(`S0-C6 ${caso.rol} inicia sesión en ${caso.cliente} con PKCE y vuelve a ${caso.ruta} con su rol`, async ({ page }) => {
    await page.goto(caso.ruta);

    // El frontend redirige al formulario de Keycloak del cliente que corresponde, con PKCE.
    await expect(page).toHaveURL(/\/realms\/cil-admision\/protocol\/openid-connect\/auth\?/);
    const autorizacion = new URL(page.url());
    expect(autorizacion.searchParams.get("client_id")).toBe(caso.cliente);
    expect(autorizacion.searchParams.get("code_challenge_method")).toBe("S256");

    await page.locator("#username").fill(usuarioDeRol(caso.rol));
    await page.locator("#password").fill(process.env.KEYCLOAK_TEST_USER_PASSWORD!);
    await page.locator("#kc-login").click();

    await expect(page).toHaveURL(new RegExp(`${caso.ruta}$`));
    await expect(page.getByTestId("estado-sesion")).toHaveText("Sesión iniciada");
    await expect(page.getByTestId("area")).toHaveText(caso.area);
    await expect(page.getByTestId("roles")).toContainText(caso.rol);

    // ADR-02: el token no queda en el almacenamiento del navegador.
    const almacenado = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
    expect(almacenado).not.toMatch(/access_token/);
  });
}
