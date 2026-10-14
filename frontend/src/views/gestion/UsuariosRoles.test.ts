// G10 · Usuarios y roles: alta (HU0021-1.0), modificación (3.0) y desactivación (4.0) desde la pantalla, con la
// API simulada en fetch. Así se prueba también el cliente real (llamarApi + api/personal): método, ruta y cuerpo.
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usuarioActual } from "../../auth/oidc";
import { usuarioFalso } from "../../pruebas/ayudantes";
import UsuariosRoles from "./UsuariosRoles.vue";

vi.mock("../../auth/oidc", async (original) => ({
  ...(await original<typeof import("../../auth/oidc")>()),
  usuarioActual: vi.fn(),
}));

interface Cuenta {
  id_personal: number;
  nombres: string;
  apellidos: string;
  correo: string;
  rol: string;
  activo: boolean;
}

interface Llamada {
  metodo: string;
  url: string;
  cuerpo?: unknown;
}

let cuentas: Cuenta[];
let politica: Record<string, string[]>;
let llamadas: Llamada[];
let errorSiguiente: { status: number; codigo: string; mensaje: string } | null;

const responder = (status: number, cuerpo: unknown) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { "Content-Type": "application/json" } });

// API simulada de /personal con el formato de la API real.
function apiFalsa(url: string, init: RequestInit = {}): Response {
  const metodo = init.method ?? "GET";
  const cuerpo = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
  llamadas.push({ metodo, url, cuerpo });
  if (metodo !== "GET" && errorSiguiente) {
    const { status, codigo, mensaje } = errorSiguiente;
    errorSiguiente = null;
    return responder(status, { error: { codigo, mensaje } });
  }
  if (metodo === "GET" && url === "/api/personal") return responder(200, cuentas);
  if (metodo === "GET" && url === "/api/personal/permisos") return responder(200, politica);
  if (metodo === "POST" && url === "/api/personal") {
    const nueva = { id_personal: 100 + cuentas.length, ...cuerpo, activo: true };
    cuentas = [...cuentas, nueva];
    return responder(201, nueva);
  }
  const patch = url.match(/^\/api\/personal\/(\d+)$/);
  if (metodo === "PATCH" && patch) {
    const c = cuentas.find((x) => x.id_personal === Number(patch[1]))!;
    Object.assign(c, cuerpo);
    return responder(200, c);
  }
  const baja = url.match(/^\/api\/personal\/(\d+)\/desactivacion$/);
  if (metodo === "POST" && baja) {
    const c = cuentas.find((x) => x.id_personal === Number(baja[1]))!;
    c.activo = false;
    return responder(200, c);
  }
  return responder(404, { error: { codigo: "NO_ENCONTRADO", mensaje: "Recurso no encontrado" } });
}

beforeEach(() => {
  cuentas = [
    { id_personal: 7, nombres: "Rosa", apellidos: "Medina", correo: "rmedina@ejemplo.test", rol: "secretaria", activo: true },
    { id_personal: 8, nombres: "Gabriela", apellidos: "Ortiz", correo: "gortiz@ejemplo.test", rol: "secretaria", activo: false },
  ];
  politica = { documentacion_financiera: ["tesoreria"], informe_psicologico: ["psicologa", "directora"] };
  llamadas = [];
  errorSiguiente = null;
  vi.stubEnv("VITE_API_URL", "/api");
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => apiFalsa(url, init)));
  vi.mocked(usuarioActual).mockResolvedValue(usuarioFalso(["directora"], "Directora Ficticia"));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function montar() {
  const envoltorio = mount(UsuariosRoles);
  await flushPromises();
  return envoltorio;
}

const fila = (e: VueWrapper, id: number) => e.get(`[data-testid="cuenta-${id}"]`);
const escrituras = () => llamadas.filter((l) => l.metodo !== "GET");

async function completar(e: VueWrapper, datos: { nombres?: string; apellidos?: string; correo?: string; rol?: string }) {
  if (datos.nombres !== undefined) await e.get("#g10n").setValue(datos.nombres);
  if (datos.apellidos !== undefined) await e.get("#g10a").setValue(datos.apellidos);
  if (datos.correo !== undefined) await e.get("#g10c").setValue(datos.correo);
  if (datos.rol !== undefined) await e.get("#g10r").setValue(datos.rol);
}

async function enviar(e: VueWrapper) {
  await e.get("form").trigger("submit");
  await flushPromises();
}

describe("HU0021-1.0 alta desde G10", () => {
  it("HU0021-1.0 envía nombres, apellidos, correo y rol a POST /personal y la cuenta aparece en la tabla como Activo", async () => {
    const e = await montar();
    expect(e.get("#g10-formulario").text()).toBe("Nuevo usuario");

    await completar(e, { nombres: " Ana Lucía ", apellidos: "Pérez Ruiz", correo: "aperez@ejemplo.test", rol: "tesoreria" });
    await enviar(e);

    expect(escrituras()).toEqual([
      { metodo: "POST", url: "/api/personal", cuerpo: { nombres: "Ana Lucía", apellidos: "Pérez Ruiz", correo: "aperez@ejemplo.test", rol: "tesoreria" } },
    ]);
    const nueva = e.findAll("tbody tr").find((tr) => tr.text().includes("aperez@ejemplo.test"))!;
    expect(nueva.text()).toContain("Ana Lucía Pérez Ruiz");
    expect(nueva.text()).toContain("Tesorería");
    expect(nueva.text()).toContain("Activo");
    expect(e.get('[role="status"]').text()).toContain("aperez@ejemplo.test");
    // El formulario queda listo para otra alta.
    expect((e.get("#g10n").element as HTMLInputElement).value).toBe("");
  });

  it("HU0021-1.0 no envía el alta si falta un campo obligatorio o el correo no es válido", async () => {
    const e = await montar();
    await enviar(e);
    expect(e.findAll(".error-campo").map((p) => p.text())).toEqual([
      "Este campo es obligatorio.",
      "Este campo es obligatorio.",
      "Este campo es obligatorio.",
      "Selecciona un rol.",
    ]);
    expect(e.get("#g10n").attributes("aria-invalid")).toBe("true");

    await completar(e, { nombres: "Ana", apellidos: "Pérez", correo: "no-es-correo", rol: "secretaria" });
    await enviar(e);
    expect(e.get("#g10c-error").text()).toBe("Ingresa un correo válido.");
    expect(escrituras()).toEqual([]);
  });

  it("HU0021-1.0 si el correo ya tiene cuenta (409) muestra el mensaje de la API y no agrega filas", async () => {
    errorSiguiente = { status: 409, codigo: "CORREO_DUPLICADO", mensaje: "Ya existe una cuenta con ese correo" };
    const e = await montar();
    await completar(e, { nombres: "Rosa", apellidos: "Medina", correo: "rmedina@ejemplo.test", rol: "secretaria" });
    await enviar(e);

    expect(e.get('[role="alert"]').text()).toBe("Ya existe una cuenta con ese correo");
    expect(e.findAll("tbody tr[data-testid]")).toHaveLength(2);
  });
});

describe("HU0021-3.0 modificación desde G10", () => {
  it("HU0021-3.0 «Editar» carga la cuenta en el panel con el correo bloqueado y «Guardar cambios» envía el PATCH", async () => {
    const e = await montar();
    await fila(e, 7).get('button[aria-label="Editar Rosa Medina"]').trigger("click");

    expect(e.get("#g10-formulario").text()).toBe("Editar usuario");
    expect((e.get("#g10n").element as HTMLInputElement).value).toBe("Rosa");
    expect((e.get("#g10c").element as HTMLInputElement).value).toBe("rmedina@ejemplo.test");
    expect(e.get("#g10c").attributes()).toHaveProperty("disabled");
    expect(e.get('button[type="submit"]').text()).toBe("Guardar cambios");

    await completar(e, { nombres: "Rosa María", rol: "psicologa" });
    await enviar(e);

    expect(escrituras()).toEqual([{ metodo: "PATCH", url: "/api/personal/7", cuerpo: { nombres: "Rosa María", apellidos: "Medina", rol: "psicologa" } }]);
    expect(fila(e, 7).text()).toContain("Rosa María Medina");
    expect(fila(e, 7).text()).toContain("Psicología");
    expect(e.get("#g10-formulario").text()).toBe("Nuevo usuario");
    expect(e.get('[role="status"]').text()).toBe("Cambios guardados.");
  });

  it("HU0021-3.0 «Cancelar» sale de la edición sin enviar nada", async () => {
    const e = await montar();
    await fila(e, 7).get('button[aria-label="Editar Rosa Medina"]').trigger("click");
    await e.get(".formulario .boton-secundario").trigger("click");
    expect(e.get("#g10-formulario").text()).toBe("Nuevo usuario");
    expect(e.get("#g10c").attributes()).not.toHaveProperty("disabled");
    expect(escrituras()).toEqual([]);
  });
});

describe("HU0021-4.0 desactivación desde G10", () => {
  it("HU0021-4.0 «Desactivar» pide confirmación; al confirmar la cuenta queda «Desactivado» y sin acciones", async () => {
    const e = await montar();
    // Una cuenta ya desactivada no muestra acciones (no hay Reactivar en esta HU).
    expect(fila(e, 8).text()).toContain("Desactivado");
    expect(fila(e, 8).findAll("button")).toHaveLength(0);

    await fila(e, 7).get('button[aria-label="Desactivar Rosa Medina"]').trigger("click");
    const dialogo = e.get("dialog");
    expect(dialogo.text()).toContain("¿Desactivar la cuenta de Rosa Medina? No podrá iniciar sesión.");

    // Cancelar no envía nada.
    await dialogo.findAll("button").find((b) => b.text() === "Cancelar")!.trigger("click");
    expect(e.find("dialog").exists()).toBe(false);
    expect(escrituras()).toEqual([]);

    await fila(e, 7).get('button[aria-label="Desactivar Rosa Medina"]').trigger("click");
    await e.get("dialog").findAll("button").find((b) => b.text() === "Desactivar")!.trigger("click");
    await flushPromises();

    expect(escrituras()).toEqual([{ metodo: "POST", url: "/api/personal/7/desactivacion", cuerpo: undefined }]);
    expect(fila(e, 7).text()).toContain("Desactivado");
    expect(fila(e, 7).findAll("button")).toHaveLength(0);
    expect(e.find("dialog").exists()).toBe(false);
  });
});

describe("Soporte de G10: matriz «Permisos por rol»", () => {
  // Matriz del mockup G10 (✓ = true), en el orden de sus columnas.
  const MOCKUP: Record<string, boolean[]> = {
    Secretaría: [true, true, false, false, true, true, false],
    Tesorería: [true, false, true, false, false, false, false],
    Psicología: [true, false, false, true, false, false, false],
    "Evaluación académica": [true, false, false, false, false, false, false],
    Dirección: [true, false, false, true, false, false, true],
  };

  const leerMatriz = (e: VueWrapper) =>
    Object.fromEntries(
      e.get('[data-testid="matriz-permisos"]').findAll("tbody tr").map((tr) => [
        tr.get("th").text(),
        tr.findAll("td").map((td) => td.get(".solo-lector").text() === "Sí"),
      ]),
    );

  it("G10 la matriz de permisos se genera de GET /personal/permisos y de menu.ts y coincide con el mockup", async () => {
    const e = await montar();
    expect(e.get('[data-testid="matriz-permisos"] thead').findAll("th").map((th) => th.text())).toEqual([
      "Rol",
      "Datos del postulante",
      "Documentos",
      "Doc. financiera",
      "Informe psicológico",
      "Visitas",
      "Configuración",
      "Usuarios e indicadores",
    ]);
    expect(leerMatriz(e)).toEqual(MOCKUP);
  });

  it("G10 las columnas restringidas siguen a la política de la API, no a un texto fijo", async () => {
    politica = { documentacion_financiera: ["tesoreria"], informe_psicologico: ["psicologa"] };
    const e = await montar();
    expect(leerMatriz(e).Dirección).toEqual([true, false, false, false, false, false, true]);
  });
});
