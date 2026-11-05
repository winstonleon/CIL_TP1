// G03 · Detalle del expediente y validación documental (HU0008) con la API simulada en fetch y el enrutador real en
// /gestion/bandeja/7. Solo se prueba la lógica propia de la pantalla: secciones y estados, «Dar conformidad» solo con
// todo conforme, el panel de observación con el motivo obligatorio y su texto de ayuda, y el motivo anterior.
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory } from "vue-router";
import App from "../../App.vue";
import { usuarioActual } from "../../auth/oidc";
import { usuarioFalso } from "../../pruebas/ayudantes";
import { crearEnrutador } from "../../router";

vi.mock("../../auth/oidc", async (original) => ({
  ...(await original<typeof import("../../auth/oidc")>()),
  usuarioActual: vi.fn(),
  iniciarSesion: vi.fn(),
}));

const ID = 7;
const doc = (id: number, tipo: string, categoria: string, estado: string, extra: Record<string, unknown> = {}) => ({
  id_documento: id, id_requisito: id, tipo_documento: tipo, categoria, parentesco: null, formato: "pdf", tamano_kb: 820,
  fecha_carga: "2026-11-03T15:00:00.000Z", estado_verificacion: estado, motivo_observacion: null as string | null, motivo_anterior: null as string | null, ...extra,
});
const detalleBase = () => ({
  id_expediente: ID,
  codigo: "ADM-2027-0007",
  grado: "3.° de primaria",
  postulante: { nombres: "Sofía Valentina", apellidos: "Quispe Rojas" },
  apoderado: { nombres: "María Fernanda", apellidos: "Quispe Rojas", telefono: "+51987654321" },
  ramas: { documental: "pendiente", financiera: "observado", derecho: "conforme" },
  agendamiento_habilitado: false,
  documentos: [
    doc(11, "Partida de nacimiento", "postulante_y_padres", "conforme"),
    doc(12, "DNI del padre", "postulante_y_padres", "pendiente"),
    doc(13, "Libreta de notas", "colegio_procedencia", "pendiente"),
  ],
});

let detalle: ReturnType<typeof detalleBase>;
let decisiones: { url: string; cuerpo: unknown }[];
let respuestaDecision: () => { status: number; cuerpo: unknown };

const responder = (status: number, cuerpo: unknown) => ({ ok: status < 400, status, json: async () => cuerpo }) as Response;

function apiFalsa(url: string, init: RequestInit = {}): Response {
  const metodo = init.method ?? "GET";
  if (url === "/api/campana-activa") return responder(200, { campana: "2027" });
  if (url === `/api/bandeja/expedientes/${ID}` && metodo === "GET") return responder(200, detalle);
  if (url.startsWith(`/api/bandeja/expedientes/${ID}/`) && metodo === "POST") {
    decisiones.push({ url, cuerpo: JSON.parse(String(init.body)) });
    const r = respuestaDecision();
    return responder(r.status, r.cuerpo);
  }
  return responder(404, { error: { codigo: "NO_ENCONTRADO", mensaje: "Recurso no encontrado" } });
}

const montados: VueWrapper[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  detalle = detalleBase();
  decisiones = [];
  respuestaDecision = () => ({ status: 200, cuerpo: { rama: "conforme", agendamiento_habilitado: false } });
  vi.stubEnv("VITE_API_URL", "/api");
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => apiFalsa(url, init)));
  vi.mocked(usuarioActual).mockResolvedValue(usuarioFalso(["secretaria"], "Rosa Medina"));
});

afterEach(() => {
  for (const m of montados.splice(0)) m.unmount();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function esperar() {
  for (let i = 0; i < 8; i++) await flushPromises();
}

async function abrir() {
  const enrutador = crearEnrutador(createMemoryHistory());
  const e = mount(App, { global: { plugins: [createPinia(), enrutador] }, attachTo: document.body });
  montados.push(e);
  await enrutador.push(`/gestion/bandeja/${ID}`);
  await esperar();
  return e;
}

const fila = (e: VueWrapper, id: number) => e.get(`[data-testid="documento-${id}"]`);
const boton = (w: { findAll: VueWrapper["findAll"] }, texto: string) => w.findAll("button").find((b) => b.text() === texto);

describe("HU0008-1.0 G03 conformidad documental", () => {
  it("HU0008-1.0 G03 muestra el expediente, las tres ramas y los documentos por sección, con la nota de acceso restringido", async () => {
    const e = await abrir();

    expect(e.get("h1.postulante").text()).toBe("Sofía Valentina Quispe Rojas");
    expect(e.text()).toContain("ADM-2027-0007 · 3.° de primaria · Apoderado(a): María Fernanda Quispe Rojas · 987 654 321");
    expect(e.get('[data-testid="chips-ramas"]').findAll(".chip").map((c) => c.text())).toEqual([
      "Documentos: en revisión",
      "Derecho de admisión: validado",
      "Doc. financiera: observada",
    ]);
    expect(e.get('[data-testid="seccion-postulante_y_padres"] h2').text()).toBe("Documentos del postulante y los padres");
    expect(e.get('[data-testid="seccion-colegio_procedencia"] h2').text()).toBe("Colegio de procedencia");
    expect(fila(e, 11).get(".chip").text()).toBe("Conforme");
    expect(fila(e, 12).get(".chip").text()).toBe("Por revisar");
    // Un documento conforme ya no ofrece decidir; uno por revisar sí.
    expect(boton(fila(e, 11), "Conforme")).toBeUndefined();
    expect(boton(fila(e, 12), "Observar")).toBeDefined();
    expect(e.get('[data-testid="nota-restringida"]').text()).toContain("La documentación financiera y el informe psicopedagógico no se muestran a Secretaría");
  });

  it("HU0008-1.0 «Dar conformidad al expediente» se habilita solo con todos los documentos conformes y registra la validación", async () => {
    const e = await abrir();
    expect(e.get('[data-testid="dar-conformidad"]').attributes("disabled")).toBeDefined();

    // Marca un documento conforme; la API devuelve el detalle con todo conforme.
    respuestaDecision = () => ({ status: 200, cuerpo: {} });
    detalle = { ...detalleBase(), documentos: detalleBase().documentos.map((d) => ({ ...d, estado_verificacion: "conforme" })) };
    await boton(fila(e, 12), "Conforme")!.trigger("click");
    await esperar();
    expect(decisiones.at(-1)).toEqual({ url: `/api/bandeja/expedientes/${ID}/documentos/12/decision`, cuerpo: { decision: "conforme" } });
    expect(e.get('[data-testid="dar-conformidad"]').attributes("disabled")).toBeUndefined();

    respuestaDecision = () => ({ status: 200, cuerpo: { rama: "conforme", agendamiento_habilitado: true } });
    detalle = { ...detalle, ramas: { documental: "conforme", financiera: "conforme", derecho: "conforme" }, agendamiento_habilitado: true };
    await e.get('[data-testid="dar-conformidad"]').trigger("click");
    await esperar();

    expect(decisiones.at(-1)).toEqual({ url: `/api/bandeja/expedientes/${ID}/validacion-documental`, cuerpo: {} });
    expect(e.get('[data-testid="aviso"]').text()).toContain("el agendamiento de evaluaciones quedó habilitado");
    expect(e.find('[data-testid="dar-conformidad"]').exists()).toBe(false);
    expect(e.find('[data-testid="agendamiento-habilitado"]').exists()).toBe(true);
  });

  it("HU0008-1.0 (dos personas) si otra persona ya revisó el documento, muestra el aviso de la API y recarga el detalle", async () => {
    const e = await abrir();
    respuestaDecision = () => ({ status: 409, cuerpo: { error: { codigo: "DOCUMENTO_YA_REVISADO", mensaje: "Otra persona ya revisó este documento; vuelve a cargar el expediente" } } });
    detalle = { ...detalleBase(), documentos: detalleBase().documentos.map((d) => (d.id_documento === 12 ? { ...d, estado_verificacion: "observado", motivo_observacion: "Borrosa." } : d)) };

    await boton(fila(e, 12), "Conforme")!.trigger("click");
    await esperar();

    expect(e.get('[data-testid="error-accion"]').text()).toBe("Otra persona ya revisó este documento; vuelve a cargar el expediente");
    expect(fila(e, 12).get(".chip").text()).toBe("Observado");
  });
});

describe("HU0008-1.0 G03 pestañas", () => {
  it("HU0008-1.0 G03 las pestañas sin HU en este bloque se ven deshabilitadas, con aria-disabled y su title, y no navegan ni piden nada", async () => {
    const e = await abrir();
    const pestanas = e.findAll('[role="tab"]');
    expect(pestanas.map((p) => p.text())).toEqual(["Documentos", "Ficha y cuestionario", "Pagos", "Citas", "Historial"]);
    expect(pestanas[0]!.attributes("aria-selected")).toBe("true");
    expect(pestanas[0]!.attributes("aria-disabled")).toBeUndefined();
    const llamadas = vi.mocked(fetch).mock.calls.length;
    for (const p of pestanas.slice(1)) {
      expect(p.attributes("aria-disabled")).toBe("true");
      expect(p.attributes("title")).toBe("Disponible en una HU posterior");
      expect(p.classes()).toContain("deshabilitada");
      await p.trigger("click");
    }
    await esperar();
    expect(vi.mocked(fetch).mock.calls.length).toBe(llamadas);
    expect(pestanas[0]!.attributes("aria-selected")).toBe("true");
    expect(e.find('[data-testid="documento-12"]').exists()).toBe(true);
  });
});

describe("HU0008-2.0 G03 observación de un documento", () => {
  it("HU0008-2.0 [parte: correo] «Observar» abre el panel con el texto de ayuda; sin motivo no envía y con motivo «Solicitar subsanación» lo envía", async () => {
    const e = await abrir();
    await boton(fila(e, 12), "Observar")!.trigger("click");
    await esperar();

    const panel = e.get('[data-testid="panel-observacion"]');
    expect(panel.get("h2").text()).toBe("Observar documento");
    expect(panel.text()).toContain("DNI del padre");
    expect(panel.get('[data-testid="ayuda-motivo"]').text()).toBe("Describe el problema del documento; no copies su contenido");
    expect(panel.get("textarea").attributes("aria-describedby")).toBe(panel.get('[data-testid="ayuda-motivo"]').attributes("id"));

    await boton(panel, "Solicitar subsanación")!.trigger("click");
    await esperar();
    expect(decisiones).toEqual([]);
    expect(panel.get('[data-testid="ayuda-motivo"]').text()).toBe("Escribe el motivo de la observación.");

    respuestaDecision = () => ({ status: 200, cuerpo: {} });
    await panel.get("textarea").setValue("La imagen está borrosa y no se lee el número de DNI.");
    await boton(panel, "Solicitar subsanación")!.trigger("click");
    await esperar();

    expect(decisiones).toEqual([
      { url: `/api/bandeja/expedientes/${ID}/documentos/12/decision`, cuerpo: { decision: "observado", motivo: "La imagen está borrosa y no se lee el número de DNI." } },
    ]);
    expect(e.find('[data-testid="panel-observacion"]').exists()).toBe(false);
    expect(e.get('[data-testid="aviso"]').text()).toBe("Se solicitó la subsanación. La familia recibirá un correo con el motivo.");
  });

  it("HU0008-2.0 [parte: correo] (subsanación) un documento que volvió a revisión muestra su motivo como «Motivo anterior», no como observación vigente", async () => {
    detalle.documentos = [
      doc(14, "DNI del padre", "postulante_y_padres", "pendiente", { motivo_anterior: "La imagen está borrosa." }),
      doc(15, "Libreta de notas", "colegio_procedencia", "observado", { motivo_observacion: "Falta la segunda página." }),
    ];
    const e = await abrir();

    expect(fila(e, 14).get('[data-testid="motivo-anterior"]').text()).toBe("Motivo anterior: La imagen está borrosa.");
    expect(fila(e, 14).find('[data-testid="motivo-vigente"]').exists()).toBe(false);
    expect(fila(e, 14).get(".chip").text()).toBe("Por revisar");
    expect(fila(e, 15).get('[data-testid="motivo-vigente"]').text()).toBe("Motivo: Falta la segunda página.");
    expect(fila(e, 15).find('[data-testid="motivo-anterior"]').exists()).toBe(false);
  });
});
