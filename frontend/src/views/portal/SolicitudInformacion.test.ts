// P01 · Solicitud de información y consentimiento (HU0001-1.0, 2.0 y 3.0) con la API simulada en fetch. Se monta la
// aplicación con su router real, así se prueba también que la ruta es pública (no inicia sesión ni envía token) y el
// cliente real (llamarApiPublica + api/solicitud): método, ruta, cuerpo y cabeceras. Se monta en document.body para
// poder verificar el foco. Las pruebas «P01 …» son de soporte (ADR-17 y los estados del plan, S1 y S3).
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory } from "vue-router";
import App from "../../App.vue";
import { iniciarSesion, usuarioActual } from "../../auth/oidc";
import { crearEnrutador } from "../../router";

vi.mock("../../auth/oidc", async (original) => ({
  ...(await original<typeof import("../../auth/oidc")>()),
  usuarioActual: vi.fn(),
  iniciarSesion: vi.fn(),
}));

const RUTA_API = "/api/publico/solicitud-informacion";
const FORMULARIO = {
  campana: "2027",
  politica: { version: "borrador-1", texto: "[Texto de la Política de privacidad del CIL: por definir con el colegio]" },
  grados: [
    { id_grado: 1, nivel: "inicial", nombre_grado: "3 años" },
    { id_grado: 6, nivel: "primaria", nombre_grado: "3.° de primaria" },
    { id_grado: 10, nivel: "secundaria", nombre_grado: "1.° de secundaria" },
  ],
};
const MENSAJE_TELEFONO = "Ingresa un celular válido: 9 dígitos que empiecen con 9, o el número internacional con +código de país.";
const CONFIRMACION =
  "Solicitud registrada. Te enviaremos la carpeta informativa al correo que indicaste, con el enlace para agendar tu visita guiada.";

interface Llamada {
  metodo: string;
  url: string;
  cabeceras: Headers;
  credenciales?: RequestCredentials;
  cuerpo?: Record<string, unknown>;
}

let llamadas: Llamada[];
let respuestaGet: () => Response;
let respuestaPost: () => Response;
let montados: VueWrapper[];

const responder = (status: number, cuerpo: unknown) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { "Content-Type": "application/json" } });

// API simulada de /publico/solicitud-informacion con el formato de la API real.
function apiFalsa(url: string, init: RequestInit = {}): Response {
  const metodo = init.method ?? "GET";
  const cuerpo = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
  llamadas.push({ metodo, url, cabeceras: new Headers(init.headers), credenciales: init.credentials, cuerpo });
  if (url !== RUTA_API) return responder(404, { error: { codigo: "NO_ENCONTRADO", mensaje: "Recurso no encontrado" } });
  return metodo === "GET" ? respuestaGet() : respuestaPost();
}

beforeEach(() => {
  vi.clearAllMocks();
  llamadas = [];
  montados = [];
  respuestaGet = () => responder(200, FORMULARIO);
  respuestaPost = () => responder(201, { estado: "registrada" });
  vi.stubEnv("VITE_API_URL", "/api");
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => apiFalsa(url, init)));
});

afterEach(() => {
  for (const m of montados) m.unmount();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function montar(ruta = "/solicitud-informacion?origen=facebook") {
  const enrutador = crearEnrutador(createMemoryHistory());
  const envoltorio = mount(App, { global: { plugins: [createPinia(), enrutador] }, attachTo: document.body });
  montados.push(envoltorio);
  await enrutador.push(ruta);
  await flushPromises();
  return envoltorio;
}

const VALIDOS = {
  nombres: "Nombre Ficticio",
  apellidos: "Apellido Prueba",
  telefono: "987 654 321",
  correo: "familia.prueba@ejemplo.test",
  grado: "6",
};

async function completar(e: VueWrapper, datos: Partial<typeof VALIDOS> = VALIDOS) {
  const campos: [string, string | undefined][] = [
    ["#p01n", datos.nombres],
    ["#p01a", datos.apellidos],
    ["#p01t", datos.telefono],
    ["#p01c", datos.correo],
    ["#p01g", datos.grado],
  ];
  for (const [selector, valor] of campos) if (valor !== undefined) await e.get(selector).setValue(valor);
}

const aceptarPolitica = (e: VueWrapper) => e.get("#p01ok").setValue(true);

async function enviar(e: VueWrapper) {
  await e.get("form").trigger("submit");
  await flushPromises();
}

const posts = () => llamadas.filter((l) => l.metodo === "POST");
const marcada = (e: VueWrapper, id: string) => (e.get(`#${id}`).element as HTMLInputElement).checked;
const IDS_CAMPOS = ["p01n", "p01a", "p01t", "p01c", "p01g"];

// ---------------------------------------------------------------- HU0001-1.0

describe("HU0001-1.0 solicitud de información con consentimiento", () => {
  it("HU0001-1.0 P01 se abre sin iniciar sesión, pide el formulario a la API sin token y muestra la campaña y los textos del mockup", async () => {
    const e = await montar();

    expect(usuarioActual).not.toHaveBeenCalled();
    expect(iniciarSesion).not.toHaveBeenCalled();
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0]).toMatchObject({ metodo: "GET", url: RUTA_API, credenciales: "omit" });
    expect(llamadas[0]!.cabeceras.has("Authorization")).toBe(false);

    // Encabezado y panel azul (la campaña sale de la API).
    expect(e.get('[data-testid="proceso"]').text()).toBe("Proceso de Admisión 2027");
    expect(e.get(".boton-portal").text()).toBe("Portal de postulación");
    expect(e.get(".boton-portal").attributes("href")).toBe("/portal");
    expect(e.get('[data-testid="campana-panel"]').text()).toBe("Admisión 2027");
    expect(e.get("h1").text()).toBe("Postula al Colegio Internacional de Lima");
    expect(e.get(".panel-intro p").text()).toBe(
      "Déjanos tus datos y te enviaremos la carpeta informativa por correo (y por WhatsApp, si lo autorizas), con el enlace para agendar tu visita.",
    );
    expect(e.findAll(".nivel-nombre").map((n) => n.text())).toEqual(["Inicial", "Primaria", "Secundaria"]);
    expect(e.findAll(".nivel-detalle").map((n) => n.text())).toEqual(["3 y 4 años, y Kindergarten (5 años)", "1.° a 6.° grado", "1.° a 5.° grado"]);
    expect(e.findAll(".pasos li").map((p) => p.findAll("span")[1]!.text())).toEqual([
      "Solicita información y recibe la carpeta informativa",
      "Agenda tu visita guiada al colegio",
      "Completa tu postulación en línea",
    ]);

    // Tarjeta del formulario: etiquetas exactas del mockup.
    expect(e.get("#p01-titulo").text()).toBe("Solicita información");
    expect(e.get(".nota-obligatorios").text()).toBe("Los campos marcados con * son obligatorios.");
    const etiqueta = (id: string) => e.get(`label[for="${id}"]`).text();
    expect(etiqueta("p01n")).toBe("Nombres del apoderado *");
    expect(etiqueta("p01a")).toBe("Apellidos del apoderado *");
    expect(etiqueta("p01t")).toBe("Teléfono celular *");
    expect(etiqueta("p01c")).toBe("Correo electrónico *");
    expect(etiqueta("p01g")).toBe("Nivel y grado de interés *");
    expect(etiqueta("p01wa")).toBe("Autorizo que me contacten por WhatsApp. (Opcional)");
    expect(etiqueta("p01ok")).toBe(
      "Autorizo al Colegio Internacional de Lima a tratar mis datos personales y los del menor para fines del proceso de admisión, conforme a la Ley N.° 29733. He leído la Política de privacidad. *",
    );
    expect(e.get("a.enlace-politica").text()).toBe("Política de privacidad");
    expect(e.get('button[type="submit"]').text()).toBe("Solicitar información");
    expect(e.get(".nota-consentimiento").text()).toBe("Sin el consentimiento no se almacena ningún dato.");

    // Grados de la campaña activa como «Nivel · grado», con una opción inicial vacía.
    expect(e.findAll("#p01g option").map((o) => o.text())).toEqual([
      "",
      "Inicial · 3 años",
      "Primaria · 3.° de primaria",
      "Secundaria · 1.° de secundaria",
    ]);
  });

  it("HU0001-1.0 envía los datos normalizados, el canal de ?origen= y el campo trampa vacío, sin token, y muestra la confirmación", async () => {
    const e = await montar("/solicitud-informacion?origen=facebook");
    await completar(e, { ...VALIDOS, nombres: "  Nombre Ficticio ", correo: " familia.prueba@ejemplo.test " });
    await e.get("#p01wa").setValue(true);
    await aceptarPolitica(e);
    await enviar(e);

    expect(posts()).toHaveLength(1);
    const [post] = posts();
    expect(post!.url).toBe(RUTA_API);
    expect(post!.cuerpo).toEqual({
      nombres: "Nombre Ficticio",
      apellidos: "Apellido Prueba",
      telefono: "+51987654321",
      correo: "familia.prueba@ejemplo.test",
      id_grado: 6,
      autoriza_whatsapp: true,
      acepta_politica: true,
      canal_origen: "facebook",
      comentario: "",
    });
    expect(post!.cabeceras.has("Authorization")).toBe(false);
    expect(post!.credenciales).toBe("omit");

    // La confirmación reemplaza al formulario y recibe el foco.
    const confirmacion = e.get('[role="status"]');
    expect(confirmacion.text()).toBe(CONFIRMACION);
    expect(e.find("form").exists()).toBe(false);
    expect(document.activeElement).toBe(confirmacion.element);
  });

  it("HU0001-1.0 el canal de origen es facebook o instagram según ?origen=, sin distinguir mayúsculas, y formulario_web en cualquier otro caso", async () => {
    const casos: [string, string][] = [
      ["/solicitud-informacion?origen=instagram", "instagram"],
      ["/solicitud-informacion?origen=Facebook", "facebook"],
      ["/solicitud-informacion?origen=INSTAGRAM", "instagram"],
      ["/solicitud-informacion?origen=facebook&origen=instagram", "facebook"],
      ["/solicitud-informacion?origen=tiktok", "formulario_web"],
      ["/solicitud-informacion?origen=TikTok", "formulario_web"],
      ["/solicitud-informacion", "formulario_web"],
    ];
    for (const [ruta, canal] of casos) {
      llamadas = [];
      const e = await montar(ruta);
      await completar(e);
      await aceptarPolitica(e);
      await enviar(e);
      expect(posts()[0]!.cuerpo!.canal_origen, ruta).toBe(canal);
      expect(posts()[0]!.cuerpo!.autoriza_whatsapp, ruta).toBe(false); // casilla de WhatsApp sin marcar
      e.unmount();
      montados = montados.filter((m) => m !== e);
    }
  });
});

// ---------------------------------------------------------------- HU0001-2.0

// El color del estado «observado» de los prototipos (#8A4B08) no se puede comprobar en jsdom, que no aplica CSS: lo
// verifica el E2E (e2e/solicitud-informacion.spec.ts). Aquí se comprueban aria-invalid, los mensajes y el foco.
describe("HU0001-2.0 datos obligatorios incompletos o con formato inválido", () => {
  it("HU0001-2.0 resalta los campos obligatorios vacíos con su mensaje, lleva el foco al primero y no llama a la API", async () => {
    const e = await montar();
    await enviar(e);

    expect(posts()).toHaveLength(0);
    const esperados: [string, string][] = [
      ["p01n", "Este campo es obligatorio."],
      ["p01a", "Este campo es obligatorio."],
      ["p01t", "Este campo es obligatorio."],
      ["p01c", "Este campo es obligatorio."],
      ["p01g", "Selecciona el nivel y grado de interés."],
      ["p01ok", "El consentimiento es obligatorio para continuar."],
    ];
    for (const [id, mensaje] of esperados) {
      const campo = e.get(`#${id}`);
      expect(campo.attributes("aria-invalid"), id).toBe("true");
      expect(campo.attributes("aria-describedby"), id).toBe(`${id}-error`);
      expect(e.get(`#${id}-error`).text(), id).toBe(mensaje);
    }
    // La casilla de WhatsApp es opcional: no se marca como error.
    expect(e.get("#p01wa").attributes("aria-invalid")).toBeUndefined();
    expect(e.get('[role="alert"]').text()).toBe("Revisa los campos marcados.");
    expect(document.activeElement?.id).toBe("p01n");
  });

  it("HU0001-2.0 resalta el correo y el celular con formato inválido con su mensaje y no llama a la API; corregidos, la solicitud se envía", async () => {
    const e = await montar();
    await completar(e, { ...VALIDOS, telefono: "887654321", correo: "familia@ejemplo" });
    await aceptarPolitica(e);
    await enviar(e);

    expect(posts()).toHaveLength(0);
    expect(e.get("#p01t").attributes("aria-invalid")).toBe("true");
    expect(e.get("#p01t-error").text()).toBe(MENSAJE_TELEFONO);
    expect(e.get("#p01c").attributes("aria-invalid")).toBe("true");
    expect(e.get("#p01c-error").text()).toBe("Ingresa un correo válido.");
    for (const id of ["p01n", "p01a", "p01g", "p01ok"]) {
      expect(e.get(`#${id}`).attributes("aria-invalid"), id).toBe("false");
      expect(e.get(`#${id}`).attributes("aria-describedby"), id).toBeUndefined();
    }
    expect(document.activeElement?.id).toBe("p01t");

    // Un número internacional en E.164 también vale (plan HU0001, P3).
    await e.get("#p01t").setValue("+34 612 345 678");
    await e.get("#p01c").setValue("familia.prueba@ejemplo.test");
    await enviar(e);
    expect(posts()).toHaveLength(1);
    expect(posts()[0]!.cuerpo).toMatchObject({ telefono: "+34612345678", correo: "familia.prueba@ejemplo.test" });
  });
});

// ---------------------------------------------------------------- HU0001-3.0

describe("HU0001-3.0 solicitud sin consentimiento", () => {
  it("HU0001-3.0 sin el consentimiento muestra «El consentimiento es obligatorio para continuar.» y no llama a la API; las dos casillas empiezan desmarcadas", async () => {
    const e = await montar();
    expect(marcada(e, "p01wa")).toBe(false);
    expect(marcada(e, "p01ok")).toBe(false);

    await completar(e);
    await enviar(e);

    expect(posts()).toHaveLength(0);
    const casilla = e.get("#p01ok");
    expect(casilla.attributes("aria-invalid")).toBe("true");
    expect(casilla.attributes("aria-describedby")).toBe("p01ok-error");
    expect(e.get("#p01ok-error").text()).toBe("El consentimiento es obligatorio para continuar.");
    expect(e.get(".consentimiento").classes()).toContain("con-error");
    for (const id of IDS_CAMPOS) expect(e.get(`#${id}`).attributes("aria-invalid"), id).toBe("false");
    expect(document.activeElement?.id).toBe("p01ok");
  });
});

// ---------------------------------------------------------------- soporte: ADR-17 y estados del plan

describe("P01 política, campo trampa y estados de la pantalla", () => {
  it("P01 la Política de privacidad se abre en un diálogo con su versión y el texto de la API, y se cierra con «Cerrar» o con Escape", async () => {
    const e = await montar();
    expect(e.find("dialog").exists()).toBe(false);

    const enlace = e.get("a.enlace-politica");
    await enlace.trigger("click");
    await flushPromises();
    const dialogo = e.get("dialog");
    expect(dialogo.attributes("open")).toBeDefined();
    expect(dialogo.attributes("aria-modal")).toBe("true");
    expect(dialogo.attributes("aria-labelledby")).toBe("p01-politica-titulo");
    expect(dialogo.get("h2").text()).toBe("Política de privacidad");
    expect(dialogo.get(".politica-version").text()).toBe("Versión borrador-1");
    expect(dialogo.get(".politica-texto").text()).toBe(FORMULARIO.politica.texto);
    expect(document.activeElement?.textContent?.trim()).toBe("Cerrar");
    // Abrir la política no marca el consentimiento.
    expect(marcada(e, "p01ok")).toBe(false);

    await dialogo.get("button").trigger("click");
    await flushPromises();
    expect(e.find("dialog").exists()).toBe(false);
    expect(document.activeElement).toBe(enlace.element);

    await enlace.trigger("click");
    await flushPromises();
    await e.get("dialog").trigger("keydown", { key: "Escape" });
    await flushPromises();
    expect(e.find("dialog").exists()).toBe(false);
    expect(llamadas.filter((l) => l.metodo !== "GET")).toHaveLength(0);
  });

  it("P01 el campo trampa no recibe foco ni lo lee un lector de pantalla, y lo que un bot escriba en él se envía para que la API lo descarte", async () => {
    const e = await montar();
    const envoltorio = e.get(".campo-trampa");
    expect(envoltorio.attributes("aria-hidden")).toBe("true");
    const trampa = e.get("#p01-comentario");
    expect(trampa.attributes("tabindex")).toBe("-1");
    expect(trampa.attributes("autocomplete")).toBe("off");
    expect(trampa.attributes("name")).toBe("comentario");

    // Un bot que escribe el valor sin eventos de teclado: igual llega a la API, que responde lo mismo y no guarda nada.
    (trampa.element as HTMLInputElement).value = "Oferta imperdible";
    await completar(e);
    await aceptarPolitica(e);
    await enviar(e);
    expect(posts()[0]!.cuerpo).toMatchObject({ comentario: "Oferta imperdible" });
  });

  it("P01 un 429 o la falta de conexión muestran su aviso y conservan los datos del formulario", async () => {
    const e = await montar();
    await completar(e);
    await aceptarPolitica(e);

    // El texto del 429 es de P01 (plan HU0001, S1), aunque la API o un proxy respondan otro.
    respuestaPost = () => responder(429, { error: { codigo: "DEMASIADAS_SOLICITUDES", mensaje: "Otro texto" } });
    await enviar(e);
    expect(e.get('[role="alert"]').text()).toBe("Recibimos varias solicitudes desde tu conexión. Vuelve a intentarlo en unos minutos.");
    expect((e.get("#p01n").element as HTMLInputElement).value).toBe("Nombre Ficticio");
    expect(e.find("form").exists()).toBe(true);

    respuestaPost = () => {
      throw new TypeError("Failed to fetch");
    };
    await enviar(e);
    expect(e.get('[role="alert"]').text()).toBe("No se pudo conectar con el servidor. Vuelve a intentarlo.");
    expect(marcada(e, "p01ok")).toBe(true);
    expect(posts()).toHaveLength(2);
  });

  it("P01 sin grados en la campaña, o si el formulario no carga, avisa y no deja enviar", async () => {
    respuestaGet = () => responder(200, { ...FORMULARIO, grados: [] });
    const sinGrados = await montar();
    expect(sinGrados.get(".nota-grados").text()).toBe("Por ahora no hay grados disponibles para la campaña 2027.");
    expect(sinGrados.get("#p01g").attributes("disabled")).toBeDefined();
    expect(sinGrados.get('button[type="submit"]').attributes("disabled")).toBeDefined();
    sinGrados.unmount();
    montados = [];

    respuestaGet = () => responder(500, { error: { codigo: "ERROR_INTERNO", mensaje: "Error interno del servidor" } });
    const sinCarga = await montar();
    expect(sinCarga.get('[role="alert"]').text()).toBe("No se pudo cargar el formulario. Vuelve a intentarlo.");
    expect(sinCarga.get('[data-testid="proceso"]').text()).toBe("Proceso de Admisión");
    expect(sinCarga.get('[data-testid="campana-panel"]').text()).toBe("Admisión");
    expect(sinCarga.get('button[type="submit"]').attributes("disabled")).toBeDefined();
    await completar(sinCarga, { ...VALIDOS, grado: undefined });
    await aceptarPolitica(sinCarga);
    await enviar(sinCarga);
    expect(posts()).toHaveLength(0);
  });
});
