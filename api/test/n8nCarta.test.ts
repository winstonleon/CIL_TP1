// generacion-carta (HU0016-1.0; ADR-06, ADR-07 y ADR-16) sin ejecutar n8n: extrae el jsCode de sus nodos Code del JSON
// versionado y lo ejecuta en Node, como n8nCompletitud.test.ts, con las salidas reales capturadas en
// n8n/pruebas/salidas-notificacion-multicanal.json. Verifica el contrato del evento, el barrido, la rama que elige cada
// resultado de notificacion-multicanal (ADR-07), el reparto de la reserva y que el fallo de un ítem no corta el barrido
// ni arrastra datos de la carta (C11). No usa la BD ni la red.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = resolve(import.meta.dirname, "..", "..");
const leer = (ruta: string) => JSON.parse(readFileSync(resolve(RAIZ, ruta), "utf8"));

interface Nodo {
  name: string;
  type: string;
  onError?: string;
  retryOnFail?: boolean;
  parameters: Record<string, any>;
  credentials?: Record<string, { name?: string; id?: string }>;
}
interface Flujo {
  name: string;
  nodes: Nodo[];
  connections: Record<string, { main: { node: string }[][] }>;
  settings: Record<string, unknown>;
}
interface Item {
  json: Record<string, any>;
  pairedItem?: { item: number };
}

const carta: Flujo = leer("n8n/workflows/generacion-carta.json");
const salidas = leer("n8n/pruebas/salidas-notificacion-multicanal.json");
const CENTINELA = "CENTINELA-C11";

function nodo(nombre: string): Nodo {
  const n = carta.nodes.find((x) => x.name === nombre);
  if (!n) throw new Error(`falta el nodo «${nombre}» en generacion-carta`);
  return n;
}

function ejecutarCodigo(n: Nodo, contexto: { $input?: unknown; $?: (nombre: string) => unknown; $execution?: unknown }) {
  expect(n.type).toBe("n8n-nodes-base.code");
  const fn = new Function("$input", "$", "$execution", n.parameters.jsCode as string);
  return fn(contexto.$input, contexto.$ ?? (() => ({ all: () => [] })), contexto.$execution) as Item[];
}

const destinos = (nombre: string) => carta.connections[nombre]!.main.map((salida) => salida.map((d) => d.node));

// «Clasificar resultado»: la entrada es la salida del Execute Workflow; las reservas, la salida 0 («reservado») de «Según la reserva».
function clasificar(casos: { salida: Record<string, unknown>; reserva: Record<string, unknown> }[]) {
  const entradas: Item[] = casos.map((c, i) => ({ json: c.salida, pairedItem: { item: i } }));
  const reservas: Item[] = casos.map((c) => ({ json: { statusCode: 201, body: c.reserva } }));
  return ejecutarCodigo(nodo("Clasificar resultado"), {
    $input: { all: () => entradas },
    $: (nombre) => {
      expect(nombre).toBe("Según la reserva");
      return { all: (salida: number) => (salida === 0 ? reservas : []) };
    },
  });
}

const caso = (nombre: string) => {
  const c = salidas.clasificar_resultado.find((x: { caso: string }) => x.caso === nombre);
  if (!c) throw new Error(`falta el caso «${nombre}» en los datos fijos`);
  return c;
};

describe("Flujo generacion-carta (n8n)", () => {
  it("HU0016-1.0 (n8n) «Validar evento» acepta solo { id_expediente } con un entero de 1 a 2147483647 y responde 202 o 400", () => {
    const cuerpos = [
      { id_expediente: 7 },
      { id_expediente: 2147483647 },
      { id_expediente: "7" },
      { id_expediente: 0 },
      { id_expediente: -3 },
      { id_expediente: 1.5 },
      { id_expediente: 2147483648 },
      { id_expediente: 7, extra: 1 },
      { id_cita: 7 },
      {},
      null,
      [7],
    ];
    const salida = ejecutarCodigo(nodo("Validar evento"), { $input: { all: () => cuerpos.map((body) => ({ json: { body } })) } });
    expect(salida.map((i) => i.json)).toEqual([
      { valido: true, id_expediente: 7 },
      { valido: true, id_expediente: 2147483647 },
      ...Array.from({ length: 10 }, () => ({ valido: false, id_expediente: null })),
    ]);
    expect(destinos("¿Evento válido?")).toEqual([["Responder 202"], ["Responder 400 (evento inválido)"]]);
    expect(destinos("Responder 400 (evento inválido)")).toEqual([["Detener: evento inválido"]]);
    expect(nodo("Responder 202").parameters.options.responseCode).toBe(202);
    expect(nodo("Responder 400 (evento inválido)").parameters.options.responseCode).toBe(400);
    expect(nodo("Webhook generacion-carta").parameters).toMatchObject({ httpMethod: "POST", path: "generacion-carta", authentication: "headerAuth", responseMode: "responseNode" });
    expect(nodo("Webhook generacion-carta").credentials).toEqual({ httpHeaderAuth: { name: "cil-webhook-secret" } });
    // El 202 llega antes de procesar: la reserva cuelga de «Responder 202».
    expect(destinos("Responder 202")).toEqual([["Expediente recibido"]]);
  });

  it("HU0016-1.0 (n8n) «Un ítem por expediente» saca un ítem por cada expediente pendiente del barrido y solo con id_expediente", () => {
    const respuesta = {
      expedientes: [
        { id_expediente: 7, asunto: CENTINELA },
        { id_expediente: 2147483647, cuerpo: CENTINELA },
        { id_expediente: 0 },
        { id_expediente: "9" },
        { id_expediente: 1.5 },
        null,
        {},
      ],
    };
    const items = ejecutarCodigo(nodo("Un ítem por expediente"), { $input: { all: () => [{ json: respuesta }] } });
    expect(items.map((i) => i.json)).toEqual([{ id_expediente: 7 }, { id_expediente: 2147483647 }]);
    expect(JSON.stringify(items)).not.toContain(CENTINELA);
    for (const json of [{ expedientes: [] }, {}, { expedientes: "x" }]) {
      expect(ejecutarCodigo(nodo("Un ítem por expediente"), { $input: { all: () => [{ json }] } })).toEqual([]);
    }

    expect(nodo("Cada minuto").parameters.rule.interval).toEqual([{ field: "minutes", minutesInterval: 1 }]);
    expect(destinos("Cada minuto")).toEqual([["Pedir pendientes"]]);
    expect(destinos("Pedir pendientes")).toEqual([["Un ítem por expediente"]]);
    expect(destinos("Un ítem por expediente")).toEqual([["Expediente recibido"]]);
    expect(destinos("Expediente recibido")).toEqual([["Generar carta y reservar aviso"]]);
    const pedir = nodo("Pedir pendientes");
    expect(pedir.parameters.method).toBe("GET");
    expect(pedir.parameters.url).toBe("={{ $env.API_INTERNAL_URL }}/internal/cartas/pendientes");
    expect(pedir.credentials).toEqual({ httpHeaderAuth: { name: "cil-api-interna" } });
  });

  it("HU0016-1.0 (n8n) «Generar carta y reservar aviso» hace POST sin cuerpo y «Según la reserva» reparte 201, los 409 sin acción y el resto como fallo", () => {
    const reservar = nodo("Generar carta y reservar aviso");
    expect(reservar.parameters.method).toBe("POST");
    expect(reservar.parameters.url).toBe("={{ $env.API_INTERNAL_URL }}/internal/expedientes/{{ $json.id_expediente }}/carta-vacante");
    expect(reservar.parameters.sendBody).toBeUndefined();
    expect(reservar.parameters.options).toEqual({ response: { response: { fullResponse: true, neverError: true } } });
    expect(reservar.retryOnFail).toBe(true);
    expect(reservar.credentials).toEqual({ httpHeaderAuth: { name: "cil-api-interna" } });

    expect(destinos("Según la reserva")).toEqual([["Enviar carta"], ["Sin acción"], ["Fallo al reservar carta"]]);
    expect(nodo("Según la reserva").parameters.options).toMatchObject({ fallbackOutput: "extra" });
    expect(nodo("Sin acción").type).toBe("n8n-nodes-base.noOp");
    expect(carta.connections["Sin acción"]).toBeUndefined();

    // La condición de «sin acción» se evalúa tal como la escribe el JSON, con los códigos del contrato.
    const reglas = nodo("Según la reserva").parameters.rules.values as { outputKey: string; conditions: { conditions: { leftValue: string }[] } }[];
    expect(reglas.map((r) => r.outputKey)).toEqual(["reservado", "sin acción"]);
    expect(reglas[0]!.conditions.conditions[0]!.leftValue).toBe("={{ $json.statusCode }}");
    const expresion = reglas[1]!.conditions.conditions[0]!.leftValue.replace(/^=\{\{\s*/, "").replace(/\s*\}\}$/, "");
    const sinAccion = (json: unknown) => new Function("$json", `return ${expresion};`)(json) as boolean;
    for (const codigo of ["CUOTA_NO_CONCILIADA", "CARTA_NO_CORRESPONDE", "AVISO_YA_REGISTRADO", "AVISO_AGOTADO"]) {
      expect(sinAccion({ statusCode: 409, body: { error: { codigo } } }), codigo).toBe(true);
    }
    // FIRMA_NO_DISPONIBLE sí es un fallo: debe quedar en el log de la API.
    expect(sinAccion({ statusCode: 409, body: { error: { codigo: "FIRMA_NO_DISPONIBLE" } } })).toBe(false);
    expect(sinAccion({ statusCode: 404, body: { error: { codigo: "AVISO_YA_REGISTRADO" } } })).toBe(false);
    expect(sinAccion({ statusCode: 409, body: {} })).toBe(false);
    expect(sinAccion({ statusCode: 500 })).toBe(false);
  });

  it("HU0016-1.0 (n8n) «Enviar carta» llama a notificacion-multicanal por nombre con la reserva y maneja sus errores con onError (C9)", () => {
    const envio = nodo("Enviar carta");
    expect(envio.type).toBe("n8n-nodes-base.executeWorkflow");
    expect(envio.parameters.workflowId).toMatchObject({ value: "notificacion-multicanal", cachedResultName: "notificacion-multicanal" });
    expect(envio.parameters.mode).toBe("each");
    expect(envio.onError).toBe("continueRegularOutput");
    expect(envio.parameters.workflowInputs.value).toEqual({
      id_expediente: "={{ $json.body.id_expediente }}",
      tipo_evento: "={{ $json.body.tipo_evento }}",
      asunto: "={{ $json.body.asunto }}",
      cuerpo: "={{ $json.body.cuerpo }}",
      id_notificacion: "={{ $json.body.id_notificacion }}",
    });
    expect(destinos("Enviar carta")).toEqual([["Clasificar resultado"]]);
  });

  it("HU0016-1.0 (n8n) «Clasificar resultado» elige la rama de ADR-07 ante cada resultado de notificacion-multicanal", () => {
    const esperado: Record<string, { accion: string; motivo: string }> = {
      "envío exitoso": { accion: "enviado", motivo: "enviado" },
      "rechazo 550 del destinatario": { accion: "fallido", motivo: "rechazo_destinatario" },
      "error de conexión con Mailpit detenido": { accion: "pendiente", motivo: "smtp_pendiente" },
      "400 entrada inválida": { accion: "fallido", motivo: "entrada_invalida" },
      "502 contacto inexistente": { accion: "pendiente", motivo: "notificacion_no_disponible" },
      "502 con la API detenida": { accion: "pendiente", motivo: "notificacion_no_disponible" },
      "500 registro fallido (nodo HTTP sin conexión)": { accion: "pendiente", motivo: "notificacion_no_disponible" },
      "500 registro fallido (nodo HTTP con 404)": { accion: "pendiente", motivo: "notificacion_no_disponible" },
    };
    const casos = Object.keys(esperado).map((n, i) => {
      const c = caso(n);
      return { nombre: n, salida: c.salida_subflujo, reserva: { id_expediente: 900 + i, id_notificacion: 500 + i, tipo_evento: "carta_emitida" } };
    });
    casos.push({ nombre: "resultado desconocido", salida: { id_expediente: 1 }, reserva: { id_expediente: 999, id_notificacion: 599, tipo_evento: "carta_emitida" } });

    const resultado = clasificar(casos);
    expect(resultado.map((i) => i.json)).toEqual(
      casos.map((c) => ({
        ...(esperado[c.nombre] ?? { accion: "pendiente", motivo: "resultado_desconocido" }),
        id_expediente: c.reserva.id_expediente,
        id_notificacion: c.reserva.id_notificacion,
      })),
    );

    // Cada acción va a su nodo: enviado termina; fallido cierra con PATCH; pendiente se registra sin PATCH y el barrido lo retoma.
    expect(destinos("Según el resultado")).toEqual([["Aviso enviado"], ["Marcar fallido"], ["Fallo al enviar carta"]]);
    const marcar = nodo("Marcar fallido");
    expect(marcar.parameters.method).toBe("PATCH");
    expect(marcar.parameters.url).toBe("={{ $env.API_INTERNAL_URL }}/internal/notificaciones/{{ $json.id_notificacion }}");
    expect(marcar.parameters.jsonBody).toBe("={{ JSON.stringify({ estado_envio: 'fallido' }) }}");
    expect(marcar.onError).toBe("continueErrorOutput");
    expect(destinos("Marcar fallido")).toEqual([["Según el cierre"], ["Fallo al enviar carta"]]);
    expect(destinos("Según el cierre")).toEqual([["Fallo al enviar carta"], ["Aviso no entregado"], ["Fallo al enviar carta"]]);
  });

  it("HU0016-1.0 (n8n) sin el campo pairedItem «Clasificar resultado» empareja el resultado con su reserva por la posición", () => {
    const entradas: Item[] = [
      { json: { id_expediente: 1, correo: { estado_envio: "enviado", id_notificacion: 1 }, whatsapp: "no_aplica" } },
      { json: { error: "notificacion-multicanal: entrada inválida (x)" } },
    ];
    const reservas: Item[] = [
      { json: { statusCode: 201, body: { id_expediente: 31, id_notificacion: 41 } } },
      { json: { statusCode: 201, body: { id_expediente: 32, id_notificacion: 42 } } },
    ];
    const salida = ejecutarCodigo(nodo("Clasificar resultado"), { $input: { all: () => entradas }, $: () => ({ all: () => reservas }) });
    expect(salida.map((i) => i.json)).toEqual([
      { accion: "enviado", motivo: "enviado", id_expediente: 31, id_notificacion: 41 },
      { accion: "fallido", motivo: "entrada_invalida", id_expediente: 32, id_notificacion: 42 },
    ]);
  });

  it("HU0016-1.0 (n8n) el fallo de un ítem no corta el barrido: va a «Fallo al …» y se registra solo { flujo, nodo, id_ejecucion } (C41-4, C11)", () => {
    // Ningún Stop and Error en el camino de los ítems: solo el del evento inválido, que no pasa por el barrido.
    expect(carta.nodes.filter((n) => n.type === "n8n-nodes-base.stopAndError").map((n) => n.name)).toEqual(["Detener: evento inválido"]);
    expect(carta.nodes.some((n) => n.type === "n8n-nodes-base.wait")).toBe(false);

    const reservar = nodo("Generar carta y reservar aviso");
    expect(reservar.onError).toBe("continueErrorOutput");
    expect(destinos("Generar carta y reservar aviso")).toEqual([["Según la reserva"], ["Fallo al reservar carta"]]);
    expect(nodo("Enviar carta").onError).toBe("continueRegularOutput");
    expect(destinos("Fallo al reservar carta")).toEqual([["Registrar fallo en la API"]]);
    expect(destinos("Fallo al enviar carta")).toEqual([["Registrar fallo en la API"]]);
    expect(carta.connections["Registrar fallo en la API"]).toBeUndefined();

    const itemDeError = { json: { error: `fallo con ${CENTINELA}`, id_expediente: 777777, cuerpo: CENTINELA, asunto: CENTINELA }, pairedItem: { item: 0 } };
    const esperadoNodo: Record<string, string> = { "Fallo al reservar carta": "Generar carta y reservar aviso", "Fallo al enviar carta": "Enviar carta" };
    for (const [nombre, nodoOrigen] of Object.entries(esperadoNodo)) {
      const ejecutar = (idEjecucion: unknown, items: Item[]) => ejecutarCodigo(nodo(nombre), { $input: { all: () => items }, $execution: { id: idEjecucion } });
      const salida = ejecutar("1234", [itemDeError]);
      expect(salida.map((i) => i.json), nombre).toEqual([{ flujo: "generacion-carta", nodo: nodoOrigen, id_ejecucion: "1234" }]);
      expect(JSON.stringify(salida), nombre).not.toContain(CENTINELA);
      expect(JSON.stringify(salida), nombre).not.toContain("777777");
      expect(ejecutar("55", [itemDeError, itemDeError]).map((i) => i.json.id_ejecucion)).toEqual(["55", "55"]);
      expect(ejecutar("55", [])).toEqual([]);
      for (const malo of [undefined, "", "a b", "x".repeat(41), `<${CENTINELA}>`, "1;DROP"]) {
        expect(ejecutar(malo, [itemDeError])[0]!.json.id_ejecucion, `${nombre} ${String(malo)}`).toBe("sin-id");
      }
    }

    // «Clasificar resultado» no arrastra el asunto, el cuerpo ni el mensaje del error.
    const reserva = { id_expediente: 8, id_notificacion: 9, tipo_evento: "carta_emitida", asunto: CENTINELA, cuerpo: `Carta: ${CENTINELA}` };
    const clasificado = clasificar([
      { salida: { id_expediente: 8, correo: { estado_envio: "enviado", id_notificacion: 9 }, whatsapp: null, cuerpo: CENTINELA }, reserva },
      { salida: { error: `notificacion-multicanal: entrada inválida (${CENTINELA})` }, reserva },
      { salida: { error: `fallo con ${CENTINELA}` }, reserva },
    ]);
    expect(JSON.stringify(clasificado)).not.toContain(CENTINELA);

    // El HTTP de registro es el de registro-errores: mismo endpoint, credencial por nombre y solo las 3 claves.
    const registrar = nodo("Registrar fallo en la API");
    const original = (leer("n8n/workflows/registro-errores.json") as Flujo).nodes.find((n) => n.name === "Registrar fallo en la API")!;
    expect(registrar.parameters).toEqual(original.parameters);
    expect(registrar.credentials).toEqual({ httpHeaderAuth: { name: "cil-api-interna" } });
  });

  it("HU0016-1.0 (n8n) el flujo no guarda ejecuciones exitosas, declara el Error Workflow por nombre y no lleva secretos ni IDs", () => {
    expect(carta.name).toBe("generacion-carta");
    expect(carta.settings).toMatchObject({
      errorWorkflow: "registro-errores",
      saveDataSuccessExecution: "none",
      saveManualExecutions: false,
      executionTimeout: 480,
      executionOrder: "v1",
    });
    // Las ejecuciones con error se siguen guardando (S0-C8, C10 y C11).
    expect(carta.settings.saveDataErrorExecution).toBeUndefined();

    for (const n of carta.nodes.filter((x) => x.credentials)) {
      for (const ref of Object.values(n.credentials!)) expect(Object.keys(ref), n.name).toEqual(["name"]);
    }
    for (const n of carta.nodes.filter((x) => x.type === "n8n-nodes-base.httpRequest")) {
      expect(n.credentials, n.name).toEqual({ httpHeaderAuth: { name: "cil-api-interna" } });
      expect(n.parameters.url, n.name).toMatch(/^=\{\{ \$env\.API_INTERNAL_URL \}\}\/internal\//);
      expect(n.retryOnFail, n.name).toBe(true);
    }
    expect(JSON.stringify(carta)).not.toMatch(/X-Webhook-Secret|INTERNAL_API_TOKEN|N8N_WEBHOOK_SECRET/);

    // Cada Code lleva un comentario inicial con su HU, y el Stop and Error no interpola datos.
    for (const n of carta.nodes.filter((x) => x.type === "n8n-nodes-base.code")) {
      expect(String(n.parameters.jsCode).startsWith("//"), n.name).toBe(true);
      expect(String(n.parameters.jsCode), n.name).toContain("HU0016-1.0");
    }
    expect(nodo("Detener: evento inválido").parameters.errorMessage).not.toContain("{{");
  });
});
