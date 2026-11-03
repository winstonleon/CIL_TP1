// P05 y P05b · Ficha de inscripción y cuestionario (HU0005) con la API simulada en fetch. Se monta la app con el enrutador
// real en /portal/ficha. Solo se prueba la lógica propia de la pantalla: avance de pasos, guardado automático, errores del
// servidor en el campo, el aviso del segundo apoderado a medias y la lista de documentos al completar.
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory } from "vue-router";
import App from "../../App.vue";
import { usuarioActual } from "../../auth/oidc";
import { usuarioFalso } from "../../pruebas/ayudantes";
import { crearEnrutador } from "../../router";
import { TEXTO_SEGUNDO_PARCIAL } from "../../portal/guardadoAutomatico";

vi.mock("../../auth/oidc", async (original) => ({
  ...(await original<typeof import("../../auth/oidc")>()),
  usuarioActual: vi.fn(),
  iniciarSesion: vi.fn(),
}));

const ID = 7;
const RESUMEN = { id_expediente: ID, codigo: "ADM-2027-0007", estado: "portal_habilitado", grado: "3.° de primaria", postulante: null, ficha_completa: false };

function fichaVacia(cambios: Record<string, unknown> = {}) {
  return {
    id_expediente: ID,
    codigo: RESUMEN.codigo,
    estado: "portal_habilitado",
    ficha_completa: false,
    guardado_en: null,
    grado: { nombre_grado: "3.° de primaria", nivel: "primaria" },
    postulante: { nombres: null, apellido_paterno: null, apellido_materno: null, dni: null, fecha_nacimiento: null, estudio_en_colegio_peruano: null, colegio_procedencia: null, tiene_condicion_especial: null },
    titular: { nombres: "María Fernanda", apellidos: "Quispe Rojas", telefono: "+51987654321", correo: "mfquispe@ejemplo.test", parentesco: null, dni: null, condicion_laboral: null },
    segundo_apoderado: null,
    cuestionario: {
      version: "borrador-1",
      preguntas: [{ id: "p1", texto: "[Pregunta 1 del colegio por confirmar]" }, { id: "p2", texto: "[Pregunta 2 del colegio por confirmar]" }],
      respuestas: {},
    },
    ...cambios,
  };
}

let ficha: ReturnType<typeof fichaVacia>;
let respuestaPut: (cuerpo: Record<string, any>) => { status: number; cuerpo: unknown };
let puts: Record<string, any>[];

// Respuesta mínima compatible con api/respuesta.ts (sin flujos de bytes, para que los temporizadores falsos no la frenen).
const responder = (status: number, cuerpo: unknown) => ({ ok: status < 400, status, json: async () => cuerpo }) as Response;

function apiFalsa(url: string, init: RequestInit = {}): Response {
  const metodo = init.method ?? "GET";
  if (url === "/api/familia/expedientes") return responder(200, [RESUMEN]);
  if (url === `/api/familia/expedientes/${ID}/ficha` && metodo === "GET") return responder(200, ficha);
  if (url === `/api/familia/expedientes/${ID}/ficha` && metodo === "PUT") {
    const cuerpo = JSON.parse(String(init.body));
    puts.push(cuerpo);
    const r = respuestaPut(cuerpo);
    return responder(r.status, r.cuerpo);
  }
  return responder(404, { error: { codigo: "NO_ENCONTRADO", mensaje: "Recurso no encontrado" } });
}

const borradorGuardado = () => ({ status: 200, cuerpo: { ficha_completa: false, guardado_en: new Date().toISOString(), pendientes: [] } });
const montados: VueWrapper[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  ficha = fichaVacia();
  puts = [];
  respuestaPut = borradorGuardado;
  vi.stubEnv("VITE_API_URL", "/api");
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => apiFalsa(url, init)));
  vi.mocked(usuarioActual).mockResolvedValue(usuarioFalso(["familia"], "María Fernanda Quispe Rojas"));
});

afterEach(() => {
  for (const m of montados.splice(0)) m.unmount();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function esperar() {
  for (let i = 0; i < 6; i++) await flushPromises();
}

async function abrir(ruta = "/portal/ficha") {
  const enrutador = crearEnrutador(createMemoryHistory());
  const e = mount(App, { global: { plugins: [createPinia(), enrutador] }, attachTo: document.body });
  montados.push(e);
  await enrutador.push(ruta);
  await esperar();
  return { e, enrutador };
}

const boton = (e: VueWrapper, texto: string) => e.findAll("button").find((b) => b.text() === texto)!;
const pasoActivo = (e: VueWrapper) => e.get('[role="tab"][aria-selected="true"]').text();
const irAlPaso = async (e: VueWrapper, n: number) => {
  await e.findAll('[role="tab"]')[n - 1]!.trigger("click");
};
const estado = (e: VueWrapper) => e.get('[data-testid="estado-guardado"]').text();

describe("HU0005-2.0 P05 y P05b retoman el borrador", () => {
  it("HU0005-2.0 [parte: borrador] sin responder no se marca ninguna opción de Sí/No y del titular solo se editan DNI, parentesco y condición laboral", async () => {
    const { e } = await abrir();

    expect(e.get("h1").text()).toBe("Ficha de inscripción y cuestionario");
    expect(e.get('[data-testid="expediente-codigo"]').text()).toBe("Apoderado/a · Expediente ADM-2027-0007");
    for (const nombre of ["p05proc", "p05cond"]) {
      const radios = e.findAll(`input[name="${nombre}"]`);
      expect(radios).toHaveLength(2);
      expect(radios.map((r) => (r.element as HTMLInputElement).checked)).toEqual([false, false]); // null = sin responder
    }
    expect(e.get("#p05g").attributes("disabled")).toBeDefined(); // el grado no se edita

    await irAlPaso(e, 2);
    for (const id of ["p05bt-nom", "p05bt-ape", "p05bt-tel", "p05bt-cor"]) {
      expect(e.get(`#${id}`).attributes("disabled"), id).toBeDefined(); // vienen de P01
    }
    expect((e.get("#p05bt-nom").element as HTMLInputElement).value).toBe("María Fernanda");
    for (const id of ["p05bt-par", "p05bt-dni", "p05bs-nom"]) expect(e.get(`#${id}`).attributes("disabled"), id).toBeUndefined();
  });

  it("HU0005-2.0 [parte: borrador] muestra lo guardado al volver: respuestas marcadas, textos y «Borrador guardado hace 2 minutos»", async () => {
    ficha = fichaVacia({
      guardado_en: new Date(Date.now() - 2 * 60_000).toISOString(),
      postulante: { ...fichaVacia().postulante, nombres: "Sofía Valentina", dni: "78451236", estudio_en_colegio_peruano: true, tiene_condicion_especial: false },
    });
    const { e } = await abrir();

    expect((e.get("#p05n").element as HTMLInputElement).value).toBe("Sofía Valentina");
    expect((e.get("#p05d").element as HTMLInputElement).value).toBe("78451236");
    expect(e.findAll('input[name="p05proc"]').map((r) => (r.element as HTMLInputElement).checked)).toEqual([true, false]);
    expect(e.findAll('input[name="p05cond"]').map((r) => (r.element as HTMLInputElement).checked)).toEqual([false, true]);
    expect(estado(e)).toBe("Borrador guardado hace 2 minutos");
    expect(puts).toHaveLength(0); // abrir no guarda nada
  });

  it("HU0005-2.0 [parte: borrador] guarda el borrador solo 2 s después del último cambio, sin pulsar nada", async () => {
    const { e } = await abrir();
    vi.useFakeTimers();

    await e.get("#p05n").setValue("Sofía");
    await vi.advanceTimersByTimeAsync(1500);
    await e.get("#p05n").setValue("Sofía Valentina");
    await vi.advanceTimersByTimeAsync(1999);
    expect(puts).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);

    expect(puts).toHaveLength(1);
    expect(puts[0]).toMatchObject({ modo: "borrador", postulante: { nombres: "Sofía Valentina", estudio_en_colegio_peruano: null }, segundo_apoderado: null });
    expect(estado(e)).toBe("Borrador guardado hace unos segundos");
  });

  it("HU0005-2.0 [parte: borrador] al salir de la pantalla guarda lo que quedó sin guardar", async () => {
    const { e, enrutador } = await abrir();

    await e.get("#p05n").setValue("Sofía");
    expect(puts).toHaveLength(0);
    await enrutador.push("/portal");
    await esperar();

    expect(puts).toHaveLength(1);
    expect(puts[0]).toMatchObject({ modo: "borrador", postulante: { nombres: "Sofía" } });
    expect(enrutador.currentRoute.value.path).toBe("/portal");
  });

  it("HU0005-2.0 [parte: segundo apoderado parcial] el indicador avisa que el bloque no se guardó hasta tener los cinco datos", async () => {
    respuestaPut = () => ({
      status: 200,
      cuerpo: {
        ficha_completa: false,
        guardado_en: new Date().toISOString(),
        pendientes: [
          { campo: "segundo_apoderado.apellidos", codigo: "OBLIGATORIO" },
          { campo: "segundo_apoderado.telefono", codigo: "OBLIGATORIO" },
          { campo: "segundo_apoderado.correo", codigo: "OBLIGATORIO" },
          { campo: "segundo_apoderado.parentesco", codigo: "OBLIGATORIO" },
        ],
      },
    });
    const { e } = await abrir();
    await irAlPaso(e, 2);
    await e.get("#p05bs-nom").setValue("José Luis");

    await boton(e, "Guardar borrador").trigger("click");
    await esperar();

    expect(puts.at(-1)).toMatchObject({ segundo_apoderado: { nombres: "José Luis" } });
    expect(estado(e)).toBe(TEXTO_SEGUNDO_PARCIAL);
    expect(estado(e)).toBe("Guardado, excepto el segundo apoderado: completa nombres, apellidos, teléfono, correo y parentesco para guardarlo");

    // Con el bloque completo, la API ya no lo devuelve en pendientes y el indicador vuelve a «Borrador guardado…».
    respuestaPut = borradorGuardado;
    await boton(e, "Guardar borrador").trigger("click");
    await esperar();
    expect(estado(e)).toBe("Borrador guardado hace unos segundos");
  });
});

describe("HU0005-1.0 P05 guarda y continúa hasta completar la ficha", () => {
  const finalizar = async (e: VueWrapper) => {
    for (let n = 1; n <= 3; n++) {
      await boton(e, "Guardar y continuar").trigger("click");
      await esperar();
    }
    expect(pasoActivo(e)).toContain("Cuestionario de expectativas");
    await boton(e, "Guardar y continuar").trigger("click");
    await esperar();
  };

  it("HU0005-1.0 «Guardar y continuar» guarda el borrador y avanza hasta el paso 4, donde completa la ficha y muestra los documentos", async () => {
    respuestaPut = (cuerpo) =>
      cuerpo.modo === "completa"
        ? {
            status: 200,
            cuerpo: {
              ficha_completa: true,
              guardado_en: new Date().toISOString(),
              requisitos: [
                { id_requisito: 1, tipo_documento: "Partida de nacimiento", categoria: "postulante_y_padres", obligatorio: true, por_apoderado: false, id_apoderado: null, apoderado: null },
                { id_requisito: 4, tipo_documento: "Boletas de pago", categoria: "financiero", obligatorio: true, por_apoderado: true, id_apoderado: 9, apoderado: "María Fernanda Quispe Rojas" },
              ],
            },
          }
        : borradorGuardado();
    const { e } = await abrir();
    expect(e.get('[data-testid="menu-documentos"]').attributes("disabled")).toBeDefined(); // aún sin ficha completa

    await finalizar(e);

    expect(puts.map((p) => p.modo)).toEqual(["borrador", "borrador", "borrador", "completa"]);
    expect(e.get('[data-testid="paso-documentos"] h2').text()).toBe("Paso siguiente: Documentos");
    expect(e.findAll('[data-testid="lista-documentos"] li').map((li) => li.text())).toEqual([
      "Partida de nacimiento",
      "Boletas de pago — María Fernanda Quispe Rojas",
    ]);
    expect(e.get('[data-testid="menu-documentos"]').attributes("disabled")).toBeUndefined(); // habilitado
    expect(e.find('[data-testid="ficha-completa"]').exists()).toBe(true);
    expect(e.get("fieldset.sin-borde").attributes("disabled")).toBeDefined(); // solo lectura
    expect(e.findAll("button").some((b) => b.text() === "Guardar y continuar")).toBe(false);
  });

  it("HU0005-1.0 un error del servidor se marca en su campo, con el mensaje, y lleva al paso donde está", async () => {
    respuestaPut = (cuerpo) =>
      cuerpo.modo === "completa"
        ? {
            status: 409,
            cuerpo: { error: { codigo: "DNI_YA_REGISTRADO", mensaje: "Ese DNI ya figura en otra postulación", detalle: [{ campo: "postulante.dni", codigo: "DNI_YA_REGISTRADO" }] } },
          }
        : borradorGuardado();
    const { e } = await abrir();

    await finalizar(e);

    expect(pasoActivo(e)).toContain("Datos del postulante");
    expect(e.get("#p05d").attributes("aria-invalid")).toBe("true");
    expect(e.get("#p05d-error").text()).toBe("Este DNI ya figura en otra postulación. Si es un error, comunícate con Secretaría de Admisión.");
    expect(e.get('[data-testid="aviso"]').text()).toBe("Revisa los campos marcados para completar la ficha.");
    expect(e.find('[data-testid="paso-documentos"]').exists()).toBe(false);
    expect(e.get('[data-testid="menu-documentos"]').attributes("disabled")).toBeDefined();
  });

  it("HU0005-1.0 en un borrador solo se marcan los conflictos de DNI; lo que falta no se muestra como error", async () => {
    respuestaPut = () => ({
      status: 200,
      cuerpo: {
        ficha_completa: false,
        guardado_en: new Date().toISOString(),
        pendientes: [
          { campo: "postulante.apellido_paterno", codigo: "OBLIGATORIO" },
          { campo: "postulante.dni", codigo: "DNI_YA_REGISTRADO" },
        ],
      },
    });
    const { e } = await abrir();

    await boton(e, "Guardar borrador").trigger("click");
    await esperar();

    expect(e.find("#p05ap-error").exists()).toBe(false);
    expect(e.get("#p05d-error").text()).toContain("Este DNI ya figura en otra postulación");
  });
});
