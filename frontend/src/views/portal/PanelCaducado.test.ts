// P04 con la postulación caducada (HU0018-2.0, C78, D4-A) con la API simulada en fetch. Se monta la app con el enrutador real
// en /portal/panel. La regla la aplica la API (api/test/seguimiento.test.ts): la pantalla solo muestra el aviso, las etapas
// tal como quedaron y ninguna acción.
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

const ID = 77;
const resumen = { id_expediente: ID, codigo: "ADM-2027-0077", estado: "caducado", grado: "3.° de primaria", postulante: "Sofía Quispe Rojas", ficha_completa: true };
const etapas = ["ficha", "documentos", "pagos", "evaluaciones", "resultado", "carta"].map((clave, i) => ({
  clave,
  titulo: ["Ficha y cuestionario", "Documentos", "Pagos y doc. financiera", "Evaluaciones", "Resultado", "Cuota y carta"][i],
  estado: ["completado", "observado", "en_revision", "pendiente", "pendiente", "pendiente"][i],
}));
const panelCaducado = {
  etapas,
  validaciones: { documental: "observado", financiera: "en_revision", derecho: "conforme" },
  acciones: [],
  historial: [{ fecha: "2026-11-20T13:00:00.000Z", texto: "Tu postulación caducó por vencimiento del plazo" }],
  carta: { disponible: false, fecha_emision: null },
  caducidad: { fecha: "2026-11-20T13:00:00.000Z", accion: "subsanar las observaciones de tu expediente" },
};
let panel: Record<string, unknown>;
const responder = (status: number, cuerpo: unknown) => ({ ok: status < 400, status, json: async () => cuerpo }) as Response;

const montados: VueWrapper[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  panel = panelCaducado;
  vi.stubEnv("VITE_API_URL", "/api");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "/api/familia/expedientes") return responder(200, [resumen]);
      if (url === `/api/familia/expedientes/${ID}/panel`) return responder(200, panel);
      return responder(404, { error: { codigo: "NO_ENCONTRADO", mensaje: "Recurso no encontrado" } });
    }),
  );
  vi.mocked(usuarioActual).mockResolvedValue(usuarioFalso(["familia"], "María Fernanda Quispe Rojas"));
});

afterEach(() => {
  for (const m of montados.splice(0)) m.unmount();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function abrir() {
  const enrutador = crearEnrutador(createMemoryHistory());
  const w = mount(App, { global: { plugins: [createPinia(), enrutador] } });
  montados.push(w);
  await enrutador.push("/portal/panel");
  for (let i = 0; i < 8; i++) await flushPromises();
  return w;
}

describe("HU0018-2.0 P04 con la postulación caducada (C78)", () => {
  it("HU0018-2.0 (C78) P04 dice que la postulación caducó, cuándo y qué venció, con el contacto de Secretaría, sin acciones ni «Subsanar»", async () => {
    const w = await abrir();

    const aviso = w.get('[data-testid="caducidad"]');
    expect(aviso.attributes("role")).toBe("alert");
    expect(aviso.text()).toContain("Tu postulación caducó el 20/11/2026.");
    expect(aviso.text()).toContain("Venció el plazo para subsanar las observaciones de tu expediente. Comunícate con Secretaría de Admisión · [Teléfono y correo de admisión]");
    expect(w.findAll('[data-testid="accion"]')).toHaveLength(0);
    expect(w.findAll('[data-testid="ir-accion"]')).toHaveLength(0);
    expect(w.find('[data-testid="sin-acciones"]').exists()).toBe(false);
    expect(w.get('[data-testid="historial"]').text()).toContain("Tu postulación caducó por vencimiento del plazo");
  });

  it("HU0018-2.0 (C78) las etapas se muestran como quedaron al caducar", async () => {
    const w = await abrir();
    expect(w.findAll('[data-testid="estado-etapa"]').map((x) => x.text())).toEqual(["Completado", "Observado", "En revisión", "Pendiente", "Pendiente", "Pendiente"]);
  });

  it("HU0018-2.0 (C78) sin caducidad no se muestra el aviso", async () => {
    panel = { ...panelCaducado, caducidad: null, acciones: [{ tipo: "completar", titulo: "Agenda tus evaluaciones", destino: "/portal/evaluaciones" }] };
    const w = await abrir();
    expect(w.find('[data-testid="caducidad"]').exists()).toBe(false);
    expect(w.findAll('[data-testid="accion"]')).toHaveLength(1);
  });
});
