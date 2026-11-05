// recepcion-registro y verificacion-completitud (HU0017, ADR-16 y ADR-22) sin ejecutar n8n: extrae el jsCode de sus nodos
// Code del JSON versionado y lo ejecuta en Node, como n8nAgendamiento.test.ts, con las salidas reales capturadas en
// n8n/pruebas/salidas-notificacion-multicanal.json. Verifica el contrato del evento, el reparto de los códigos HTTP de la
// verificación, la rama que elige cada resultado de notificacion-multicanal (ADR-07) y que ningún Stop and Error ni Code
// arrastra el asunto ni el cuerpo del aviso (trae la lista de faltantes; sus ejecuciones de error se guardan, C11).
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

const recepcion: Flujo = leer("n8n/workflows/recepcion-registro.json");
const verificacion: Flujo = leer("n8n/workflows/verificacion-completitud.json");
const salidas = leer("n8n/pruebas/salidas-notificacion-multicanal.json");
const FLUJOS = [recepcion, verificacion];

const CENTINELA = "CENTINELA-C11";

function nodo(flujo: Flujo, nombre: string): Nodo {
  const n = flujo.nodes.find((x) => x.name === nombre);
  if (!n) throw new Error(`falta el nodo «${nombre}» en ${flujo.name}`);
  return n;
}

// Ejecuta el código de un nodo Code como lo haría n8n, con $input, $json y $('Nodo') simulados.
function ejecutarCodigo(n: Nodo, contexto: { $input?: unknown; $json?: unknown; $?: (nombre: string) => unknown }) {
  expect(n.type).toBe("n8n-nodes-base.code");
  const fn = new Function("$input", "$json", "$", n.parameters.jsCode as string);
  return fn(contexto.$input, contexto.$json, contexto.$ ?? (() => ({ all: () => [] }))) as Item[];
}

const destinos = (flujo: Flujo, nombre: string) => flujo.connections[nombre]!.main.map((salida) => salida.map((d) => d.node));

// «Clasificar resultado»: la entrada es la salida del Execute Workflow; los avisos, la salida «incompleto» (índice 1) de
// «Según la verificación» (respuesta completa del HTTP Request: { statusCode, body }).
function clasificar(casos: { salida: Record<string, unknown>; aviso: Record<string, unknown> }[]) {
  const entradas: Item[] = casos.map((c, i) => ({ json: c.salida, pairedItem: { item: i } }));
  const avisos: Item[] = casos.map((c) => ({ json: { statusCode: 201, body: c.aviso } }));
  return ejecutarCodigo(nodo(verificacion, "Clasificar resultado"), {
    $input: { all: () => entradas },
    $: (nombre) => {
      expect(nombre).toBe("Según la verificación");
      return { all: (salida: number) => (salida === 1 ? avisos : []) };
    },
  });
}

const caso = (nombre: string) => {
  const c = salidas.clasificar_resultado.find((x: { caso: string }) => x.caso === nombre);
  if (!c) throw new Error(`falta el caso «${nombre}» en los datos fijos`);
  return c;
};

describe("Flujos recepcion-registro y verificacion-completitud (n8n)", () => {
  it("HU0017-2.0 «Validar evento» de recepcion-registro acepta solo { id_expediente } con un entero de 1 a 2147483647 (ADR-16)", () => {
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
    const salida = ejecutarCodigo(nodo(recepcion, "Validar evento"), { $input: { all: () => cuerpos.map((body) => ({ json: { body } })) } });

    expect(salida.map((i) => i.json)).toEqual([
      { valido: true, id_expediente: 7 },
      { valido: true, id_expediente: 2147483647 },
      ...Array.from({ length: 10 }, () => ({ valido: false, id_expediente: null })),
    ]);
    // 202 al válido y 400 (con Stop and Error) al inválido; ambos corren antes de pasar al subflujo.
    expect(destinos(recepcion, "¿Evento válido?")).toEqual([["Responder 202"], ["Responder 400 (evento inválido)"]]);
    expect(destinos(recepcion, "Responder 400 (evento inválido)")).toEqual([["Detener: evento inválido"]]);
    expect(nodo(recepcion, "Responder 202").parameters.options.responseCode).toBe(202);
    expect(nodo(recepcion, "Responder 400 (evento inválido)").parameters.options.responseCode).toBe(400);
    expect(nodo(recepcion, "Webhook recepcion-registro").parameters).toMatchObject({ httpMethod: "POST", path: "recepcion-registro", responseMode: "responseNode" });
  });

  it("HU0017-2.0 «Un ítem por expediente» saca un ítem por cada expediente pendiente del barrido y solo con id_expediente", () => {
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
    const items = ejecutarCodigo(nodo(recepcion, "Un ítem por expediente"), { $input: { all: () => [{ json: respuesta }] } });
    expect(items.map((i) => i.json)).toEqual([{ id_expediente: 7 }, { id_expediente: 2147483647 }]);
    expect(JSON.stringify(items)).not.toContain(CENTINELA);

    // Sin pendientes (o una respuesta que no es la esperada) no sale ningún ítem y la ejecución termina.
    for (const json of [{ expedientes: [] }, {}, { expedientes: "x" }]) {
      expect(ejecutarCodigo(nodo(recepcion, "Un ítem por expediente"), { $input: { all: () => [{ json }] } })).toEqual([]);
    }

    // Webhook y barrido convergen y llaman al subflujo por nombre, con solo id_expediente.
    expect(destinos(recepcion, "Cada minuto")).toEqual([["Pedir pendientes"]]);
    expect(destinos(recepcion, "Pedir pendientes")).toEqual([["Un ítem por expediente"]]);
    expect(destinos(recepcion, "Un ítem por expediente")).toEqual([["Expediente recibido"]]);
    expect(destinos(recepcion, "Responder 202")).toEqual([["Expediente recibido"]]);
    expect(destinos(recepcion, "Expediente recibido")).toEqual([["Verificar completitud"]]);
    const llamada = nodo(recepcion, "Verificar completitud");
    expect(llamada.type).toBe("n8n-nodes-base.executeWorkflow");
    expect(llamada.parameters.workflowId).toMatchObject({ value: "verificacion-completitud", cachedResultName: "verificacion-completitud" });
    expect(llamada.parameters.mode).toBe("each");
    expect(Object.keys(llamada.parameters.workflowInputs.value)).toEqual(["id_expediente"]);
    const pedir = nodo(recepcion, "Pedir pendientes");
    expect(pedir.parameters.method).toBe("GET");
    expect(pedir.parameters.url).toBe("={{ $env.API_INTERNAL_URL }}/internal/completitud/pendientes");
    expect(pedir.credentials).toEqual({ httpHeaderAuth: { name: "cil-api-interna" } });
  });

  it("HU0017-1.0 [parte: estado y ramas] «Según la verificación» envía el 200 (completo) a «Expediente completo», que no notifica", () => {
    const verificar = nodo(verificacion, "Verificar");
    expect(verificar.parameters.method).toBe("POST");
    expect(verificar.parameters.url).toBe("={{ $env.API_INTERNAL_URL }}/internal/expedientes/{{ $json.id_expediente }}/verificacion-completitud");
    expect(verificar.parameters.options).toEqual({ response: { response: { fullResponse: true, neverError: true } } });
    expect(verificar.credentials).toEqual({ httpHeaderAuth: { name: "cil-api-interna" } });

    const segun = nodo(verificacion, "Según la verificación");
    const reglas = segun.parameters.rules.values as { outputKey: string; conditions: { conditions: { rightValue: number }[] } }[];
    expect(reglas.map((r) => [r.outputKey, r.conditions.conditions[0]!.rightValue])).toEqual([
      ["completo", 200],
      ["incompleto", 201],
      ["conflicto", 409],
    ]);
    const completo = nodo(verificacion, "Expediente completo");
    expect(destinos(verificacion, "Según la verificación")[0]).toEqual(["Expediente completo"]);
    // Es un noOp sin salida: el completo no llama a notificacion-multicanal ni a ningún otro nodo.
    expect(completo.type).toBe("n8n-nodes-base.noOp");
    expect(verificacion.connections["Expediente completo"]).toBeUndefined();
  });

  it("HU0017-2.0 «Según la verificación» envía el 201 a «Enviar faltantes», el 409 a «Sin acción» y cualquier otro estado a «Detener: verificación fallida»", () => {
    expect(destinos(verificacion, "Según la verificación")).toEqual([
      ["Expediente completo"],
      ["Enviar faltantes"],
      ["Sin acción"],
      ["Detener: verificación fallida"],
    ]);
    expect(nodo(verificacion, "Según la verificación").parameters.options).toMatchObject({ fallbackOutput: "extra" });
    expect(nodo(verificacion, "Sin acción").type).toBe("n8n-nodes-base.noOp");
    expect(verificacion.connections["Sin acción"]).toBeUndefined();
    expect(nodo(verificacion, "Detener: verificación fallida").type).toBe("n8n-nodes-base.stopAndError");

    // «Enviar faltantes» llama a notificacion-multicanal por nombre con la misma entrada que «Enviar aviso» de agendamiento (C9).
    const envio = nodo(verificacion, "Enviar faltantes");
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
    expect(destinos(verificacion, "Enviar faltantes")).toEqual([["Clasificar resultado"]]);
  });

  it("HU0017-2.0 «Clasificar resultado» de verificacion-completitud elige la rama de ADR-07 ante cada resultado de notificacion-multicanal", () => {
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
      return { nombre: n, salida: c.salida_subflujo, aviso: { id_expediente: 900 + i, id_notificacion: 500 + i, tipo_evento: "documentos_faltantes" } };
    });
    casos.push({ nombre: "resultado desconocido", salida: { id_expediente: 1 }, aviso: { id_expediente: 999, id_notificacion: 599, tipo_evento: "documentos_faltantes" } });

    const resultado = clasificar(casos);

    expect(resultado.map((i) => i.json)).toEqual(
      casos.map((c) => ({
        ...(esperado[c.nombre] ?? { accion: "pendiente", motivo: "resultado_desconocido" }),
        id_expediente: c.aviso.id_expediente,
        id_notificacion: c.aviso.id_notificacion,
      })),
    );
    // Cada acción va a su nodo: enviado termina; fallido cierra con PATCH; pendiente (resultado desconocido) se detiene sin PATCH.
    expect(destinos(verificacion, "Según el resultado")).toEqual([["Aviso enviado"], ["Marcar fallido"], ["Detener: envío pospuesto"]]);
    const marcar = nodo(verificacion, "Marcar fallido");
    expect(marcar.parameters.method).toBe("PATCH");
    expect(marcar.parameters.url).toBe("={{ $env.API_INTERNAL_URL }}/internal/notificaciones/{{ $json.id_notificacion }}");
    expect(marcar.parameters.jsonBody).toBe("={{ JSON.stringify({ estado_envio: 'fallido' }) }}");
    expect(destinos(verificacion, "Marcar fallido")).toEqual([["Según el cierre"]]);
    expect(destinos(verificacion, "Según el cierre")).toEqual([["Detener: entrada rechazada"], ["Aviso no entregado"], ["Detener: cierre fallido"]]);
  });

  it("HU0017-2.0 sin el campo pairedItem «Clasificar resultado» empareja el resultado con su aviso por la posición", () => {
    const entradas: Item[] = [
      { json: { id_expediente: 1, correo: { estado_envio: "enviado", id_notificacion: 1 }, whatsapp: "no_aplica" } },
      { json: { error: "notificacion-multicanal: entrada inválida (x)" } },
    ];
    const avisos: Item[] = [
      { json: { statusCode: 201, body: { id_expediente: 31, id_notificacion: 41 } } },
      { json: { statusCode: 201, body: { id_expediente: 32, id_notificacion: 42 } } },
    ];
    const salida = ejecutarCodigo(nodo(verificacion, "Clasificar resultado"), {
      $input: { all: () => entradas },
      $: () => ({ all: () => avisos }),
    });
    expect(salida.map((i) => i.json)).toEqual([
      { accion: "enviado", motivo: "enviado", id_expediente: 31, id_notificacion: 41 },
      { accion: "fallido", motivo: "entrada_invalida", id_expediente: 32, id_notificacion: 42 },
    ]);
  });

  it("HU0017-2.0 ningún Stop and Error ni Code de recepcion-registro o verificacion-completitud interpola el ítem, el asunto ni el cuerpo", () => {
    // Stop and Error: solo identificadores, el motivo y el estado HTTP (el cuerpo trae la lista de faltantes, C11).
    const PERMITIDO = /^(id_expediente|id_notificacion|statusCode|motivo)$/;
    for (const flujo of FLUJOS) {
      for (const n of flujo.nodes.filter((x) => x.type === "n8n-nodes-base.stopAndError")) {
        const mensaje = String(n.parameters.errorMessage ?? "");
        const expresiones = [...mensaje.matchAll(/\{\{([\s\S]*?)\}\}/g)].map((m) => m[1]!);
        for (const x of expresiones) {
          expect(x, `${flujo.name} · ${n.name}`).not.toMatch(/JSON\.stringify|\$input|\$node|body|asunto|cuerpo|error/);
          const campos = [...x.matchAll(/(?:\$json|\.json)\.(\w+)/g)].map((m) => m[1]!);
          expect(campos.length, `${flujo.name} · ${n.name}: ${x}`).toBeGreaterThan(0);
          for (const campo of campos) expect(campo, `${flujo.name} · ${n.name}`).toMatch(PERMITIDO);
          expect(x.replace(/(?:\$json|\.json)\.\w+/g, ""), `${flujo.name} · ${n.name}`).not.toMatch(/\$json|\.json\b/);
        }
      }
    }

    // Code: con un centinela en el asunto, el cuerpo, un campo extra y el mensaje de error, la salida no lo lleva.
    const aviso = { id_expediente: 8, id_notificacion: 9, tipo_evento: "documentos_faltantes", asunto: CENTINELA, cuerpo: `Faltan: ${CENTINELA}` };
    const clasificado = clasificar([
      { salida: { id_expediente: 8, correo: { estado_envio: "enviado", id_notificacion: 9 }, whatsapp: null, cuerpo: CENTINELA }, aviso },
      { salida: { error: `notificacion-multicanal: entrada inválida (${CENTINELA})` }, aviso },
      { salida: { error: `fallo con ${CENTINELA}` }, aviso },
    ]);
    expect(JSON.stringify(clasificado), "Clasificar resultado").not.toContain(CENTINELA);
    const validado = ejecutarCodigo(nodo(recepcion, "Validar evento"), { $input: { all: () => [{ json: { body: { id_expediente: 9, cuerpo: CENTINELA } } }] } });
    expect(JSON.stringify(validado)).not.toContain(CENTINELA);
    expect(validado.map((i) => i.json)).toEqual([{ valido: false, id_expediente: null }]);

    // El único flujo que llama a notificacion-multicanal sigue C9: continúa ante el error del subflujo.
    expect(nodo(verificacion, "Enviar faltantes").onError).toBe("continueRegularOutput");
    expect(recepcion.nodes.some((x) => x.type === "n8n-nodes-base.wait")).toBe(false);
    expect(verificacion.nodes.some((x) => x.type === "n8n-nodes-base.wait")).toBe(false);
  });

  it("HU0017-2.0 «Fallo al verificar» emite solo { flujo, nodo, id_ejecucion } y no arrastra el ítem de error ni su id_expediente", () => {
    // El ítem de la salida de error de un Execute Workflow trae el mensaje del error (puede traer datos personales).
    const itemDeError = { json: { error: `fallo con ${CENTINELA}`, id_expediente: 777777, cuerpo: CENTINELA }, pairedItem: { item: 0 } };
    const ejecutar = (idEjecucion: unknown, items: Item[]) => {
      const fn = new Function("$input", "$execution", nodo(recepcion, "Fallo al verificar").parameters.jsCode as string);
      return fn({ all: () => items }, { id: idEjecucion }) as Item[];
    };

    const salida = ejecutar("1234", [itemDeError]);
    expect(salida.map((i) => i.json)).toEqual([{ flujo: "recepcion-registro", nodo: "Verificar completitud", id_ejecucion: "1234" }]);
    expect(Object.keys(salida[0]!.json).sort()).toEqual(["flujo", "id_ejecucion", "nodo"]);
    expect(JSON.stringify(salida)).not.toContain(CENTINELA);
    expect(JSON.stringify(salida)).not.toContain("777777");

    // Un ítem por expediente que falló, todos con el mismo id de ejecución; sin fallos no sale nada.
    expect(ejecutar("55", [itemDeError, itemDeError]).map((i) => i.json.id_ejecucion)).toEqual(["55", "55"]);
    expect(ejecutar("55", [])).toEqual([]);
    // El id se sanea con la misma regla que registro-errores: lo que no cumple pasa a «sin-id».
    for (const malo of [undefined, "", "a b", "x".repeat(41), `<${CENTINELA}>`, "1;DROP"]) {
      const s = ejecutar(malo, [itemDeError]);
      expect(s[0]!.json.id_ejecucion, String(malo)).toBe("sin-id");
      expect(JSON.stringify(s)).not.toContain(CENTINELA);
    }
    expect(ejecutar("abc-DEF-123", [itemDeError])[0]!.json.id_ejecucion).toBe("abc-DEF-123");
  });

  it("HU0017-2.0 «Verificar completitud» continúa por su salida de error (no por la regular), que registra el fallo en la API y deja el éxito sin destino", () => {
    const llamada = nodo(recepcion, "Verificar completitud");
    // continueRegularOutput terminaría la ejecución sin error y registro-errores no se dispararía: no se usa.
    expect(llamada.onError).toBe("continueErrorOutput");
    const salidas = recepcion.connections["Verificar completitud"]!.main;
    expect(salidas[0] ?? []).toEqual([]);
    expect(salidas[1]!.map((d) => d.node)).toEqual(["Fallo al verificar"]);
    expect(destinos(recepcion, "Fallo al verificar")).toEqual([["Registrar fallo en la API"]]);
    expect(recepcion.connections["Registrar fallo en la API"]).toBeUndefined();

    // El HTTP de registro es el de registro-errores: mismo endpoint, credencial por nombre y solo las 3 claves.
    const registrar = nodo(recepcion, "Registrar fallo en la API");
    const original = nodo(leer("n8n/workflows/registro-errores.json") as Flujo, "Registrar fallo en la API");
    expect(registrar.parameters).toEqual(original.parameters);
    expect(registrar.credentials).toEqual({ httpHeaderAuth: { name: "cil-api-interna" } });
    expect(registrar.parameters.url).toBe("={{ $env.API_INTERNAL_URL }}/internal/errores-flujo");
    expect(registrar.parameters.jsonBody).toBe("={{ JSON.stringify({ flujo: $json.flujo, nodo: $json.nodo, id_ejecucion: $json.id_ejecucion }) }}");
    // Las ejecuciones con error se siguen guardando y el Error Workflow no cambia.
    expect(recepcion.settings.saveDataErrorExecution).toBeUndefined();
    expect(recepcion.settings.errorWorkflow).toBe("registro-errores");
  });

  it("HU0017-2.0 los dos flujos usan el Error Workflow por nombre, no guardan ejecuciones exitosas y autentican por nombre de credencial", () => {
    for (const flujo of FLUJOS) {
      // ADR-16/ADR-22: como captacion, no guardan las exitosas y sí las de error (saveDataErrorExecution sin definir, C10 y C11).
      expect(flujo.settings, flujo.name).toMatchObject({
        errorWorkflow: "registro-errores",
        saveDataSuccessExecution: "none",
        saveManualExecutions: false,
        executionTimeout: 480,
        executionOrder: "v1",
      });
      expect(flujo.settings.saveDataErrorExecution, flujo.name).toBeUndefined();
      // Credenciales solo por nombre, sin id ni secretos en el JSON.
      for (const n of flujo.nodes.filter((x) => x.credentials)) {
        for (const ref of Object.values(n.credentials!)) {
          expect(Object.keys(ref), `${flujo.name} · ${n.name}`).toEqual(["name"]);
        }
      }
      for (const n of flujo.nodes.filter((x) => x.type === "n8n-nodes-base.httpRequest")) {
        expect(n.credentials, `${flujo.name} · ${n.name}`).toEqual({ httpHeaderAuth: { name: "cil-api-interna" } });
        expect(n.parameters.url, `${flujo.name} · ${n.name}`).toMatch(/^=\{\{ \$env\.API_INTERNAL_URL \}\}\/internal\//);
      }
      expect(JSON.stringify(flujo), flujo.name).not.toMatch(/X-Webhook-Secret|INTERNAL_API_TOKEN|N8N_WEBHOOK_SECRET/);
    }
    // El webhook de entrada autentica con la credencial cil-webhook-secret (X-Webhook-Secret, ADR-04), referenciada por nombre.
    const webhook = nodo(recepcion, "Webhook recepcion-registro");
    expect(webhook.parameters.authentication).toBe("headerAuth");
    expect(webhook.credentials).toEqual({ httpHeaderAuth: { name: "cil-webhook-secret" } });
    // verificacion-completitud tiene el webhook de la rama validación (bloque 5); la entrada de HU0017 sigue siendo la de recepcion-registro.
    expect(verificacion.nodes.some((x) => x.type === "n8n-nodes-base.webhook")).toBe(true);
    expect(nodo(verificacion, "Expediente a verificar").type).toBe("n8n-nodes-base.executeWorkflowTrigger");
  });
});
