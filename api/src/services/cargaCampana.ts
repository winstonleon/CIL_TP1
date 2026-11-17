// Carga de una campaña nueva en producción (C26, punto 1). La usa `npm run campana:cargar`, que corre dentro del contenedor `api`: crea
// los grados y los requisitos documentales de una campaña desde un archivo JSON (plantilla: db/campanas/plantilla-2027.json), en una
// sola transacción y solo si la campaña todavía no tiene grados (después se edita en G09, HU0022). Cada fila deja un evento
// `cambio_configuracion` de alta, sin id_personal (no hay una persona que actúe) y con el origen del comando.
// Los valores que el colegio aún no entregó (vacantes, fracciones, requisitos) van como null en la plantilla y se rechazan: nada se
// carga con datos inventados (modelo de datos §7).
import { z } from "zod";
import { enTransaccion, type Consultable } from "../db/pool";
import { ErrorApi } from "../errores";
import { insertarEvento } from "../repositories/auditoria";
import { bloquearCampana, contarGrados, insertarGrado } from "../repositories/grado";
import { insertarRequisito } from "../repositories/requisito";
import { CATEGORIAS_REQUISITO, CONDICIONES_APLICACION, CONDICIONES_POR_APODERADO } from "./configuracion";
import { CAMPANA_DEMO } from "./indicadores";
import { validarResponsable } from "./responsable";

export { validarResponsable };

const ORIGEN = "carga_campana";
const POR_DEFINIR = "por definir con el colegio";
const MAX_PROBLEMAS = 100;

export interface ResultadoCarga {
  campana: string;
  grados: number;
  requisitos: number;
  simulada: boolean;
}

// ------------------------------------------------------------------ forma del archivo

const mensajeNumero = (i: { input?: unknown }) => (i.input === null ? POR_DEFINIR : i.input === undefined ? "falta" : "debe ser un número");
const mensajeBooleano = (i: { input?: unknown }) => (i.input === null ? POR_DEFINIR : i.input === undefined ? "falta" : "debe ser true o false");

const texto = (max: number) => z.string({ error: "debe ser un texto" }).trim().min(1, "no puede estar vacío").max(max, `máximo ${max} caracteres`);
const entero = (min: number, max: number) =>
  z.number({ error: mensajeNumero }).int("debe ser un entero").min(min, `debe ser al menos ${min}`).max(max, `debe ser como máximo ${max}`);

// numeric(10,2) y ≥ 0: la cuota puede ser 0 (ADR-14).
const dinero = z
  .number({ error: mensajeNumero })
  .min(0, "no puede ser negativo")
  .max(99999999.99, "excede el máximo (numeric(10,2))")
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, "dos decimales como máximo")
  .transform((v) => v.toFixed(2));

const requisito = z.strictObject({
  tipo_documento: texto(80),
  categoria: z.enum(CATEGORIAS_REQUISITO, { error: `debe ser ${CATEGORIAS_REQUISITO.join(", ")}` }),
  condicion_aplicacion: z.enum(CONDICIONES_APLICACION, { error: `debe ser ${CONDICIONES_APLICACION.join(", ")}` }).default("todos"),
  obligatorio: z.boolean({ error: mensajeBooleano }).default(true),
  por_apoderado: z.boolean({ error: mensajeBooleano }).default(false),
});

const grado = z.strictObject({
  nivel: z.enum(["inicial", "primaria", "secundaria"], { error: "debe ser inicial, primaria o secundaria" }),
  nombre_grado: texto(50),
  vacantes_autorizadas: entero(0, 2147483647),
  requiere_jornada_observacion: z.boolean({ error: mensajeBooleano }),
  requiere_evaluacion_psicologica: z.boolean({ error: mensajeBooleano }),
  requiere_evaluacion_academica: z.boolean({ error: mensajeBooleano }),
  monto_cuota_ingreso: dinero,
  max_fracciones: entero(1, 32767),
  requisitos: z.array(requisito).default([]),
});

const archivo = z.strictObject({
  // El mismo formato que CAMPANA_ACTIVA (config.ts) y grado.campana_admision.
  campana: z.string({ error: "debe ser un texto" }).regex(/^[0-9A-Za-z-]{1,10}$/, "hasta 10 caracteres: letras, números y guiones"),
  requisitos_comunes: z.array(requisito).default([]),
  grados: z.array(grado).min(1, "debe tener al menos un grado").max(100, "máximo 100 grados"),
});

type Archivo = z.output<typeof archivo>;

const ruta = (path: readonly PropertyKey[]) =>
  path.map((p, i) => (typeof p === "number" ? `[${p}]` : i === 0 ? String(p) : `.${String(p)}`)).join("") || "archivo";

function problemaDeZod(i: z.core.$ZodIssue): string {
  if (i.code === "unrecognized_keys") return `${ruta(i.path)}: campo desconocido (${i.keys.join(", ")})`;
  return `${ruta(i.path)}: ${i.message}`;
}

// Reglas entre campos, sobre el archivo tal cual lo leyó JSON.parse: así salen junto con los errores de forma, en una sola respuesta.
type Crudo = Record<string, unknown>;
const esObjeto = (v: unknown): v is Crudo => typeof v === "object" && v !== null && !Array.isArray(v);
const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const nombreDeRequisito = (r: unknown) => (esObjeto(r) && typeof r.tipo_documento === "string" ? r.tipo_documento.trim().toLowerCase() : null);

function problemasEntreCampos(crudo: unknown): string[] {
  if (!esObjeto(crudo)) return [];
  const problemas: string[] = [];
  const comunes = lista(crudo.requisitos_comunes);

  const porApoderado = (r: unknown, donde: string) => {
    if (!esObjeto(r) || typeof r.condicion_aplicacion !== "string" || !CONDICIONES_POR_APODERADO.includes(r.condicion_aplicacion)) return;
    if (r.por_apoderado !== true) problemas.push(`${donde}.por_apoderado: debe ser true con la condición ${r.condicion_aplicacion}`);
  };
  // Único por grado sin distinguir mayúsculas (uq_requisito_grado_tipo_minusculas): los comunes cuentan en cada grado.
  const vistosComunes = new Set<string>();
  comunes.forEach((r, k) => {
    porApoderado(r, `requisitos_comunes[${k}]`);
    const n = nombreDeRequisito(r);
    if (n === null) return;
    if (vistosComunes.has(n)) problemas.push(`requisitos_comunes[${k}].tipo_documento: repetido (sin distinguir mayúsculas)`);
    vistosComunes.add(n);
  });

  const nombres = new Set<string>();
  lista(crudo.grados).forEach((g, i) => {
    if (!esObjeto(g)) return;
    if (typeof g.nombre_grado === "string") {
      const nombre = g.nombre_grado.trim();
      if (nombres.has(nombre)) problemas.push(`grados[${i}].nombre_grado: repetido`);
      nombres.add(nombre);
    }
    const propios = lista(g.requisitos);
    if (comunes.length + propios.length === 0) {
      problemas.push(`grados[${i}].requisitos: el grado no tiene requisitos (agrégalos aquí o en requisitos_comunes)`);
    }
    const vistos = new Set(vistosComunes);
    propios.forEach((r, k) => {
      porApoderado(r, `grados[${i}].requisitos[${k}]`);
      const n = nombreDeRequisito(r);
      if (n === null) return;
      if (vistos.has(n)) problemas.push(`grados[${i}].requisitos[${k}].tipo_documento: repetido (sin distinguir mayúsculas, también entre los comunes)`);
      vistos.add(n);
    });
  });
  return problemas;
}

export function leerArchivoCampana(contenido: string): Archivo {
  let crudo: unknown;
  try {
    crudo = JSON.parse(contenido.replace(/^\uFEFF/, ""));
  } catch {
    throw new ErrorApi(400, "ARCHIVO_INVALIDO", "El archivo no es un JSON válido");
  }
  const r = archivo.safeParse(crudo);
  const problemas = [...(r.success ? [] : r.error.issues.map(problemaDeZod)), ...problemasEntreCampos(crudo)];
  if (!r.success || problemas.length) {
    const mostrados = problemas.slice(0, MAX_PROBLEMAS).map((p) => `  - ${p}`);
    if (problemas.length > MAX_PROBLEMAS) mostrados.push(`  - … y ${problemas.length - MAX_PROBLEMAS} más`);
    throw new ErrorApi(
      422,
      "CARGA_INVALIDA",
      `El archivo no se puede cargar (${problemas.length} ${problemas.length === 1 ? "problema" : "problemas"}):\n${mostrados.join("\n")}`,
      problemas.slice(0, MAX_PROBLEMAS),
    );
  }
  return r.data;
}

// ------------------------------------------------------------------ carga

const CAMPOS_GRADO = [
  "nivel",
  "nombre_grado",
  "vacantes_autorizadas",
  "requiere_jornada_observacion",
  "requiere_evaluacion_psicologica",
  "requiere_evaluacion_academica",
  "monto_cuota_ingreso",
  "max_fracciones",
] as const;
const CAMPOS_REQUISITO = ["tipo_documento", "categoria", "condicion_aplicacion", "obligatorio", "por_apoderado"] as const;

// Como G09 (services/configuracion.ts): solo cambia lo que cambia; en un alta, `anterior` es null.
const cambiosDeAlta = (fila: object, campos: readonly string[]) =>
  Object.fromEntries(campos.map((c) => [c, { anterior: null, nuevo: (fila as Record<string, unknown>)[c] ?? null }]));

async function registrarAlta(db: Consultable, detalle: Record<string, unknown>, responsable?: string) {
  await insertarEvento(db, {
    tipoEvento: "cambio_configuracion",
    idPersonal: null,
    detalle: { ...detalle, accion: "alta", origen: ORIGEN, ...(responsable ? { responsable } : {}) },
  });
}

class Simulacion extends Error {}

// Con `simular` valida todo y hace todo dentro de la transacción, pero la deshace: informa lo que crearía sin escribir nada.
export async function cargarCampana(contenido: string, { simular, responsable }: { simular: boolean; responsable?: string }): Promise<ResultadoCarga> {
  const quien = validarResponsable(responsable, false);
  const datos = leerArchivoCampana(contenido);
  const { campana } = datos;
  if (campana === CAMPANA_DEMO) {
    throw new ErrorApi(422, "CAMPANA_RESERVADA", `La campaña ${CAMPANA_DEMO} es de los datos ficticios del tablero (dev:demo): usa otro código`);
  }

  const resultado = { campana, grados: 0, requisitos: 0, simulada: simular };
  try {
    await enTransaccion(async (c) => {
      await bloquearCampana(c, campana);
      if ((await contarGrados(c, campana)) > 0) {
        throw new ErrorApi(409, "CAMPANA_YA_CARGADA", `La campaña ${campana} ya tiene grados: se edita en G09 (Configuración de campaña)`);
      }
      for (const g of datos.grados) {
        const { requisitos, ...valores } = g;
        const fila = await insertarGrado(c, campana, valores);
        await registrarAlta(c, { entidad: "grado", id_grado: fila.id_grado, campana, cambios: cambiosDeAlta(fila, CAMPOS_GRADO) }, quien);
        resultado.grados++;
        for (const r of [...datos.requisitos_comunes, ...requisitos]) {
          const creado = await insertarRequisito(c, fila.id_grado, r);
          await registrarAlta(
            c,
            {
              entidad: "requisito_documental",
              id_requisito: creado.id_requisito,
              id_grado: fila.id_grado,
              campana,
              cambios: cambiosDeAlta(creado, CAMPOS_REQUISITO),
            },
            quien,
          );
          resultado.requisitos++;
        }
      }
      if (simular) throw new Simulacion();
    });
  } catch (e) {
    if (!(e instanceof Simulacion)) throw e;
  }
  return resultado;
}
