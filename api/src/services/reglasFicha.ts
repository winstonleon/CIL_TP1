// Reglas de la ficha de inscripción de P05 y P05b (HU0005), sin acceso a la BD ni a la config: normaliza lo que envía la
// familia y lista lo que falta o está mal (`problemas`). El borrador (HU0005-2.0) guarda solo lo que ya es válido;
// «Guardar y continuar» (HU0005-1.0) exige que no quede ningún problema. Lo que escribe la familia nunca entra al SQL
// sin pasar por aquí.
import { normalizarDni } from "../crypto/columnas";
import { PREGUNTAS } from "./cuestionarioExpectativas";
import { correoValido, normalizarTelefono } from "./reglasSolicitud";

export const PARENTESCOS = ["madre", "padre", "apoderado", "otro"] as const;
export const CONDICIONES_LABORALES = ["dependiente", "independiente"] as const;

export type CodigoProblema = "OBLIGATORIO" | "FORMATO" | "DNI_FORMATO" | "DNI_REPETIDO_EN_FICHA" | "DNI_YA_REGISTRADO";
export interface Problema {
  campo: string;
  codigo: CodigoProblema;
}

type Texto = string | null | undefined;

export interface EntradaFicha {
  postulante: {
    nombres?: Texto;
    apellido_paterno?: Texto;
    apellido_materno?: Texto;
    dni?: Texto;
    fecha_nacimiento?: Texto;
    estudio_en_colegio_peruano?: boolean | null;
    colegio_procedencia?: Texto;
    tiene_condicion_especial?: boolean | null;
  };
  titular: { parentesco?: Texto; dni?: Texto; condicion_laboral?: Texto };
  segundo_apoderado?: {
    parentesco?: Texto;
    nombres?: Texto;
    apellidos?: Texto;
    dni?: Texto;
    telefono?: Texto;
    correo?: Texto;
    condicion_laboral?: Texto;
  } | null;
  respuestas: Record<string, string>;
}

export interface FichaNormalizada {
  postulante: {
    nombres: string | null;
    apellido_paterno: string | null;
    apellido_materno: string | null;
    dni: string | null;
    fecha_nacimiento: string | null;
    // null = sin responder (HU0005-2.0): se guarda NULL explícito, nunca el DEFAULT false.
    estudio_en_colegio_peruano: boolean | null;
    colegio_procedencia: string | null;
    tiene_condicion_especial: boolean | null;
  };
  titular: { parentesco: string | null; dni: string | null; condicion_laboral: string | null };
  // null = no hay segundo apoderado. `guardable`: trae lo que las columnas NOT NULL de apoderado y postulante_apoderado
  // exigen (nombres, apellidos, teléfono, correo y parentesco); si no, el bloque queda pendiente y no se guarda.
  segundo: {
    guardable: boolean;
    parentesco: string | null;
    nombres: string | null;
    apellidos: string | null;
    dni: string | null;
    telefono: string | null;
    correo: string | null;
    condicion_laboral: string | null;
  } | null;
  respuestas: Record<string, string>;
}

const texto = (v: Texto): string | null => {
  const t = v?.trim();
  return t ? t : null;
};

const elegir = <T extends string>(v: Texto, validos: readonly T[]): T | null => {
  const t = texto(v)?.toLowerCase();
  return validos.find((x) => x === t) ?? null;
};

// DNI de 8 dígitos o carné de extranjería de 9 a 12 caracteres (Q3 del plan, supuesto técnico). Se compara normalizado
// (sin espacios ni guiones, en mayúsculas), como lo guarda crypto/columnas.
export function dniConFormato(v: Texto): string | null {
  if (!texto(v)) return null;
  const dni = normalizarDni(v!);
  return /^\d{8}$/.test(dni) || /^[A-Z0-9]{9,12}$/.test(dni) ? dni : null;
}

// «AAAA-MM-DD», fecha real y anterior a hoy.
function fechaPasada(v: Texto): string | null {
  const t = texto(v);
  if (!t || !/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const fecha = new Date(`${t}T00:00:00Z`);
  if (Number.isNaN(fecha.getTime()) || fecha.toISOString().slice(0, 10) !== t) return null;
  return t < new Date().toISOString().slice(0, 10) && t >= "1900-01-01" ? t : null;
}

export function normalizarFicha(entrada: EntradaFicha): { ficha: FichaNormalizada; problemas: Problema[] } {
  const problemas: Problema[] = [];
  const falta = (campo: string, codigo: CodigoProblema = "OBLIGATORIO") => problemas.push({ campo, codigo });
  const dnisVistos = new Set<string>();

  // El primer DNI con formato válido se queda; el mismo número en otro campo de la ficha no se acepta.
  const dni = (campo: string, v: Texto): string | null => {
    if (!texto(v)) {
      falta(campo);
      return null;
    }
    const valido = dniConFormato(v);
    if (!valido) {
      falta(campo, "DNI_FORMATO");
      return null;
    }
    if (dnisVistos.has(valido)) {
      falta(campo, "DNI_REPETIDO_EN_FICHA");
      return null;
    }
    dnisVistos.add(valido);
    return valido;
  };
  const requerido = (campo: string, v: Texto): string | null => {
    const t = texto(v);
    if (!t) falta(campo);
    return t;
  };

  const p = entrada.postulante;
  const estudio = p.estudio_en_colegio_peruano ?? null;
  const condicion = p.tiene_condicion_especial ?? null;
  if (estudio === null) falta("postulante.estudio_en_colegio_peruano");
  if (condicion === null) falta("postulante.tiene_condicion_especial");
  const fecha = fechaPasada(p.fecha_nacimiento);
  if (!fecha) falta("postulante.fecha_nacimiento", texto(p.fecha_nacimiento) ? "FORMATO" : "OBLIGATORIO");
  const postulante = {
    nombres: requerido("postulante.nombres", p.nombres),
    apellido_paterno: requerido("postulante.apellido_paterno", p.apellido_paterno),
    apellido_materno: requerido("postulante.apellido_materno", p.apellido_materno),
    dni: dni("postulante.dni", p.dni),
    fecha_nacimiento: fecha,
    estudio_en_colegio_peruano: estudio,
    // «No estudió en otro colegio del Perú»: el nombre del colegio no aplica.
    colegio_procedencia: estudio === false ? null : estudio === true ? requerido("postulante.colegio_procedencia", p.colegio_procedencia) : texto(p.colegio_procedencia),
    tiene_condicion_especial: condicion,
  };

  const t = entrada.titular;
  const titular = {
    parentesco: elegir(t.parentesco, PARENTESCOS),
    dni: dni("titular.dni", t.dni),
    condicion_laboral: elegir(t.condicion_laboral, CONDICIONES_LABORALES),
  };
  if (!titular.parentesco) falta("titular.parentesco", texto(t.parentesco) ? "FORMATO" : "OBLIGATORIO");
  if (!titular.condicion_laboral) falta("titular.condicion_laboral", texto(t.condicion_laboral) ? "FORMATO" : "OBLIGATORIO");

  // El segundo padre o apoderado es opcional: si no trae nada, no existe; si trae algo, todos sus campos son obligatorios.
  const s = entrada.segundo_apoderado;
  const hayBloque = !!s && Object.values(s).some((v) => texto(v));
  let segundo: FichaNormalizada["segundo"] = null;
  if (s && hayBloque) {
    const telefono = texto(s.telefono) ? normalizarTelefono(texto(s.telefono)!) : null;
    const correo = texto(s.correo) && correoValido(texto(s.correo)!) ? texto(s.correo)! : null;
    const bloque = {
      parentesco: elegir(s.parentesco, PARENTESCOS),
      nombres: requerido("segundo_apoderado.nombres", s.nombres),
      apellidos: requerido("segundo_apoderado.apellidos", s.apellidos),
      dni: dni("segundo_apoderado.dni", s.dni),
      telefono,
      correo,
      condicion_laboral: elegir(s.condicion_laboral, CONDICIONES_LABORALES),
    };
    if (!bloque.parentesco) falta("segundo_apoderado.parentesco", texto(s.parentesco) ? "FORMATO" : "OBLIGATORIO");
    if (!telefono) falta("segundo_apoderado.telefono", texto(s.telefono) ? "FORMATO" : "OBLIGATORIO");
    if (!correo) falta("segundo_apoderado.correo", texto(s.correo) ? "FORMATO" : "OBLIGATORIO");
    if (!bloque.condicion_laboral) falta("segundo_apoderado.condicion_laboral", texto(s.condicion_laboral) ? "FORMATO" : "OBLIGATORIO");
    segundo = {
      ...bloque,
      guardable: !!(bloque.parentesco && bloque.nombres && bloque.apellidos && telefono && correo),
    };
  }

  const respuestas: Record<string, string> = {};
  for (const pregunta of PREGUNTAS) {
    const r = requerido(`respuestas.${pregunta.id}`, entrada.respuestas[pregunta.id]);
    if (r) respuestas[pregunta.id] = r;
  }

  return { ficha: { postulante, titular, segundo, respuestas }, problemas };
}
