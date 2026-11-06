// Barrido de la rama evaluaciones de agendamiento con los avisos del bloque 8 (HU0012 y HU0014; ADR-26), sin ejecutar n8n: extrae
// el jsCode del nodo Code del JSON versionado y lo ejecuta en Node, como n8nEvaluaciones.test.ts. Si un tipo se cae de su
// lista, el barrido lo descarta sin error y el aviso no se retoma. No usa la BD ni la red.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TIPOS_AVISO_EVALUACION } from "../src/repositories/evaluaciones";

const flujo = JSON.parse(readFileSync(resolve(import.meta.dirname, "..", "..", "n8n/workflows/agendamiento.json"), "utf8")) as {
  nodes: { name: string; parameters: { jsCode?: string } }[];
};
const nodo = flujo.nodes.find((n) => n.name === "Un ítem por aviso de evaluación")!;
const barrer = (avisos: unknown[]) => {
  const fn = new Function("$input", nodo.parameters.jsCode!);
  return fn({ all: () => [{ json: { avisos } }] }) as { json: { id_expediente: number; id_notificacion: null; tipo_evento: string } }[];
};

describe("HU0012 y HU0014 barrido de los avisos de la vacante y de la cuota", () => {
  it.each(["vacante_asignada", "lista_espera", "cuota_por_conciliar"])("HU0012-1.0 (n8n) el barrido deja pasar %s, sin id_notificacion, para que la API retome", (tipo_evento) => {
    expect(barrer([{ id_expediente: 7, tipo_evento }]).map((i) => i.json)).toEqual([{ id_expediente: 7, id_notificacion: null, tipo_evento }]);
  });

  it("HU0012-1.0 (n8n) el nodo admite todos los tipos que la API puede devolver y descarta uno desconocido", () => {
    const avisos = TIPOS_AVISO_EVALUACION.map((tipo_evento, i) => ({ id_expediente: i + 1, tipo_evento }));
    expect(barrer(avisos)).toHaveLength(TIPOS_AVISO_EVALUACION.length);
    expect(barrer([{ id_expediente: 7, tipo_evento: "desconocido" }])).toEqual([]);
  });
});
