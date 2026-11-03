// G04 · Agenda de visitas y registro de la asistencia (HU0004-1.0, HU0004-2.0 y A5) con la API simulada en fetch. Se
// monta la app en /gestion/visitas?fecha=… con una secretaria: así se prueban la ruta, el token y la pantalla completa
// (la sección de HU0002-2.0 tiene sus propias pruebas). Los textos esperados son los del mockup G04 y los de S2.
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
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

type Visita = Record<string, any>;
const visita = (id_cita: number, fecha: string, hora_inicio: string, estado_cita: string, nombres: string, apellidos: string, extra: Visita = {}): Visita => ({
  id_cita,
  fecha,
  hora_inicio,
  estado_cita,
  id_expediente: 100 + id_cita,
  estado_expediente: "visita_agendada",
  apoderado: { nombres, apellidos, telefono: "+51987654321" },
  grado: { nombre_grado: "3.° de primaria" },
  asistentes: `${nombres} ${apellidos}`,
  aviso: null,
  ...extra,
});

let visitas: Visita[];
let sinRegistrar: Visita[];
let respuestaAsistencia: { status: number; cuerpo: unknown };
let llamadas: { url: string; metodo: string; token: string | null; cuerpo?: unknown }[];

const responder = (status: number, cuerpo: unknown) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { "Content-Type": "application/json" } });

function apiFalsa(url: string, init: RequestInit = {}): Response {
  const metodo = init.method ?? "GET";
  llamadas.push({ url, metodo, token: new Headers(init.headers).get("Authorization"), cuerpo: init.body ? JSON.parse(String(init.body)) : undefined });
  if (url === "/api/campana-activa") return responder(200, { campana: "2027" });
  if (url === "/api/prospectos/contacto-no-entregado") return responder(200, { prospectos: [] });
  if (url === "/api/visitas?fecha=2026-10-15") {
    return responder(200, { desde: "2026-10-12", hasta: "2026-10-18", visitas, sin_registrar: sinRegistrar });
  }
  const asistencia = /^\/api\/visitas\/(\d+)\/asistencia$/.exec(url);
  if (asistencia && metodo === "POST") {
    if (respuestaAsistencia.status === 200) {
      const id = Number(asistencia[1]);
      const resultado = (JSON.parse(String(init.body)) as { resultado: string }).resultado;
      const cambio = resultado === "no_asistio" ? { estado_cita: "no_asistio", estado_expediente: "prospecto" } : { estado_cita: "asistio", estado_expediente: "portal_habilitado" };
      visitas = visitas.map((v) => (v.id_cita === id ? { ...v, ...cambio } : v));
      sinRegistrar = sinRegistrar.filter((v) => v.id_cita !== id);
    }
    return responder(respuestaAsistencia.status, respuestaAsistencia.cuerpo);
  }
  return responder(404, { error: { codigo: "NO_ENCONTRADO", mensaje: "Recurso no encontrado" } });
}

const montados: VueWrapper[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  visitas = [
    visita(1, "2026-10-15", "08:30", "asistio", "Patricia", "Gómez Ruiz", { estado_expediente: "portal_habilitado" }),
    visita(2, "2026-10-15", "10:00", "reservada", "María Fernanda", "Quispe Rojas", { asistentes: "María Fernanda Quispe Rojas, José Luis Quispe Huamán" }),
    visita(3, "2026-10-15", "11:30", "no_asistio", "Elena", "Castro Mejía", { estado_expediente: "prospecto", aviso: { tipo_evento: "visita_reprogramacion", estado_envio: "enviado" } }),
    visita(4, "2026-10-13", "09:00", "reservada", "Ricardo", "Núñez Olivos"),
  ];
  sinRegistrar = [visita(5, "2026-10-02", "10:00", "reservada", "Jorge", "Paredes Linares")];
  respuestaAsistencia = { status: 200, cuerpo: {} };
  llamadas = [];
  vi.stubEnv("VITE_API_URL", "/api");
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => apiFalsa(url, init)));
  vi.mocked(usuarioActual).mockResolvedValue(usuarioFalso(["secretaria"], "Rosa Medina"));
});

afterEach(() => {
  for (const m of montados.splice(0)) m.unmount();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function abrir() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const enrutador = crearEnrutador(createMemoryHistory());
  const e = mount(App, { global: { plugins: [pinia, enrutador] } });
  montados.push(e);
  await enrutador.push("/gestion/visitas?fecha=2026-10-15");
  await flushPromises();
  return e;
}

const fila = (e: VueWrapper, id: number) => e.get(`[data-testid="visita-${id}"]`);
const celdas = (e: VueWrapper, id: number) => fila(e, id).findAll("td").map((td) => td.text());
const posts = () => llamadas.filter((l) => l.metodo === "POST");

describe("HU0004 G04 registro de la asistencia a la visita guiada", () => {
  it("HU0004-1.0 G04 «Asistió» abre «Registrar visita» y «Registrar y habilitar portal» envía asistio_interesado", async () => {
    const e = await abrir();

    // Franja de lunes a viernes con el conteo del mockup; el día de ?fecha= queda elegido.
    expect(e.findAll(".franja button.dia").map((b) => b.findAll("span").map((s) => s.text()))).toEqual([
      ["Lun", "12", "0 visitas"],
      ["Mar", "13", "1 visita"],
      ["Mié", "14", "0 visitas"],
      ["Jue", "15", "3 visitas"],
      ["Vie", "16", "0 visitas"],
    ]);
    expect(e.get('[data-testid="dia-2026-10-15"]').attributes("aria-pressed")).toBe("true");
    expect(e.get("#g04-dia-titulo").text()).toBe("Jueves 15 de octubre de 2026");
    expect(e.text()).toContain("Conduce: Dirección");

    // Filas del día con las columnas del mockup y las etiquetas de S2.
    expect(e.findAll("table[aria-labelledby='g04-dia-titulo'] thead th").map((th) => th.text())).toEqual(["Hora", "Familia", "Teléfono", "Asistencia", "Acción"]);
    expect(celdas(e, 1)).toEqual(["8:30 a. m.", "Patricia Gómez RuizInterés: 3.° de primariaAsistentes: Patricia Gómez Ruiz", "987 654 321", "Asistió", "Portal habilitado"]);
    expect(celdas(e, 2)[3]).toBe("Por registrar");
    expect(fila(e, 2).findAll("button").map((b) => b.text())).toEqual(["Asistió", "No asistió"]);
    expect(celdas(e, 3).slice(3)).toEqual(["No asistió", "Invitación a reprogramar enviada"]);
    expect(e.find('[data-testid="visita-4"]').exists()).toBe(false); // es de otro día
    expect(e.find('[data-testid="registrar-visita"]').exists()).toBe(false);

    await fila(e, 2).findAll("button")[0]!.trigger("click");

    const panel = e.get('[data-testid="registrar-visita"]');
    expect(panel.get("h2").text()).toBe("Registrar visita");
    expect(panel.text()).toContain("María Fernanda Quispe Rojas");
    expect(panel.text()).toContain("10:00 a. m. · 3.° de primaria");
    expect(panel.get("legend").text()).toBe("¿La familia desea postular?");
    // Solo «Sí, desea postular»: «No desea postular por ahora» no tiene escenario (B3, C38).
    expect(panel.findAll("input[type='radio']")).toHaveLength(1);
    expect(panel.get("label.opcion").text()).toBe("Sí, desea postular");
    expect(panel.text()).not.toContain("No desea postular");
    expect(panel.text()).toContain("El sistema crea la cuenta de la familia y le envía las credenciales temporales por correo.");
    expect(fila(e, 2).classes()).toContain("resaltada");
    expect(posts()).toHaveLength(0);

    // Un 409 (C28) se muestra en el panel y no cambia nada.
    respuestaAsistencia = { status: 409, cuerpo: { error: { codigo: "CORREO_CON_CUENTA", mensaje: "El correo de la familia ya tiene una cuenta; no se registró la asistencia" } } };
    await panel.get("button.boton-principal").trigger("click");
    await flushPromises();
    expect(e.get('[data-testid="registrar-visita"] [role="alert"]').text()).toBe("El correo de la familia ya tiene una cuenta; no se registró la asistencia");
    expect(celdas(e, 2)[3]).toBe("Por registrar");

    respuestaAsistencia = { status: 200, cuerpo: {} };
    await e.get('[data-testid="registrar-visita"] button.boton-principal').trigger("click");
    await flushPromises();

    expect(posts().map((p) => [p.url, p.cuerpo])).toEqual([
      ["/api/visitas/2/asistencia", { resultado: "asistio_interesado" }],
      ["/api/visitas/2/asistencia", { resultado: "asistio_interesado" }],
    ]);
    expect(posts().every((p) => p.token?.startsWith("Bearer "))).toBe(true);
    expect(e.find('[data-testid="registrar-visita"]').exists()).toBe(false);
    expect(celdas(e, 2).slice(3)).toEqual(["Asistió", "Portal habilitado"]);
  });

  it("HU0004-2.0 G04 «No asistió» envía no_asistio y la fila muestra «No asistió»", async () => {
    const e = await abrir();

    await fila(e, 2).findAll("button")[1]!.trigger("click");
    await flushPromises();

    expect(posts().map((p) => [p.url, p.cuerpo])).toEqual([["/api/visitas/2/asistencia", { resultado: "no_asistio" }]]);
    expect(celdas(e, 2).slice(3)).toEqual(["No asistió", "Invitación a reprogramar pendiente"]);
    expect(fila(e, 2).findAll("button")).toHaveLength(0);
    // Las etiquetas de S2 según el envío de la invitación.
    visitas = visitas.map((v) => (v.id_cita === 2 ? { ...v, aviso: { tipo_evento: "visita_reprogramacion", estado_envio: "fallido" } } : v));
    const otra = await abrir();
    expect(celdas(otra, 2)[4]).toBe("Invitación a reprogramar no entregada");
  });

  it("HU0004-1.0 (P-c) G04 muestra la sección «Sin registrar» con esas visitas y sus acciones", async () => {
    const e = await abrir();

    expect(e.get("#g04-sin-registrar").text()).toBe("Sin registrar");
    const tabla = e.get("table[aria-labelledby='g04-sin-registrar']");
    expect(tabla.findAll("tbody tr").map((tr) => tr.attributes("data-testid"))).toEqual(["visita-5"]);
    expect(celdas(e, 5)[0]).toBe("02/10/2026 · 10:00 a. m.");
    expect(celdas(e, 5)[3]).toBe("Por registrar");

    await fila(e, 5).findAll("button")[1]!.trigger("click");
    await flushPromises();

    expect(posts().map((p) => [p.url, p.cuerpo])).toEqual([["/api/visitas/5/asistencia", { resultado: "no_asistio" }]]);
    expect(e.find("#g04-sin-registrar").exists()).toBe(false); // ya no quedan visitas sin registrar
    // Sin visitas pendientes de semanas anteriores, la sección no aparece.
    sinRegistrar = [];
    const sin = await abrir();
    expect(sin.find("#g04-sin-registrar").exists()).toBe(false);
  });
});
