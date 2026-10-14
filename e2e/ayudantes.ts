// Ayudantes de los E2E de HU0021: login real con Keycloak, lectura del enlace en Mailpit y Admin API
// (con la cuenta admin del master, solo para verificar). Nunca imprimen tokens, contraseñas ni enlaces.
import { randomBytes } from "node:crypto";
import { expect, type APIRequestContext, type Browser } from "@playwright/test";
import { adminApi, tokenAdmin } from "../scripts/lib/keycloak.mjs";

export const FRONTEND = process.env.FRONTEND_PUBLIC_URL!.replace(/\/$/, "");
export const API = `http://127.0.0.1:${process.env.API_PORT || 3000}`;
export const MAILPIT = `http://127.0.0.1:${process.env.MAILPIT_UI_PORT || 8025}`;

export const correoE2E = () => `hu0021-e2e-${Date.now()}-${randomBytes(3).toString("hex")}@ejemplo.test`;
// Contraseña distinta en cada corrida; no queda en el repo.
export const contrasenaE2E = () => `E2e-${randomBytes(12).toString("base64url")}9!`;

export function rolesDelToken(token: string): string[] {
  const carga = JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString("utf8"));
  return carga.realm_access?.roles ?? [];
}

const ROLES_APP = ["familia", "secretaria", "tesoreria", "psicologa", "evaluador_academico", "directora"];
export const rolesDeApp = (token: string) => rolesDelToken(token).filter((r) => ROLES_APP.includes(r));

// Inicia sesión en /gestion (cliente gestion-interna, PKCE) en un contexto nuevo y devuelve el token de acceso,
// tomado de la respuesta del token endpoint. Devuelve null si Keycloak no deja entrar.
export async function iniciarSesion(browser: Browser, usuario: string, contrasena: string): Promise<string | null> {
  const contexto = await browser.newContext();
  const pagina = await contexto.newPage();
  try {
    await pagina.goto(`${FRONTEND}/gestion`);
    await pagina.locator("#username").fill(usuario);
    await pagina.locator("#password").fill(contrasena);
    const respuestaToken = pagina
      .waitForResponse((r) => new URL(r.url()).pathname.endsWith("/protocol/openid-connect/token") && r.request().method() === "POST", { timeout: 15_000 })
      .catch(() => null);
    await pagina.locator("#kc-login").click();
    const respuesta = await respuestaToken;
    if (!respuesta) {
      // Sigue en el formulario de Keycloak: no hubo inicio de sesión.
      await expect(pagina.locator("#kc-login")).toBeVisible();
      return null;
    }
    return ((await respuesta.json()) as { access_token: string }).access_token;
  } finally {
    await contexto.close();
  }
}

// Espera el correo de Keycloak para `correo` en Mailpit y devuelve el mensaje y el enlace de acción.
export async function correoConEnlace(request: APIRequestContext, correo: string) {
  let id: string | undefined;
  await expect
    .poll(
      async () => {
        const r = await (await request.get(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${correo}"`)}`)).json();
        id = r.messages?.[0]?.ID;
        return r.messages?.length ?? 0;
      },
      { timeout: 30_000 },
    )
    .toBe(1);
  const mensaje = await (await request.get(`${MAILPIT}/api/v1/message/${id}`)).json();
  const enlace = String(mensaje.Text ?? "").match(/https?:\/\/\S+\/login-actions\/action-token\?\S+/)?.[0];
  expect(enlace, "el correo no trae el enlace de acción de Keycloak").toBeTruthy();
  return { mensaje, enlace: enlace! };
}

// Abre el enlace del correo y define la contraseña (acción UPDATE_PASSWORD) en las páginas de Keycloak.
export async function definirContrasena(browser: Browser, enlace: string, contrasena: string): Promise<void> {
  const contexto = await browser.newContext();
  const pagina = await contexto.newPage();
  try {
    await pagina.goto(enlace);
    const nueva = pagina.locator("#password-new");
    // Keycloak puede mostrar antes «Realice las siguientes acciones… Haga clic aquí para continuar».
    if (!(await nueva.waitFor({ state: "visible", timeout: 5_000 }).then(() => true, () => false))) {
      await pagina.locator("a[href*='action-token']").first().click();
    }
    await nueva.fill(contrasena);
    await pagina.locator("#password-confirm").fill(contrasena);
    await pagina.locator("form [type='submit']").first().click();
    await pagina.waitForLoadState("networkidle");
  } finally {
    await contexto.close();
  }
}

export async function admin() {
  return adminApi(await tokenAdmin());
}

export async function usuarioKeycloak(correo: string) {
  const api = await admin();
  const { datos } = await api("GET", `/users?email=${encodeURIComponent(correo)}&exact=true&briefRepresentation=false`);
  expect(datos, `no hay usuario de Keycloak para el correo de la prueba`).toHaveLength(1);
  return datos[0] as { id: string; enabled: boolean; attributes?: Record<string, string[]> };
}

// Llamada a la API con el token de la directora (puerto publicado de dev).
export function llamarApi(request: APIRequestContext, metodo: "get" | "post" | "patch", ruta: string, token: string, datos?: unknown) {
  return request[metodo](`${API}${ruta}`, { headers: { Authorization: `Bearer ${token}` }, data: datos, failOnStatusCode: false });
}
