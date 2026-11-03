// apoderado: padre, madre o apoderado (modelo de datos v1.1). El DNI se cifra aquí y solo aquí, con crypto/columnas
// (rules/api.md, ADR-03, compromiso C3). P01 (HU0001) no pide DNI: queda nulo hasta la ficha P05b (HU0005).
// Este repositorio nunca devuelve dni_cifrado ni dni_hash.
import { columnasDni, descifrar, hashDni } from "../crypto/columnas";
import type { Consultable } from "../db/pool";

export interface NuevoApoderado {
  nombres: string;
  apellidos: string;
  telefono: string; // E.164 (plan HU0001, P3)
  correo: string;
  dni?: string; // en claro; se guarda cifrado y con su hash
  condicion_laboral?: string | null; // P05b (HU0005): del segundo padre o apoderado
}

export async function insertarApoderado(db: Consultable, a: NuevoApoderado): Promise<number> {
  const dni = a.dni === undefined ? { dni_cifrado: null, dni_hash: null } : columnasDni(a.dni);
  const { rows } = await db.query<{ id_apoderado: number }>(
    `INSERT INTO apoderado (dni_cifrado, dni_hash, nombres, apellidos, telefono, correo, condicion_laboral)
     VALUES ($1, $2, $3, $4, $5, $6, $7::condicion_laboral)
     RETURNING id_apoderado`,
    [dni.dni_cifrado, dni.dni_hash, a.nombres, a.apellidos, a.telefono, a.correo, a.condicion_laboral ?? null],
  );
  return rows[0]!.id_apoderado;
}

// Búsqueda por DNI a través de dni_hash (ADR-03): el DNI cifrado no se puede comparar.
export async function existeApoderadoConDni(db: Consultable, dni: string): Promise<boolean> {
  const { rowCount } = await db.query("SELECT 1 FROM apoderado WHERE dni_hash = $1", [hashDni(dni)]);
  return (rowCount ?? 0) > 0;
}

// P05b (HU0005): del titular solo se completan el DNI y la condición laboral; nombres, teléfono y correo vienen de P01.
export async function actualizarDatosFichaTitular(
  db: Consultable,
  idApoderado: number,
  d: { dni: string | null; condicion_laboral: string | null },
): Promise<void> {
  const dni = d.dni === null ? { dni_cifrado: null, dni_hash: null } : columnasDni(d.dni);
  await db.query(
    "UPDATE apoderado SET dni_cifrado = $2, dni_hash = $3, condicion_laboral = $4::condicion_laboral WHERE id_apoderado = $1",
    [idApoderado, dni.dni_cifrado, dni.dni_hash, d.condicion_laboral],
  );
}

// Reemplaza los datos del segundo padre o apoderado (el guardado es del estado completo del formulario).
export async function actualizarApoderadoFicha(db: Consultable, idApoderado: number, a: NuevoApoderado): Promise<void> {
  const dni = a.dni === undefined ? { dni_cifrado: null, dni_hash: null } : columnasDni(a.dni);
  await db.query(
    `UPDATE apoderado
        SET dni_cifrado = $2, dni_hash = $3, nombres = $4, apellidos = $5, telefono = $6, correo = $7,
            condicion_laboral = $8::condicion_laboral
      WHERE id_apoderado = $1`,
    [idApoderado, dni.dni_cifrado, dni.dni_hash, a.nombres, a.apellidos, a.telefono, a.correo, a.condicion_laboral ?? null],
  );
}

export interface FilaApoderadoFicha {
  id_apoderado: number;
  nombres: string;
  apellidos: string;
  telefono: string;
  correo: string;
  dni: string | null; // descifrado: solo lo lee la familia dueña del expediente
  condicion_laboral: string | null;
}

export async function leerApoderadoFicha(db: Consultable, idApoderado: number): Promise<FilaApoderadoFicha | null> {
  const { rows } = await db.query<Omit<FilaApoderadoFicha, "dni"> & { dni_cifrado: string | null }>(
    `SELECT id_apoderado, dni_cifrado, nombres, apellidos, telefono, correo, condicion_laboral::text AS condicion_laboral
       FROM apoderado WHERE id_apoderado = $1`,
    [idApoderado],
  );
  const fila = rows[0];
  if (!fila) return null;
  const { dni_cifrado, ...resto } = fila;
  return { ...resto, dni: dni_cifrado === null ? null : descifrar(dni_cifrado) };
}

// ¿Otro apoderado (que no sea uno de los excluidos) tiene ese DNI? Se busca por dni_hash (ADR-03).
export async function dniDeApoderadoRepetido(db: Consultable, dni: string, excluir: number[]): Promise<boolean> {
  const { rowCount } = await db.query("SELECT 1 FROM apoderado WHERE dni_hash = $1 AND id_apoderado <> ALL($2::int[])", [hashDni(dni), excluir]);
  return (rowCount ?? 0) > 0;
}

// Quita al segundo padre o apoderado cuando la familia lo borra de P05b. Si ya tiene documentos (HU0006), la fila se
// conserva: solo se quita su vínculo con el postulante.
export async function eliminarApoderadoSinDocumentos(db: Consultable, idApoderado: number): Promise<void> {
  await db.query(
    "DELETE FROM apoderado WHERE id_apoderado = $1 AND NOT EXISTS (SELECT 1 FROM documento WHERE id_apoderado = $1)",
    [idApoderado],
  );
}
