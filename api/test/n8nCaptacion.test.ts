// C27 (D7, HU0002): verifica la rama que elige n8n ante cada resultado de notificacion-multicanal, sin ejecutar n8n.
// Extrae el jsCode de los nodos Code «Clasificar resultado» (captacion) y «Estado fallido» (notificacion-multicanal) del
// JSON versionado y lo ejecuta en Node con las salidas reales capturadas en n8n/pruebas/salidas-notificacion-multicanal.json
// (sin secretos ni datos personales). Además lee las conexiones del JSON: cada acción va al nodo que le corresponde.
// No usa la BD ni la red. Decisión de John (plan HU0002, «Verificación de D7 en n8n»).
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
}
interface Item {
  json: Record<string, any>;
}

const captacion: Flujo = leer("n8n/workflows/captacion.json");
const multicanal: Flujo = leer("n8n/workflows/notificacion-multicanal.json");
const salidas = leer("n8n/pruebas/salidas-notificacion-multicanal.json");

function nodo(flujo: Flujo, nombre: string): Nodo {
  const n = flujo.nodes.find((x) => x.name === nombre);
  if (!n) throw new Error(`falta el nodo «${nombre}»`);
  return n;
}

// Ejecuta el código de un nodo Code como lo haría n8n, con $input, $json y $('Nodo') simulados.
function ejecutarCodigo(n: Nodo, contexto: { $input?: unknown; $json?: unknown; $: (nombre: string) => unknown }) {
  expect(n.type).toBe("n8n-nodes-base.code");
  const fn = new Function("$input", "$json", "$", n.parameters.jsCode as string);
  return fn(contexto.$input, contexto.$json, contexto.$);
}

// «Clasificar resultado»: la entrada es la salida de «Enviar carpeta»; las reservas, la salida «reservada» de «¿Reserva hecha?».
function clasificar(casos: { salida_subflujo: Record<string, unknown>; reserva: Record<string, unknown> }[]) {
  const entradas: Item[] = casos.map((c) => ({ json: c.salida_subflujo }));
  const reservas: Item[] = casos.map((c) => ({ json: { statusCode: 201, body: c.reserva } }));
  return ejecutarCodigo(nodo(captacion, "Clasificar resultado"), {
    $input: { all: () => entradas },
    $: (nombre) => {
      expect(nombre).toBe("¿Reserva hecha?");
      return { all: (salida: number) => (salida === 0 ? reservas : []) };
    },
  }) as Item[];
}

const caso = (nombre: string) => {
  const c = salidas.clasificar_resultado.find((x: { caso: string }) => x.caso === nombre);
  if (!c) throw new Error(`falta el caso «${nombre}» en los datos fijos`);
  return c;
};

describe("C27 (D7) rama que elige n8n ante cada resultado de notificacion-multicanal", () => {
  it("C27 (D7) «Clasificar resultado» de captacion: un 400 de notificacion-multicanal lleva a «fallido», sin reintento", () => {
    const c = caso("400 entrada inválida");
    const [salida] = clasificar([c]);

    expect(salida!.json).toEqual({ accion: "fallido", motivo: "entrada_invalida", ...c.reserva });
    // «fallido» va a «Marcar fallida» (PATCH fallido, que el barrido no retoma) y después a un Stop and Error.
    const marcar = nodo(captacion, "Marcar fallida");
    expect(marcar.parameters.method).toBe("PATCH");
    expect(marcar.parameters.jsonBody).toContain("estado_envio: 'fallido'");
    expect(captacion.connections["Marcar fallida"]!.main[0]!.map((d) => d.node)).toEqual(["Detener: entrada rechazada"]);
    expect(nodo(captacion, "Detener: entrada rechazada").type).toBe("n8n-nodes-base.stopAndError");
  });

  it("C27 (D7) «Clasificar resultado» de captacion: un 502 (contacto inexistente o API caída) y un 500 llevan a «pendiente»", () => {
    const casos = [
      "502 contacto inexistente",
      "502 con la API detenida",
      "500 registro fallido (nodo HTTP sin conexión)",
      "500 registro fallido (nodo HTTP con 404)",
    ].map(caso);

    const salida = clasificar(casos);

    expect(salida.map((s) => s.json)).toEqual(
      casos.map((c) => ({ accion: "pendiente", motivo: "notificacion_no_disponible", ...c.reserva })),
    );
    // «pendiente» no cierra la fila: va directo a un Stop and Error (registro-errores) y la retoma el barrido.
    expect(nodo(captacion, "Detener: envío pospuesto").type).toBe("n8n-nodes-base.stopAndError");
  });

  it("C27 (D7) «Clasificar resultado» de captacion: el envío lleva a «enviado», el rechazo 550 a «rebote» y la caída de Mailpit a «pendiente»", () => {
    const casos = ["envío exitoso", "rechazo 550 del destinatario", "error de conexión con Mailpit detenido"].map(caso);

    const salida = clasificar(casos);

    expect(salida.map((s) => s.json)).toEqual([
      { accion: "enviado", motivo: "enviado", ...casos[0].reserva },
      { accion: "rebote", motivo: "rechazo_destinatario", ...casos[1].reserva },
      { accion: "pendiente", motivo: "smtp_pendiente", ...casos[2].reserva },
    ]);
    // Cada acción toma los ids de la reserva de su misma posición, y todos los casos de los datos fijos dan lo esperado.
    const todos = clasificar(salidas.clasificar_resultado);
    expect(todos.map((s) => s.json.accion)).toEqual(salidas.clasificar_resultado.map((c: { accion: string }) => c.accion));
    // El rechazo no lo cierra el subflujo: con la carpeta reservada solo cierra el envío exitoso, y la fila rechazada la
    // cierra POST /rebote en la misma transacción que el evento y la transición (si falla, la retoma el barrido).
    const cerrar = nodo(multicanal, "¿Cerrar la reservada?").parameters.conditions.conditions;
    expect(cerrar.map((x: { leftValue: string }) => x.leftValue)).toEqual(["={{ $json.estado_envio === 'enviado' }}"]);
    expect(multicanal.connections["¿Cerrar la reservada?"]!.main[0]!.map((d) => d.node)).toEqual(["Actualizar notificación"]);
  });

  it("C27 (D7) en captacion.json cada acción está conectada a su nodo y lo desconocido cae en «pendiente»", () => {
    const segun = nodo(captacion, "Según el resultado");
    const reglas = segun.parameters.rules.values as { outputKey: string; conditions: { conditions: { rightValue: unknown }[] } }[];
    const destino = (salida: number) => captacion.connections["Según el resultado"]!.main[salida]!.map((d) => d.node);
    const esperados: Record<string, string> = {
      enviado: "Carpeta enviada",
      rebote: "Registrar rebote",
      fallido: "Marcar fallida",
      pendiente: "Detener: envío pospuesto",
    };

    expect(reglas.map((r) => r.outputKey)).toEqual(Object.keys(esperados));
    reglas.forEach((r, i) => {
      expect(r.conditions.conditions[0]!.rightValue).toBe(r.outputKey);
      expect(destino(i)).toEqual([esperados[r.outputKey]]);
    });
    // Una acción que el Switch no reconozca sale por «pendiente».
    expect(segun.parameters.options.fallbackOutput).toBe(reglas.findIndex((r) => r.outputKey === "pendiente"));
    expect(nodo(captacion, "Registrar rebote").parameters.url).toMatch(/\/rebote$/);
    // Un resultado desconocido del subflujo también da «pendiente».
    const [desconocido] = clasificar([{ salida_subflujo: { correo: { estado_envio: "otro" } }, reserva: { id_expediente: 1, id_notificacion: 2 } }]);
    expect(desconocido!.json.accion).toBe("pendiente");
    // El error del subflujo llega por la salida normal de «Enviar carpeta» a «Clasificar resultado» (C9).
    expect(nodo(captacion, "Enviar carpeta").onError).toBe("continueRegularOutput");
    expect(captacion.connections["Enviar carpeta"]!.main[0]!.map((d) => d.node)).toEqual(["Clasificar resultado"]);
  });

  it("C27 (D7) «Estado fallido» de notificacion-multicanal: el 550 queda fallido y la caída de conexión pendiente; sin id_notificacion, todo fallo es fallido (Sprint 0)", () => {
    for (const c of salidas.estado_fallido) {
      const entrada = { id_expediente: c.error_envio.id_expediente, tipo_evento: "carpeta_enviada", id_notificacion: c.id_notificacion };
      const salida = ejecutarCodigo(nodo(multicanal, "Estado fallido"), {
        $json: c.error_envio,
        $: (nombre) => {
          expect(nombre).toBe("Normalizar y validar entrada");
          return { item: { json: entrada } };
        },
      }) as Item;

      expect(salida.json, c.caso).toEqual({
        id_expediente: c.error_envio.id_expediente,
        tipo_evento: "carpeta_enviada",
        canal: "correo",
        estado_envio: c.estado_envio,
      });
      // El texto del error (que puede traer la dirección de correo) no pasa a la salida.
      expect(JSON.stringify(salida.json)).not.toContain(c.error_envio.error);
    }
  });

  // Decisión de John (26/10/2026): solo es rebote 5.1.x, 5.2.x, o 550, 551 o 553 sin código extendido. Un 5.7.x es
  // política del servidor, no un destinatario inexistente: la carpeta queda pendiente y va a registro-errores.
  it("C27 (D7) «Estado fallido» de notificacion-multicanal: un rechazo 5.7.x queda pendiente (no es rebote)", () => {
    const c = salidas.estado_fallido.find((x: { caso: string }) => x.caso.startsWith("rechazo 5.7.1"));
    expect(c.error_envio.error).toMatch(/\b5\.7\.\d{1,3}\b/);

    const salida = ejecutarCodigo(nodo(multicanal, "Estado fallido"), {
      $json: c.error_envio,
      $: () => ({ item: { json: { id_expediente: c.error_envio.id_expediente, tipo_evento: "carpeta_enviada", id_notificacion: c.id_notificacion } } }),
    }) as Item;
    expect(salida.json.estado_envio).toBe("pendiente");

    // captacion lo trata como «pendiente»: sin PATCH, con Stop and Error (registro-errores) y retoma del barrido.
    const [clasificado] = clasificar([
      { salida_subflujo: { id_expediente: 17, correo: { estado_envio: "pendiente", id_notificacion: 45 }, whatsapp: "no_aplica" }, reserva: { id_expediente: 17, id_notificacion: 45 } },
    ]);
    expect(clasificado!.json).toEqual({ accion: "pendiente", motivo: "smtp_pendiente", id_expediente: 17, id_notificacion: 45 });
  });

  // Revisión de constructor-n8n (hallazgo 3): con executionOrder v1, n8n recorre las ramas hermanas de arriba abajo
  // (posición Y) y un Stop and Error detiene toda la ejecución. Las ramas que registran un resultado deben correr antes.
  it("C27 (D7) en captacion.json los Stop and Error van más abajo que las ramas que registran el resultado (con executionOrder v1 corren al final)", () => {
    const y = (nombre: string) => (nodo(captacion, nombre) as Nodo & { position: [number, number] }).position[1];
    expect((captacion as Flujo & { settings: { executionOrder: string } }).settings.executionOrder).toBe("v1");
    for (const registra of ["Registrar rebote", "Marcar fallida"]) {
      expect(y(registra), registra).toBeLessThan(y("Detener: envío pospuesto"));
    }
    expect(y("Registrar rebote")).toBeLessThan(y("Marcar fallida"));
    expect(y("Enviar carpeta")).toBeLessThan(y("Detener: reserva fallida"));
  });
});
