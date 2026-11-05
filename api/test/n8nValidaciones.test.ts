// Rama validación de verificacion-completitud (HU0008-2.0, HU0011-2.0 y HU0024-2.0; ADR-07, ADR-16) sin ejecutar n8n: extrae el
// jsCode de sus nodos Code del JSON versionado y lo ejecuta en Node, como n8nCompletitud.test.ts, con las salidas reales
// capturadas en n8n/pruebas/salidas-notificacion-multicanal.json. Verifica el contrato del evento, el barrido, la rama que elige
// cada resultado de notificacion-multicanal, que un ítem que falla no corta los demás y que ningún Stop and Error ni Code arrastra
// el asunto ni el cuerpo del aviso (llevan el motivo de la observación; sus ejecuciones de error se guardan, C11).
// HU0008-2.0 se verifica por partes: «correo» (esta rama) y «WhatsApp» (WHATSAPP_ENABLED lo decide notificacion-multicanal).
// No usa la BD ni la red.
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

const flujo: Flujo = leer("n8n/workflows/verificacion-completitud.json");
const recepcion: Flujo = leer("n8n/workflows/recepcion-registro.json");
const salidas = leer("n8n/pruebas/salidas-notificacion-multicanal.json");
const CENTINELA = "CENTINELA-C11";

// Los nodos de la rama validación, para separarlos de la entrada de HU0017 (que no se toca).
const NODOS_RAMA = [
  "Webhook verificacion-completitud",
  "Validar evento de observación",
  "¿Evento de observación válido?",
  "Responder 202 (observación)",
  "Responder 400 (observación inválida)",
  "Detener: evento de observación inválido",
  "Cada minuto (observaciones)",
  "Pedir observaciones pendientes",
  "Un ítem por expediente observado",
  "Observación recibida",
  "Reservar aviso de observación",
  "Según la reserva",
  "Sin acción (observación)",
  "Enviar observación",
  "Clasificar resultado de observación",
  "Según el resultado de la observación",
  "Observación enviada",
  "Marcar observación fallida",
  "Según el cierre de la observación",
  "Observación no entregada",
  "Fallo al reservar observación",
  "Fallo al enviar observación",
  "Registrar fallo de observación en la API",
];

function nodo(nombre: string): Nodo {
  const n = flujo.nodes.find((x) => x.name === nombre);
  if (!n) throw new Error(`falta el nodo «${nombre}» en ${flujo.name}`);
  return n;
}
const destinos = (nombre: string) => flujo.connections[nombre]!.main.map((salida) => salida.map((d) => d.node));

function ejecutarCodigo(n: Nodo, contexto: { $input?: unknown; $?: (nombre: string) => unknown; $execution?: unknown }) {
  expect(n.type).toBe("n8n-nodes-base.code");
  const fn = new Function("$input", "$", "$execution", n.parameters.jsCode as string);
  return fn(contexto.$input, contexto.$ ?? (() => ({ all: () => [] })), contexto.$execution) as Item[];
}

// «Clasificar resultado de observación»: la entrada es la salida del Execute Workflow; las reservas, la salida «reservado»
// (índice 0) de «Según la reserva» (respuesta completa del HTTP Request: { statusCode, body }).
function clasificar(casos: { salida: Record<string, unknown>; aviso: Record<string, unknown> }[]) {
  const entradas: Item[] = casos.map((c, i) => ({ json: c.salida, pairedItem: { item: i } }));
  const reservas: Item[] = casos.map((c) => ({ json: { statusCode: 201, body: c.aviso } }));
  return ejecutarCodigo(nodo("Clasificar resultado de observación"), {
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

describe("Rama validación de verificacion-completitud (n8n)", () => {
  it("HU0008-2.0 [parte: correo] «Validar evento de observación» acepta solo { id_expediente, id_notificacion } con enteros de 1 a 2147483647 (ADR-16)", () => {
    const cuerpos = [
      { id_expediente: 7, id_notificacion: 55 },
      { id_notificacion: 2147483647, id_expediente: 2147483647 },
      { id_expediente: 7 },
      { id_notificacion: 55 },
      { id_expediente: "7", id_notificacion: 55 },
      { id_expediente: 7, id_notificacion: 0 },
      { id_expediente: 0, id_notificacion: 55 },
      { id_expediente: 7, id_notificacion: 1.5 },
      { id_expediente: 7, id_notificacion: 2147483648 },
      { id_expediente: 7, id_notificacion: 55, asunto: CENTINELA },
      { id_cita: 7, id_notificacion: 55 },
      {},
      null,
      [7, 55],
    ];
    const salida = ejecutarCodigo(nodo("Validar evento de observación"), { $input: { all: () => cuerpos.map((body) => ({ json: { body } })) } });

    expect(salida.map((i) => i.json)).toEqual([
      { valido: true, id_expediente: 7, id_notificacion: 55 },
      { valido: true, id_expediente: 2147483647, id_notificacion: 2147483647 },
      ...Array.from({ length: 12 }, () => ({ valido: false, id_expediente: null, id_notificacion: null })),
    ]);
    expect(JSON.stringify(salida)).not.toContain(CENTINELA);

    // 202 al válido ANTES de procesar y 400 (con Stop and Error) al inválido; el webhook autentica con cil-webhook-secret.
    expect(destinos("¿Evento de observación válido?")).toEqual([["Responder 202 (observación)"], ["Responder 400 (observación inválida)"]]);
    expect(destinos("Responder 202 (observación)")).toEqual([["Observación recibida"]]);
    expect(destinos("Responder 400 (observación inválida)")).toEqual([["Detener: evento de observación inválido"]]);
    expect(nodo("Responder 202 (observación)").parameters.options.responseCode).toBe(202);
    expect(nodo("Responder 400 (observación inválida)").parameters.options.responseCode).toBe(400);
    const webhook = nodo("Webhook verificacion-completitud");
    expect(webhook.parameters).toMatchObject({ httpMethod: "POST", path: "verificacion-completitud", authentication: "headerAuth", responseMode: "responseNode" });
    expect(webhook.credentials).toEqual({ httpHeaderAuth: { name: "cil-webhook-secret" } });
  });

  it("HU0008-2.0 [parte: correo] «Un ítem por expediente observado» saca un ítem por expediente pendiente, sin id_notificacion y solo con ids", () => {
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
    const items = ejecutarCodigo(nodo("Un ítem por expediente observado"), { $input: { all: () => [{ json: respuesta }] } });
    expect(items.map((i) => i.json)).toEqual([
      { id_expediente: 7, id_notificacion: null },
      { id_expediente: 2147483647, id_notificacion: null },
    ]);
    expect(JSON.stringify(items)).not.toContain(CENTINELA);
    for (const json of [{ expedientes: [] }, {}, { expedientes: "x" }]) {
      expect(ejecutarCodigo(nodo("Un ítem por expediente observado"), { $input: { all: () => [{ json }] } })).toEqual([]);
    }

    // Webhook y barrido convergen en «Observación recibida» y de ahí a la reserva.
    expect(destinos("Cada minuto (observaciones)")).toEqual([["Pedir observaciones pendientes"]]);
    expect(destinos("Pedir observaciones pendientes")).toEqual([["Un ítem por expediente observado"]]);
    expect(destinos("Un ítem por expediente observado")).toEqual([["Observación recibida"]]);
    expect(destinos("Observación recibida")).toEqual([["Reservar aviso de observación"]]);
    const pedir = nodo("Pedir observaciones pendientes");
    expect(pedir.parameters.method).toBe("GET");
    expect(pedir.parameters.url).toBe("={{ $env.API_INTERNAL_URL }}/internal/observaciones/pendientes");
    expect(pedir.credentials).toEqual({ httpHeaderAuth: { name: "cil-api-interna" } });
  });

  it("HU0008-2.0 [parte: correo] «Reservar aviso de observación» manda id_notificacion solo en el camino del webhook y el 409 va a «Sin acción (observación)»", () => {
    const reservar = nodo("Reservar aviso de observación");
    expect(reservar.parameters.method).toBe("POST");
    expect(reservar.parameters.url).toBe("={{ $env.API_INTERNAL_URL }}/internal/expedientes/{{ $json.id_expediente }}/aviso-observacion");
    expect(reservar.parameters.jsonBody).toBe("={{ JSON.stringify($json.id_notificacion ? { id_notificacion: $json.id_notificacion } : {}) }}");
    expect(reservar.parameters.options).toEqual({ response: { response: { fullResponse: true, neverError: true } } });
    expect(reservar.credentials).toEqual({ httpHeaderAuth: { name: "cil-api-interna" } });
    expect(reservar.retryOnFail).toBe(true);

    const reglas = nodo("Según la reserva").parameters.rules.values as { outputKey: string; conditions: { conditions: { rightValue: number }[] } }[];
    expect(reglas.map((r) => [r.outputKey, r.conditions.conditions[0]!.rightValue])).toEqual([
      ["reservado", 201],
      ["sin acción", 409],
    ]);
    expect(nodo("Según la reserva").parameters.options).toMatchObject({ fallbackOutput: "extra" });
    expect(destinos("Según la reserva")).toEqual([["Enviar observación"], ["Sin acción (observación)"], ["Fallo al reservar observación"]]);
    expect(nodo("Sin acción (observación)").type).toBe("n8n-nodes-base.noOp");
    expect(flujo.connections["Sin acción (observación)"]).toBeUndefined();

    // «Enviar observación» llama a notificacion-multicanal por nombre con la misma entrada que «Enviar faltantes» (C9).
    const envio = nodo("Enviar observación");
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
    expect(destinos("Enviar observación")).toEqual([["Clasificar resultado de observación"]]);
  });

  it("HU0008-2.0 [parte: correo] «Clasificar resultado de observación» elige la rama de ADR-07 ante cada resultado de notificacion-multicanal", () => {
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
    const casos = Object.keys(esperado).map((n, i) => ({
      nombre: n,
      salida: caso(n).salida_subflujo,
      aviso: { id_expediente: 900 + i, id_notificacion: 500 + i, tipo_evento: "subsanacion_solicitada" },
    }));
    casos.push({ nombre: "resultado desconocido", salida: { id_expediente: 1 }, aviso: { id_expediente: 999, id_notificacion: 599, tipo_evento: "subsanacion_solicitada" } });

    expect(clasificar(casos).map((i) => i.json)).toEqual(
      casos.map((c) => ({
        ...(esperado[c.nombre] ?? { accion: "pendiente", motivo: "resultado_desconocido" }),
        id_expediente: c.aviso.id_expediente,
        id_notificacion: c.aviso.id_notificacion,
      })),
    );

    // Enviado termina; fallido cierra con PATCH; pendiente (resultado desconocido) no hace PATCH y solo se registra.
    expect(destinos("Según el resultado de la observación")).toEqual([["Observación enviada"], ["Marcar observación fallida"], ["Fallo al enviar observación"]]);
    const marcar = nodo("Marcar observación fallida");
    expect(marcar.parameters.method).toBe("PATCH");
    expect(marcar.parameters.url).toBe("={{ $env.API_INTERNAL_URL }}/internal/notificaciones/{{ $json.id_notificacion }}");
    expect(marcar.parameters.jsonBody).toBe("={{ JSON.stringify({ estado_envio: 'fallido' }) }}");
    expect(flujo.connections["Observación enviada"]).toBeUndefined();
    expect(destinos("Marcar observación fallida")).toEqual([["Según el cierre de la observación"], ["Fallo al enviar observación"]]);
    // Rechazo permanente: se cierra y termina sin error; entrada inválida (defecto) y cierre fallido se registran.
    expect(destinos("Según el cierre de la observación")).toEqual([["Fallo al enviar observación"], ["Observación no entregada"], ["Fallo al enviar observación"]]);
  });

  it("HU0008-2.0 [parte: correo] sin el campo pairedItem «Clasificar resultado de observación» empareja el resultado con su reserva por la posición", () => {
    const entradas: Item[] = [
      { json: { id_expediente: 1, correo: { estado_envio: "enviado", id_notificacion: 1 }, whatsapp: "no_aplica" } },
      { json: { error: "notificacion-multicanal: entrada inválida (x)" } },
    ];
    const reservas: Item[] = [
      { json: { statusCode: 201, body: { id_expediente: 31, id_notificacion: 41 } } },
      { json: { statusCode: 201, body: { id_expediente: 32, id_notificacion: 42 } } },
    ];
    const salida = ejecutarCodigo(nodo("Clasificar resultado de observación"), { $input: { all: () => entradas }, $: () => ({ all: () => reservas }) });
    expect(salida.map((i) => i.json)).toEqual([
      { accion: "enviado", motivo: "enviado", id_expediente: 31, id_notificacion: 41 },
      { accion: "fallido", motivo: "entrada_invalida", id_expediente: 32, id_notificacion: 42 },
    ]);
  });

  it("HU0011-2.0 un expediente que falla no corta los demás del barrido: sus errores salen por continueErrorOutput y se registran solo con ids", () => {
    // Ningún nodo de la rama usa continueRegularOutput para un HTTP (terminaría sin error) ni un Stop and Error por ítem.
    for (const nombre of ["Reservar aviso de observación", "Marcar observación fallida"]) {
      expect(nodo(nombre).onError, nombre).toBe("continueErrorOutput");
    }
    expect(destinos("Reservar aviso de observación")).toEqual([["Según la reserva"], ["Fallo al reservar observación"]]);
    const detenciones = NODOS_RAMA.filter((n) => nodo(n).type === "n8n-nodes-base.stopAndError");
    expect(detenciones).toEqual(["Detener: evento de observación inválido"]);

    const itemDeError = { json: { error: `fallo con ${CENTINELA}`, id_expediente: 777777, cuerpo: CENTINELA, asunto: CENTINELA }, pairedItem: { item: 0 } };
    for (const [codigo, esperadoNodo] of [
      ["Fallo al reservar observación", "Reservar aviso de observación"],
      ["Fallo al enviar observación", "Enviar observación"],
    ] as const) {
      const ejecutar = (idEjecucion: unknown, items: Item[]) =>
        ejecutarCodigo(nodo(codigo), { $input: { all: () => items }, $execution: { id: idEjecucion } });

      const salida = ejecutar("1234", [itemDeError, itemDeError]);
      expect(salida.map((i) => i.json), codigo).toEqual(Array.from({ length: 2 }, () => ({ flujo: "verificacion-completitud", nodo: esperadoNodo, id_ejecucion: "1234" })));
      expect(JSON.stringify(salida), codigo).not.toContain(CENTINELA);
      expect(JSON.stringify(salida), codigo).not.toContain("777777");
      expect(ejecutar("55", []), codigo).toEqual([]);
      for (const malo of [undefined, "", "a b", "x".repeat(41), `<${CENTINELA}>`, "1;DROP"]) {
        const s = ejecutar(malo, [itemDeError]);
        expect(s[0]!.json.id_ejecucion, String(malo)).toBe("sin-id");
        expect(JSON.stringify(s)).not.toContain(CENTINELA);
      }
    }

    // El HTTP de registro es el de registro-errores: mismo endpoint, credencial por nombre y solo las 3 claves.
    expect(destinos("Fallo al reservar observación")).toEqual([["Registrar fallo de observación en la API"]]);
    expect(destinos("Fallo al enviar observación")).toEqual([["Registrar fallo de observación en la API"]]);
    expect(flujo.connections["Registrar fallo de observación en la API"]).toBeUndefined();
    const registrar = nodo("Registrar fallo de observación en la API");
    const original = (leer("n8n/workflows/registro-errores.json") as Flujo).nodes.find((n) => n.name === "Registrar fallo en la API")!;
    expect(registrar.parameters).toEqual(original.parameters);
    expect(registrar.credentials).toEqual({ httpHeaderAuth: { name: "cil-api-interna" } });
    // Mismo patrón que recepcion-registro.
    expect(recepcion.nodes.find((n) => n.name === "Verificar completitud")!.onError).toBe("continueErrorOutput");
  });

  it("HU0024-2.0 ningún Stop and Error ni Code de la rama validación interpola el ítem, el asunto ni el cuerpo del aviso", () => {
    const PERMITIDO = /^(id_expediente|id_notificacion|statusCode|motivo)$/;
    for (const n of NODOS_RAMA.map(nodo).filter((x) => x.type === "n8n-nodes-base.stopAndError")) {
      const mensaje = String(n.parameters.errorMessage ?? "");
      const expresiones = [...mensaje.matchAll(/\{\{([\s\S]*?)\}\}/g)].map((m) => m[1]!);
      for (const x of expresiones) {
        expect(x, n.name).not.toMatch(/JSON\.stringify|\$input|\$node|body|asunto|cuerpo|error/);
        const campos = [...x.matchAll(/(?:\$json|\.json)\.(\w+)/g)].map((m) => m[1]!);
        for (const campo of campos) expect(campo, n.name).toMatch(PERMITIDO);
      }
    }
    // Code: con un centinela en el asunto, el cuerpo, un campo extra y el mensaje de error, la salida no lo lleva.
    const aviso = { id_expediente: 8, id_notificacion: 9, tipo_evento: "subsanacion_solicitada", asunto: CENTINELA, cuerpo: `Motivo: ${CENTINELA}` };
    const clasificado = clasificar([
      { salida: { id_expediente: 8, correo: { estado_envio: "enviado", id_notificacion: 9 }, whatsapp: null, cuerpo: CENTINELA }, aviso },
      { salida: { error: `notificacion-multicanal: entrada inválida (${CENTINELA})` }, aviso },
      { salida: { error: `fallo con ${CENTINELA}` }, aviso },
    ]);
    expect(JSON.stringify(clasificado), "Clasificar resultado de observación").not.toContain(CENTINELA);
    expect(clasificado.map((i) => Object.keys(i.json).sort())).toEqual(Array.from({ length: 3 }, () => ["accion", "id_expediente", "id_notificacion", "motivo"]));
    const validado = ejecutarCodigo(nodo("Validar evento de observación"), { $input: { all: () => [{ json: { body: { id_expediente: 9, id_notificacion: 3, cuerpo: CENTINELA } } }] } });
    expect(JSON.stringify(validado)).not.toContain(CENTINELA);

    // Sin nodos Wait; la única llamada a notificacion-multicanal de la rama sigue C9.
    expect(flujo.nodes.some((x) => x.type === "n8n-nodes-base.wait")).toBe(false);
    expect(nodo("Enviar observación").onError).toBe("continueRegularOutput");
  });

  it("HU0024-2.0 la rama validación respeta los settings del flujo, autentica por nombre de credencial y no toca la entrada de HU0017", () => {
    expect(flujo.settings).toMatchObject({
      errorWorkflow: "registro-errores",
      saveDataSuccessExecution: "none",
      saveManualExecutions: false,
      executionTimeout: 480,
      executionOrder: "v1",
    });
    expect(flujo.settings.saveDataErrorExecution).toBeUndefined();
    for (const n of NODOS_RAMA.map(nodo).filter((x) => x.credentials)) {
      for (const ref of Object.values(n.credentials!)) expect(Object.keys(ref), n.name).toEqual(["name"]);
    }
    for (const n of NODOS_RAMA.map(nodo).filter((x) => x.type === "n8n-nodes-base.httpRequest")) {
      expect(n.credentials, n.name).toEqual({ httpHeaderAuth: { name: "cil-api-interna" } });
      expect(n.parameters.url, n.name).toMatch(/^=\{\{ \$env\.API_INTERNAL_URL \}\}\/internal\//);
    }
    expect(JSON.stringify(flujo)).not.toMatch(/X-Webhook-Secret|INTERNAL_API_TOKEN|N8N_WEBHOOK_SECRET/);

    // La entrada de HU0017 sigue intacta: el Execute Workflow Trigger conecta a «Verificar» como antes.
    expect(nodo("Expediente a verificar").type).toBe("n8n-nodes-base.executeWorkflowTrigger");
    expect(destinos("Expediente a verificar")).toEqual([["Verificar"]]);
    expect(destinos("Según la verificación")).toEqual([["Expediente completo"], ["Enviar faltantes"], ["Sin acción"], ["Detener: verificación fallida"]]);
    // Los nodos de la rama no se mezclan con los de HU0017: ninguna conexión de la rama llega a un nodo de HU0017.
    for (const origen of NODOS_RAMA) {
      for (const salida of flujo.connections[origen]?.main ?? []) {
        for (const d of salida) expect(NODOS_RAMA, `${origen} → ${d.node}`).toContain(d.node);
      }
    }
  });
});
