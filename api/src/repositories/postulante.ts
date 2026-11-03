// postulante: el menor que postula (modelo de datos v1.1). El DNI se cifra y se descifra aquí y solo aquí, con
// crypto/columnas (rules/api.md, ADR-03). Nunca devuelve dni_hash. La ficha es borrador mientras ficha_completa = false
// (HU0005-2.0); sus campos admiten nulos.
import { columnasDni, descifrar, hashDni } from "../crypto/columnas";
import type { Consultable } from "../db/pool";

export interface DatosPostulante {
  nombres: string | null;
  apellido_paterno: string | null;
  apellido_materno: string | null;
  dni: string | null; // en claro; se guarda cifrado y con su hash
  fecha_nacimiento: string | null; // AAAA-MM-DD
  estudio_en_colegio_peruano: boolean | null;
  colegio_procedencia: string | null;
  tiene_condicion_especial: boolean | null;
}

export interface FilaPostulante extends DatosPostulante {
  id_postulante: number;
  ficha_completa: boolean;
}

const dniColumnas = (dni: string | null) => (dni === null ? { dni_cifrado: null, dni_hash: null } : columnasDni(dni));

// estudio_en_colegio_peruano y tiene_condicion_especial admiten NULL (NULL = sin responder). El DEFAULT false se conserva
// solo por compatibilidad; toda inserción debe escribir NULL explícito si la pregunta no se respondió. Lo protege
// HU0005-2.0. Por eso los dos valores van siempre como parámetros, nunca se omiten de la sentencia.
export async function insertarPostulante(db: Consultable, d: DatosPostulante, fichaCompleta: boolean): Promise<number> {
  const dni = dniColumnas(d.dni);
  const { rows } = await db.query<{ id_postulante: number }>(
    `INSERT INTO postulante (dni_cifrado, dni_hash, nombres, apellido_paterno, apellido_materno, fecha_nacimiento,
                             ficha_completa, estudio_en_colegio_peruano, colegio_procedencia, tiene_condicion_especial)
     VALUES ($1, $2, $3, $4, $5, $6::date, $7, $8::boolean, $9, $10::boolean)
     RETURNING id_postulante`,
    [dni.dni_cifrado, dni.dni_hash, d.nombres, d.apellido_paterno, d.apellido_materno, d.fecha_nacimiento, fichaCompleta,
      d.estudio_en_colegio_peruano, d.colegio_procedencia, d.tiene_condicion_especial],
  );
  return rows[0]!.id_postulante;
}

// Reemplaza todos los campos de la ficha (el guardado es del estado completo del formulario; gana el último, ADR-20).
export async function actualizarPostulante(db: Consultable, id: number, d: DatosPostulante, fichaCompleta: boolean): Promise<void> {
  const dni = dniColumnas(d.dni);
  await db.query(
    `UPDATE postulante
        SET dni_cifrado = $2, dni_hash = $3, nombres = $4, apellido_paterno = $5, apellido_materno = $6,
            fecha_nacimiento = $7::date, ficha_completa = $8, estudio_en_colegio_peruano = $9::boolean,
            colegio_procedencia = $10, tiene_condicion_especial = $11::boolean
      WHERE id_postulante = $1`,
    [id, dni.dni_cifrado, dni.dni_hash, d.nombres, d.apellido_paterno, d.apellido_materno, d.fecha_nacimiento, fichaCompleta,
      d.estudio_en_colegio_peruano, d.colegio_procedencia, d.tiene_condicion_especial],
  );
}

export async function leerPostulante(db: Consultable, id: number): Promise<FilaPostulante | null> {
  const { rows } = await db.query<Omit<FilaPostulante, "dni"> & { dni_cifrado: string | null }>(
    `SELECT id_postulante, dni_cifrado, nombres, apellido_paterno, apellido_materno,
            to_char(fecha_nacimiento, 'YYYY-MM-DD') AS fecha_nacimiento, ficha_completa,
            estudio_en_colegio_peruano, colegio_procedencia, tiene_condicion_especial
       FROM postulante WHERE id_postulante = $1`,
    [id],
  );
  const fila = rows[0];
  if (!fila) return null;
  const { dni_cifrado, ...resto } = fila;
  return { ...resto, dni: dni_cifrado === null ? null : descifrar(dni_cifrado) };
}

// ¿Ya hay otro postulante (que no sea este) con ese DNI? Se busca por dni_hash (ADR-03).
export async function dniDePostulanteRepetido(db: Consultable, dni: string, excluirPostulante: number | null): Promise<boolean> {
  const { rowCount } = await db.query(
    "SELECT 1 FROM postulante WHERE dni_hash = $1 AND ($2::int IS NULL OR id_postulante <> $2)",
    [hashDni(dni), excluirPostulante],
  );
  return (rowCount ?? 0) > 0;
}

export interface VinculoApoderado {
  id_apoderado: number;
  parentesco: string;
}

export async function vinculosDePostulante(db: Consultable, idPostulante: number): Promise<VinculoApoderado[]> {
  const { rows } = await db.query<VinculoApoderado>(
    "SELECT id_apoderado, parentesco FROM postulante_apoderado WHERE id_postulante = $1 ORDER BY id_apoderado",
    [idPostulante],
  );
  return rows;
}

export async function fijarVinculo(db: Consultable, idPostulante: number, idApoderado: number, parentesco: string): Promise<void> {
  await db.query(
    `INSERT INTO postulante_apoderado (id_postulante, id_apoderado, parentesco) VALUES ($1, $2, $3)
     ON CONFLICT (id_postulante, id_apoderado) DO UPDATE SET parentesco = EXCLUDED.parentesco`,
    [idPostulante, idApoderado, parentesco],
  );
}

export async function quitarVinculo(db: Consultable, idPostulante: number, idApoderado: number): Promise<void> {
  await db.query("DELETE FROM postulante_apoderado WHERE id_postulante = $1 AND id_apoderado = $2", [idPostulante, idApoderado]);
}
