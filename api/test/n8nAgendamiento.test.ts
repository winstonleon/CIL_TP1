// agendamiento y seguimiento-recordatorios (HU0003 y HU0004) sin ejecutar n8n: extrae el jsCode de sus nodos Code del
// JSON versionado y lo ejecuta en Node, como n8nCaptacion.test.ts, con las salidas reales capturadas en
// n8n/pruebas/salidas-notificacion-multicanal.json. Verifica el contrato del evento (ADR-16), la rama que elige cada
// resultado de notificacion-multicanal (ADR-07), y A3 (D3): ningún Stop and Error ni Code arrastra el ítem, el asunto ni
// el cuerpo, donde viaja la contraseña temporal. No usa la BD ni la red.
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
const recordatorios: Flujo = leer("n8n/workflows/seguimiento-recordatorios.json");
const salidas = leer("n8n/pruebas/salidas-notificacion-multicanal.json");
const FLUJOS = [
  { nombre: "agendamiento", flujo: agendamiento, enviado: "Aviso enviado", noEntregado: "Aviso no entregado" },
  { nombre: "seguimiento-recordatorios", flujo: recordatorios, enviado: "Recordatorio enviado", noEntregado: "Recordatorio no entregado" },
];

const CENTINELA = "CENTINELA-D3";

function nodo(flujo: Flujo, nombre: string): Nodo {
  const n = flujo.nodes.find((x) => x.name === nombre);
  if (!n) throw new Error(`falta el nodo «${nombre}»`);
  return n;
}

// Ejecuta el código de un nodo Code como lo haría n8n, con $input, $json y $('Nodo') simulados.
function ejecutarCodigo(n: Nodo, contexto: { $input?: unknown; $json?: unknown; $?: (nombre: string) => unknown }) {
  expect(n.type).toBe("n8n-nodes-base.code");
  const fn = new Function("$input", "$json", "$", n.parameters.jsCode as string);
  return fn(contexto.$input, contexto.$json, contexto.$ ?? (() => ({ all: () => [] }))) as Item[];
}

const destinos = (flujo: Flujo, nombre: string) => flujo.connections[nombre]!.main.map((salida) => salida.map((d) => d.node));

// «Clasificar resultado»: la entrada es la salida del Execute Workflow; las reservas, la salida «reservado» de
// «¿Reserva hecha?» (respuesta completa del HTTP Request: { statusCode, body }).
function clasificar(flujo: Flujo, casos: { salida: Record<string, unknown>; reserva: Record<string, unknown> }[]) {
  const entradas: Item[] = casos.map((c, i) => ({ json: c.salida, pairedItem: { item: i } }));
  const reservas: Item[] = casos.map((c) => ({ json: { statusCode: 201, body: c.reserva } }));
  return ejecutarCodigo(nodo(flujo, "Clasificar resultado"), {
    $input: { all: () => entradas },
    $: (nombre) => {
      expect(nombre).toBe("¿Reserva hecha?");
      return { all: (salida: number) => (salida === 0 ? reservas : []) };
    },
  });
}

const caso = (nombre: string) => {
  const c = salidas.clasificar_resultado.find((x: { caso: string }) => x.caso === nombre);
  if (!c) throw new Error(`falta el caso «${nombre}» en los datos fijos`);
  return c;
};

describe("Flujos agendamiento y seguimiento-recordatorios (n8n)", () => {
  it("HU0003-1.0 «Validar evento» de agendamiento acepta solo { id_cita } con un entero de 1 a 2147483647 (ADR-16)", () => {
    const cuerpos = [
      { id_cita: 9 },
      { id_cita: 2147483647 },
      { id_cita: "9" },
      { id_cita: 0 },
      { id_cita: 1.5 },
      { id_cita: 2147483648 },
      { id_cita: 9, extra: 1 },
      {},
      null,
      [9],
    ];
    const salida = ejecutarCodigo(nodo(agendamiento, "Validar evento"), { $input: { all: () => cuerpos.map((body) => ({ json: { body } })) } });

    expect(salida.map((i) => i.json)).toEqual([
      { valido: true, id_cita: 9 },
      { valido: true, id_cita: 2147483647 },
      ...Array.from({ length: 8 }, () => ({ valido: false, id_cita: null })),
    ]);
    expect(destinos(agendamiento, "¿Evento válido?")).toEqual([["Responder 202"], ["Responder 400 (evento inválido)"]]);
    expect(destinos(agendamiento, "Responder 400 (evento inválido)")).toEqual([["Detener: evento inválido"]]);
    expect(nodo(agendamiento, "Webhook agendamiento").parameters.path).toBe("agendamiento");
  });

  it("HU0003-1.0 «Clasificar resultado» de agendamiento y de seguimiento-recordatorios elige la rama de ADR-07 ante cada resultado de notificacion-multicanal", () => {
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
    for (const { nombre, flujo, enviado, noEntregado } of FLUJOS) {
      const casos = Object.keys(esperado).map((n, i) => {
        const c = caso(n);
        return { nombre: n, salida: c.salida_subflujo, reserva: { ...c.reserva, id_cita: 100 + i, id_notificacion: 500 + i, id_expediente: 900 + i } };
      });
      casos.push({ nombre: "resultado desconocido", salida: { id_expediente: 1 }, reserva: { id_cita: 199, id_notificacion: 599, id_expediente: 999 } });

      const resultado = clasificar(flujo, casos);

      expect(resultado.map((i) => i.json), nombre).toEqual(
        casos.map((c) => ({
          ...(esperado[c.nombre] ?? { accion: "pendiente", motivo: "resultado_desconocido" }),
          id_cita: c.reserva.id_cita,
          id_expediente: c.reserva.id_expediente,
          id_notificacion: c.reserva.id_notificacion,
        })),
      );
      // Cada acción va a su nodo: enviado termina; fallido cierra con PATCH; pendiente (resultado desconocido) se detiene sin PATCH.
      expect(destinos(flujo, "Según el resultado"), nombre).toEqual([[enviado], ["Marcar fallido"], ["Detener: envío pospuesto"]]);
      expect(nodo(flujo, "Marcar fallido").parameters.method).toBe("PATCH");
      expect(destinos(flujo, "Marcar fallido")).toEqual([["Según el cierre"]]);
      expect(destinos(flujo, "Según el cierre"), nombre).toEqual([["Detener: entrada rechazada"], [noEntregado], ["Detener: cierre fallido"]]);
      expect(destinos(flujo, "¿Reserva hecha?")[1], nombre).toEqual(["Sin acción"]); // 409
    }
  });

  it("D3 ningún Stop and Error ni Code de agendamiento o seguimiento-recordatorios interpola el ítem, el asunto ni el cuerpo", () => {
    // Stop and Error: solo identificadores, el motivo y el estado HTTP.
    const PERMITIDO = /^(id_cita|id_notificacion|statusCode|motivo)$/;
    for (const { nombre, flujo } of FLUJOS) {
      for (const n of flujo.nodes.filter((x) => x.type === "n8n-nodes-base.stopAndError")) {
        const mensaje = String(n.parameters.errorMessage ?? "");
        const expresiones = [...mensaje.matchAll(/\{\{([\s\S]*?)\}\}/g)].map((m) => m[1]!);
        for (const x of expresiones) {
          expect(x, `${nombre} · ${n.name}`).not.toMatch(/JSON\.stringify|\$input|\$node|body|asunto|cuerpo|error/);
          const campos = [...x.matchAll(/(?:\$json|\.json)\.(\w+)/g)].map((m) => m[1]!);
          expect(campos.length, `${nombre} · ${n.name}: ${x}`).toBeGreaterThan(0);
          for (const campo of campos) expect(campo, `${nombre} · ${n.name}`).toMatch(PERMITIDO);
          expect(x.replace(/(?:\$json|\.json)\.\w+/g, ""), `${nombre} · ${n.name}`).not.toMatch(/\$json|\.json\b/);
        }
      }

      // Code: con un centinela en el asunto, el cuerpo, un campo extra y el mensaje de error, la salida no lo lleva.
      const reserva = { id_cita: 7, id_expediente: 8, id_notificacion: 9, tipo_evento: "credenciales_portal", asunto: CENTINELA, cuerpo: `Contraseña temporal: ${CENTINELA}` };
      const clasificado = clasificar(flujo, [
        { salida: { id_expediente: 8, correo: { estado_envio: "enviado", id_notificacion: 9 }, whatsapp: null, cuerpo: CENTINELA }, reserva },
        { salida: { error: `notificacion-multicanal: entrada inválida (${CENTINELA})` }, reserva },
        { salida: { error: `fallo con ${CENTINELA}` }, reserva },
      ]);
      expect(JSON.stringify(clasificado), `${nombre} · Clasificar resultado`).not.toContain(CENTINELA);
      const items = ejecutarCodigo(nodo(flujo, "Un ítem por cita"), { $input: { all: () => [{ json: { citas: [{ id_cita: 7, cuerpo: CENTINELA }] } }] } });
      expect(items.map((i) => i.json), `${nombre} · Un ítem por cita`).toEqual([{ id_cita: 7 }]);
      expect(JSON.stringify(items)).not.toContain(CENTINELA);

      // C9: el Execute Workflow continúa ante el error del subflujo; lo único que recibe el subflujo es la reserva.
      const envio = flujo.nodes.find((x) => x.type === "n8n-nodes-base.executeWorkflow")!;
      expect(envio.onError, nombre).toBe("continueRegularOutput");
      expect(flujo.settings, nombre).toMatchObject({ errorWorkflow: "registro-errores", saveDataSuccessExecution: "none", executionOrder: "v1" });
      expect(flujo.nodes.some((x) => x.type === "n8n-nodes-base.wait"), nombre).toBe(false);
    }
    const validado = ejecutarCodigo(nodo(agendamiento, "Validar evento"), { $input: { all: () => [{ json: { body: { id_cita: 9, cuerpo: CENTINELA } } }] } });
    expect(JSON.stringify(validado)).not.toContain(CENTINELA);
    // M1: agendamiento maneja la contraseña temporal y no guarda ninguna ejecución (D3); seguimiento-recordatorios sí guarda los errores.
    expect(agendamiento.settings).toMatchObject({ saveDataErrorExecution: "none" });
    expect(recordatorios.settings.saveDataErrorExecution).toBeUndefined();
  });
});
