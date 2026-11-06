// Rama evaluaciones de agendamiento (HU0009 y C52) sin ejecutar n8n: extrae el jsCode de sus nodos Code del JSON versionado
// y lo ejecuta en Node, como n8nAgendamiento.test.ts, con las salidas reales capturadas en
// n8n/pruebas/salidas-notificacion-multicanal.json. Verifica el contrato del evento (ADR-16), el enrutamiento del webhook
// (la visita no cambia), el barrido, la reserva por webhook o por barrido, la rama de ADR-07 ante cada resultado y que
// ningún nodo arrastre el asunto, el cuerpo ni el mensaje del error (C11). No usa la BD ni la red.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = resolve(import.meta.dirname, "..", "..");
const leer = (ruta: string) => JSON.parse(readFileSync(resolve(RAIZ, ruta), "utf8"));

interface Nodo {
  name: string;
  type: string;
  onError?: string;
  parameters: Record<string, any>;
}
interface Flujo {
  nodes: Nodo[];
  connections: Record<string, { main: { node: string }[][] }>;
  settings: Record<string, unknown>;
}
interface Item {
  json: Record<string, any>;
  pairedItem?: { item: number };
}

const agendamiento: Flujo = leer("n8n/workflows/agendamiento.json");
const salidas = leer("n8n/pruebas/salidas-notificacion-multicanal.json");
const CENTINELA = "CENTINELA-HU0009";
const TIPOS = ["evaluaciones_habilitadas", "evaluaciones_confirmadas", "evaluacion_reprogramada", "evaluacion_reprogramada_responsable", "evaluacion_liberada_responsable"];

function nodo(nombre: string): Nodo {
  const n = agendamiento.nodes.find((x) => x.name === nombre);
  if (!n) throw new Error(`falta el nodo «${nombre}»`);
  return n;
}

// Ejecuta el código de un nodo Code como lo haría n8n, con $input, $json, $('Nodo') y $execution simulados.
function ejecutarCodigo(n: Nodo, contexto: { $input?: unknown; $?: (nombre: string) => unknown; $execution?: unknown }) {
  expect(n.type).toBe("n8n-nodes-base.code");
  const fn = new Function("$input", "$", "$execution", n.parameters.jsCode as string);
  return fn(contexto.$input, contexto.$ ?? (() => ({ all: () => [] })), contexto.$execution) as Item[];
}

// Evalúa una expresión n8n de un solo bloque «={{ … }}» con el $json dado.
function expresion(texto: string, $json: Record<string, unknown>) {
  const m = /^=\{\{([\s\S]*)\}\}$/.exec(texto.trim());
  if (!m) throw new Error(`no es una expresión de un bloque: ${texto}`);
  return new Function("$json", `return (${m[1]});`)($json);
}

const destinos = (nombre: string) => agendamiento.connections[nombre]!.main.map((salida) => salida.map((d) => d.node));

// «Clasificar resultado de evaluación»: la entrada es la salida del Execute Workflow; las reservas, la salida «201» de
// «Según la reserva de evaluación» (respuesta completa del HTTP Request: { statusCode, body }).
function clasificar(casos: { salida: Record<string, unknown>; reserva: Record<string, unknown> }[]) {
  const entradas: Item[] = casos.map((c, i) => ({ json: c.salida, pairedItem: { item: i } }));
  const reservas: Item[] = casos.map((c) => ({ json: { statusCode: 201, body: c.reserva } }));
  return ejecutarCodigo(nodo("Clasificar resultado de evaluación"), {
    $input: { all: () => entradas },
    $: (nombre) => {
      expect(nombre).toBe("Según la reserva de evaluación");
      return { all: (salida: number) => (salida === 0 ? reservas : []) };
    },
  });
}

const caso = (nombre: string) => {
  const c = salidas.clasificar_resultado.find((x: { caso: string }) => x.caso === nombre);
  if (!c) throw new Error(`falta el caso «${nombre}» en los datos fijos`);
  return c;
};

describe("Rama evaluaciones del flujo agendamiento (n8n)", () => {
  it("HU0009-1.0 el webhook agendamiento separa el evento de evaluación { id_expediente, id_notificacion } del de la visita, y «Validar evento de evaluación» acepta solo esa forma con enteros de 1 a 2147483647 (ADR-16)", () => {
    expect(nodo("Webhook agendamiento").parameters.path).toBe("agendamiento");
    expect(destinos("Webhook agendamiento")).toEqual([["¿Evento de evaluación?"]]);
    expect(destinos("¿Evento de evaluación?")).toEqual([["Validar evento de evaluación"], ["Validar evento"]]);
    const cuerpos = [
      { id_expediente: 7, id_notificacion: 42 },
      { id_expediente: 2147483647, id_notificacion: 1 },
      { id_expediente: "7", id_notificacion: 42 },
      { id_expediente: 7, id_notificacion: 0 },
      { id_expediente: 7, id_notificacion: 2147483648 },
      { id_expediente: 7 },
      { id_expediente: 7, id_notificacion: 42, asunto: CENTINELA },
      { id_cita: 9 },
      null,
      [7, 42],
    ];

    const salida = ejecutarCodigo(nodo("Validar evento de evaluación"), { $input: { all: () => cuerpos.map((body) => ({ json: { body } })) } });

    expect(salida.map((i) => i.json)).toEqual([
      { valido: true, id_expediente: 7, id_notificacion: 42, tipo_evento: null },
      { valido: true, id_expediente: 2147483647, id_notificacion: 1, tipo_evento: null },
      ...Array.from({ length: 8 }, () => ({ valido: false, id_expediente: null, id_notificacion: null, tipo_evento: null })),
    ]);
    expect(JSON.stringify(salida)).not.toContain(CENTINELA);
    expect(destinos("¿Evento de evaluación válido?")).toEqual([["Responder 202 (evaluación)"], ["Responder 400 (evaluación inválida)"]]);
    expect(destinos("Responder 400 (evaluación inválida)")).toEqual([["Detener: evento de evaluación inválido"]]);
  });

  it("HU0009-1.0 el barrido de evaluaciones saca un ítem por aviso pendiente con un tipo admitido, solo con ids y sin id_notificacion (C52 incluido)", () => {
    expect(destinos("Cada minuto (evaluaciones)")).toEqual([["Pedir avisos de evaluación pendientes"]]);
    expect(String(nodo("Pedir avisos de evaluación pendientes").parameters.url)).toContain("/internal/evaluaciones/avisos-pendientes");
    const avisos = [
      ...TIPOS.map((tipo_evento, i) => ({ id_expediente: 10 + i, tipo_evento, asunto: CENTINELA })),
      { id_expediente: 20, tipo_evento: "visita_confirmada" },
      { id_expediente: "21", tipo_evento: "evaluaciones_confirmadas" },
      { id_expediente: 0, tipo_evento: "evaluaciones_confirmadas" },
    ];

    const items = ejecutarCodigo(nodo("Un ítem por aviso de evaluación"), { $input: { all: () => [{ json: { avisos } }] } });

    expect(items.map((i) => i.json)).toEqual(TIPOS.map((tipo_evento, i) => ({ id_expediente: 10 + i, id_notificacion: null, tipo_evento })));
    expect(JSON.stringify(items)).not.toContain(CENTINELA);
    expect(ejecutarCodigo(nodo("Un ítem por aviso de evaluación"), { $input: { all: () => [{ json: { avisos: [] } }] } })).toEqual([]);
  });

  it("HU0025-2.0 el barrido de evaluaciones también saca los avisos de la inasistencia y del dictamen (En observación y No apto, HU0010-2.0 y 3.0), solo con ids (ADR-25, C11)", () => {
    const NUEVOS = ["evaluacion_inasistencia", "dictamen_en_observacion", "dictamen_no_apto"];
    const avisos = NUEVOS.map((tipo_evento, i) => ({ id_expediente: 30 + i, tipo_evento, cuerpo: CENTINELA, conclusiones: CENTINELA }));

    const items = ejecutarCodigo(nodo("Un ítem por aviso de evaluación"), { $input: { all: () => [{ json: { avisos } }] } });

    expect(items.map((i) => i.json)).toEqual(NUEVOS.map((tipo_evento, i) => ({ id_expediente: 30 + i, id_notificacion: null, tipo_evento })));
    expect(JSON.stringify(items)).not.toContain(CENTINELA);
  });

  it("HU0009-2.0 «Reservar aviso de evaluación» manda { id_notificacion } en el camino del webhook y { tipo_evento } en el del barrido; un 409 va a «Sin acción (evaluación)» y un error, al registro del fallo", () => {
    const reservar = nodo("Reservar aviso de evaluación");
    expect(reservar.parameters.method).toBe("POST");
    expect(String(reservar.parameters.url)).toContain("/internal/expedientes/{{ $json.id_expediente }}/aviso-evaluacion");
    expect(JSON.parse(expresion(reservar.parameters.jsonBody, { id_expediente: 7, id_notificacion: 42, tipo_evento: null }))).toEqual({ id_notificacion: 42 });
    expect(JSON.parse(expresion(reservar.parameters.jsonBody, { id_expediente: 7, id_notificacion: null, tipo_evento: "evaluacion_reprogramada_responsable" }))).toEqual({
      tipo_evento: "evaluacion_reprogramada_responsable",
    });
    expect(reservar.onError).toBe("continueErrorOutput");
    expect(destinos("Reservar aviso de evaluación")).toEqual([["Según la reserva de evaluación"], ["Fallo al reservar aviso de evaluación"]]);
    expect(destinos("Según la reserva de evaluación")).toEqual([["Enviar aviso de evaluación"], ["Sin acción (evaluación)"], ["Fallo al reservar aviso de evaluación"]]);
    // El subflujo es notificacion-multicanal; su error no corta el barrido (C9, C41 4).
    const envio = nodo("Enviar aviso de evaluación");
    expect(envio.type).toBe("n8n-nodes-base.executeWorkflow");
    expect(envio.onError).toBe("continueRegularOutput");
    expect(JSON.stringify(envio.parameters)).toContain("notificacion-multicanal");
  });

  it("HU0009-2.0 «Clasificar resultado de evaluación» elige la rama de ADR-07 ante cada resultado de notificacion-multicanal, sin arrastrar el asunto, el cuerpo ni el mensaje del error (C11)", () => {
    const esperado: Record<string, { accion: string; motivo: string }> = {
      "envío exitoso": { accion: "enviado", motivo: "enviado" },
      "rechazo 550 del destinatario": { accion: "fallido", motivo: "rechazo_destinatario" },
      "error de conexión con Mailpit detenido": { accion: "pendiente", motivo: "smtp_pendiente" },
      "400 entrada inválida": { accion: "fallido", motivo: "entrada_invalida" },
      "502 contacto inexistente": { accion: "pendiente", motivo: "notificacion_no_disponible" },
      "502 con la API detenida": { accion: "pendiente", motivo: "notificacion_no_disponible" },
      "500 registro fallido (nodo HTTP sin conexión)": { accion: "pendiente", motivo: "notificacion_no_disponible" },
    };
    const casos = Object.keys(esperado).map((n, i) => ({
      nombre: n,
      salida: caso(n).salida_subflujo,
      reserva: { id_expediente: 900 + i, id_notificacion: 500 + i, tipo_evento: "evaluacion_reprogramada", asunto: CENTINELA, cuerpo: CENTINELA },
    }));
    casos.push({ nombre: "resultado desconocido", salida: { id_expediente: 1, cuerpo: CENTINELA }, reserva: { id_expediente: 999, id_notificacion: 599, tipo_evento: "evaluaciones_confirmadas", asunto: CENTINELA, cuerpo: CENTINELA } });
    casos.push({ nombre: "error con datos", salida: { error: `fallo con ${CENTINELA}` }, reserva: { id_expediente: 998, id_notificacion: 598, tipo_evento: "evaluaciones_confirmadas", asunto: CENTINELA, cuerpo: CENTINELA } });

    const resultado = clasificar(casos);

    expect(resultado.map((i) => i.json)).toEqual(
      casos.map((c) => ({
        ...(esperado[c.nombre] ?? (c.nombre === "error con datos" ? { accion: "pendiente", motivo: "notificacion_no_disponible" } : { accion: "pendiente", motivo: "resultado_desconocido" })),
        id_expediente: c.reserva.id_expediente,
        id_notificacion: c.reserva.id_notificacion,
      })),
    );
    expect(JSON.stringify(resultado)).not.toContain(CENTINELA);
    // enviado termina; fallido cierra con PATCH; pendiente (resultado desconocido) registra el fallo sin PATCH.
    expect(destinos("Según el resultado de la evaluación")).toEqual([["Aviso de evaluación enviado"], ["Marcar aviso de evaluación fallido"], ["Fallo al enviar aviso de evaluación"]]);
    expect(nodo("Marcar aviso de evaluación fallido").parameters.method).toBe("PATCH");
    expect(JSON.parse(expresion(nodo("Marcar aviso de evaluación fallido").parameters.jsonBody, {}))).toEqual({ estado_envio: "fallido" });
  });

  it("HU0009-2.0 los registros de fallo de la rama evaluaciones envían solo el flujo, el nodo y el id de la ejecución, y el flujo sigue sin guardar ejecuciones", () => {
    const entrada = [{ json: { error: `fallo con ${CENTINELA}`, body: { asunto: CENTINELA, cuerpo: CENTINELA } } }];
    for (const [nombre, nodoEsperado] of [
      ["Fallo al reservar aviso de evaluación", "Reservar aviso de evaluación"],
      ["Fallo al enviar aviso de evaluación", "Enviar aviso de evaluación"],
    ] as const) {
      const salida = ejecutarCodigo(nodo(nombre), { $input: { all: () => entrada }, $execution: { id: "1234" } });
      expect(salida.map((i) => i.json), nombre).toEqual([{ flujo: "agendamiento", nodo: nodoEsperado, id_ejecucion: "1234" }]);
      expect(destinos(nombre), nombre).toEqual([["Registrar fallo de evaluación en la API"]]);
    }
    expect(String(nodo("Registrar fallo de evaluación en la API").parameters.url)).toContain("/internal/errores-flujo");
    // Stop and Error de la rama: mensaje fijo, sin expresiones.
    expect(String(nodo("Detener: evento de evaluación inválido").parameters.errorMessage)).not.toContain("{{");
    expect(agendamiento.settings).toMatchObject({ errorWorkflow: "registro-errores", saveDataSuccessExecution: "none", saveDataErrorExecution: "none" });
  });
});
