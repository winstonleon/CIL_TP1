// HU0021-1.0, 3.0 y 4.0 por la API con Keycloak y Mailpit reales (la pantalla G10 se prueba en el tramo b).
// Requiere el entorno dev levantado, `npm run kc:usuarios-prueba` y `npm run db:seed` (la directora de prueba
// tiene fila en personal). Deja cuentas hu0021-e2e-*@ejemplo.test en dev (compromiso C16).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import {
  admin,
  contrasenaE2E,
  correoConEnlace,
  correoE2E,
  definirContrasena,
  iniciarSesion,
  llamarApi,
  rolesDeApp,
  usuarioKeycloak,
} from "./ayudantes";

const usuarios: { username: string; rol: string }[] = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../infra/keycloak/usuarios-prueba.json"), "utf8"),
);
const DIRECTORA = usuarios.find((u) => u.rol === "directora")!.username;

test.describe.configure({ mode: "serial" });

test.describe("HU0021 cuentas del personal por la API (Keycloak y Mailpit reales)", () => {
  const correo = correoE2E();
  const contrasena = contrasenaE2E();
  let tokenDirectora: string;
  let idPersonal: number;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(60_000);
    const token = await iniciarSesion(browser, DIRECTORA, process.env.KEYCLOAK_TEST_USER_PASSWORD!);
    expect(token, "la directora de prueba no pudo iniciar sesión").toBeTruthy();
    tokenDirectora = token!;
  });

  test("HU0021-1.0 la API crea la cuenta con su rol y Keycloak envía a Mailpit el enlace para definir la contraseña", async ({ request }) => {
    const res = await llamarApi(request, "post", "/personal", tokenDirectora, { nombres: "Prueba", apellidos: "E2E", correo, rol: "tesoreria" });
    expect(res.status()).toBe(201);
    const cuenta = await res.json();
    expect(cuenta).toMatchObject({ correo, rol: "tesoreria", activo: true });
    idPersonal = cuenta.id_personal;

    const usuario = await usuarioKeycloak(correo);
    expect(usuario.enabled).toBe(true);
    expect(usuario.attributes?.origen).toEqual(["api-personal"]);
    const { datos: roles } = await (await admin())("GET", `/users/${usuario.id}/role-mappings/realm`);
    expect(roles.map((r: { name: string }) => r.name)).toContain("tesoreria");

    const { mensaje, enlace } = await correoConEnlace(request, correo);
    expect(mensaje.From.Address).toBe(process.env.KEYCLOAK_SMTP_FROM);
    expect(mensaje.To.map((d: { Address: string }) => d.Address)).toEqual([correo]);
    expect(enlace).toContain("client_id=gestion-interna");
  });

  test("HU0021-1.0 con el enlace la persona define su contraseña, inicia sesión y su token trae solo su rol", async ({ browser, request }) => {
    test.setTimeout(90_000);
    const { enlace } = await correoConEnlace(request, correo);
    await definirContrasena(browser, enlace, contrasena);

    const token = await iniciarSesion(browser, correo, contrasena);
    expect(token, "la cuenta nueva no pudo iniciar sesión").toBeTruthy();
    expect(rolesDeApp(token!)).toEqual(["tesoreria"]);
  });

  test("HU0021-3.0 tras cambiar el rol, en el siguiente inicio de sesión el token trae solo el rol nuevo", async ({ browser, request }) => {
    test.setTimeout(60_000);
    const res = await llamarApi(request, "patch", `/personal/${idPersonal}`, tokenDirectora, { rol: "psicologa", nombres: "Prueba Cambiada" });
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ rol: "psicologa", nombres: "Prueba Cambiada" });
    expect((await usuarioKeycloak(correo)) as { firstName?: string }).toMatchObject({ firstName: "Prueba Cambiada" });

    const token = await iniciarSesion(browser, correo, contrasena);
    expect(token).toBeTruthy();
    expect(rolesDeApp(token!)).toEqual(["psicologa"]);
  });

  test("HU0021-4.0 tras desactivar, Keycloak la deja deshabilitada y sin sesiones, el login es rechazado y la lista la muestra inactiva", async ({ browser, request }) => {
    test.setTimeout(60_000);
    // Una sesión abierta antes de desactivar.
    expect(await iniciarSesion(browser, correo, contrasena)).toBeTruthy();
    const usuario = await usuarioKeycloak(correo);

    const res = await llamarApi(request, "post", `/personal/${idPersonal}/desactivacion`, tokenDirectora);
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ id_personal: idPersonal, activo: false });

    expect((await usuarioKeycloak(correo)).enabled).toBe(false);
    const { datos: sesiones } = await (await admin())("GET", `/users/${usuario.id}/sessions`);
    expect(sesiones).toEqual([]);
    expect(await iniciarSesion(browser, correo, contrasena)).toBeNull();

    const lista = await llamarApi(request, "get", "/personal", tokenDirectora);
    expect(await lista.json()).toContainEqual(expect.objectContaining({ id_personal: idPersonal, activo: false }));
  });
});
