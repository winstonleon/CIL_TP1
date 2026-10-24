// apoderado: padre, madre o apoderado (modelo de datos v1.1). El DNI se cifra aquí y solo aquí, con crypto/columnas
// (rules/api.md, ADR-03, compromiso C3). P01 (HU0001) no pide DNI: queda nulo hasta la ficha P05b (HU0005).
// Este repositorio nunca devuelve dni_cifrado ni dni_hash.
import { columnasDni, hashDni } from "../crypto/columnas";
import type { Consultable } from "../db/pool";

export interface NuevoApoderado {
  nombres: string;
  apellidos: string;
  telefono: string; // E.164 (plan HU0001, P3)
  correo: string;
  dni?: string; // en claro; se guarda cifrado y con su hash
}

export async function insertarApoderado(db: Consultable, a: NuevoApoderado): Promise<number> {
  const dni = a.dni === undefined ? { dni_cifrado: null, dni_hash: null } : columnasDni(a.dni);
  const { rows } = await db.query<{ id_apoderado: number }>(
    `INSERT INTO apoderado (dni_cifrado, dni_hash, nombres, apellidos, telefono, correo)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id_apoderado`,
    [dni.dni_cifrado, dni.dni_hash, a.nombres, a.apellidos, a.telefono, a.correo],
  );
  return rows[0]!.id_apoderado;
}

// Búsqueda por DNI a través de dni_hash (ADR-03): el DNI cifrado no se puede comparar.
export async function existeApoderadoConDni(db: Consultable, dni: string): Promise<boolean> {
  const { rowCount } = await db.query("SELECT 1 FROM apoderado WHERE dni_hash = $1", [hashDni(dni)]);
  return (rowCount ?? 0) > 0;
}
