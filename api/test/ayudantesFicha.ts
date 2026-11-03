// Fixtures de la ficha de inscripción (HU0005) con datos ficticios @ejemplo.test: una familia con cuenta de acceso y su
// expediente en `portal_habilitado`, el cuerpo de la ficha completa y los requisitos del grado. Cada prueba usa su propia
// campaña (crearApp({ campanaActiva })) para que los grados y requisitos no se mezclen entre pruebas.
import { randomUUID } from "node:crypto";
import request from "supertest";
import { vi } from "vitest";
import { crearApp } from "../src/app";
import type { Consultable } from "../src/db/pool";
import type { DisparadorN8n } from "../src/orquestacion/n8n";
import { crearFirmante, crearPersonal, unico } from "./ayudantes";
import { crearIdentidadFalsa } from "./identidadFalsa";

// DNI ficticios de 8 dígitos, distintos en toda la corrida (la BD de pruebas se recrea en cada corrida).
let siguiente = 10_000_000 + Math.floor(Math.random() * 60_000_000);
export const dniNuevo = () => String(siguiente++);

export async function entornoFicha(db: Consultable, firmante: Awaited<ReturnType<typeof crearFirmante>>) {
  const campana = `F${unico()}`; // 9 caracteres: cabe en varchar(10)
  const eventos = { disparar: vi.fn<DisparadorN8n["disparar"]>(async () => undefined) };
  const app = crearApp({ opcionesToken: firmante.opcionesToken, identidad: crearIdentidadFalsa().identidad, campanaActiva: campana, eventos });
  const subSecretaria = randomUUID();
  await crearPersonal(db, "secretaria", subSecretaria);
  const tokenSecretaria = await firmante.token(subSecretaria, ["secretaria"]);

  // Familia con cuenta de Keycloak y expediente en portal_habilitado (como lo deja G04, HU0004-1.0).
  async function familia(estado = "portal_habilitado", idGrado?: number) {
    const grado =
      idGrado ??
      (
        await db.query<{ id_grado: number }>(
          `INSERT INTO grado (nivel, nombre_grado, campana_admision, vacantes_autorizadas, vacantes_disponibles, monto_cuota_ingreso)
           VALUES ('primaria', $1, $2, 10, 10, 7000) RETURNING id_grado`,
          [`3.° de primaria ${unico()}`, campana],
        )
      ).rows[0]!.id_grado;
    const correo = `ficha-${unico()}@ejemplo.test`;
    const { rows: [a] } = await db.query<{ id_apoderado: number }>(
      `INSERT INTO apoderado (nombres, apellidos, telefono, correo)
       VALUES ('María Fernanda', 'Quispe Rojas', '+51987654321', $1) RETURNING id_apoderado`,
      [correo],
    );
    const sub = randomUUID();
    await db.query("INSERT INTO cuenta_acceso (id_apoderado, keycloak_user_id) VALUES ($1, $2::uuid)", [a!.id_apoderado, sub]);
    const { rows: [e] } = await db.query<{ id_expediente: number }>(
      "INSERT INTO expediente (id_apoderado_titular, id_grado, estado) VALUES ($1, $2, $3::estado_expediente) RETURNING id_expediente",
      [a!.id_apoderado, grado, estado],
    );
    return { idExpediente: e!.id_expediente, idApoderado: a!.id_apoderado, idGrado: grado, sub, correo, token: await firmante.token(sub, ["familia"]) };
  }

  const como = (token: string) => ({
    ver: (ruta: string) => request(app).get(ruta).set("Authorization", `Bearer ${token}`),
    guardar: (ruta: string, cuerpo: unknown) => request(app).put(ruta).set("Authorization", `Bearer ${token}`).send(cuerpo as object),
  });

  return { campana, app, eventos, tokenSecretaria, familia, como };
}

export const rutaFicha = (idExpediente: number) => `/familia/expedientes/${idExpediente}/ficha`;
export const rutaRequisitos = (idExpediente: number) => `/familia/expedientes/${idExpediente}/requisitos`;

type Parcial = Record<string, unknown>;

// La ficha completa de P05 y P05b, con DNI nuevos. `cambios` reemplaza secciones enteras.
export function fichaCompleta(cambios: Parcial = {}) {
  return {
    modo: "completa",
    postulante: {
      nombres: "Sofía Valentina",
      apellido_paterno: "Quispe",
      apellido_materno: "Rojas",
      dni: dniNuevo(),
      fecha_nacimiento: "2018-03-14",
      estudio_en_colegio_peruano: true,
      colegio_procedencia: "Colegio Ficticio",
      tiene_condicion_especial: false,
    },
    titular: { parentesco: "madre", dni: dniNuevo(), condicion_laboral: "dependiente" },
    segundo_apoderado: {
      parentesco: "padre",
      nombres: "José Luis",
      apellidos: "Quispe Huamán",
      dni: dniNuevo(),
      telefono: "986 432 175",
      correo: `padre-${unico()}@ejemplo.test`,
      condicion_laboral: "independiente",
    },
    respuestas: { p1: "Buscamos una formación integral.", p2: "Que aprenda inglés.", p3: "Comunicación con la familia." },
    ...cambios,
  };
}

// Requisito del grado, tal como lo deja G09 (HU0022).
export async function requisito(
  db: Consultable,
  idGrado: number,
  tipo: string,
  condicion: string,
  extra: Partial<{ categoria: string; porApoderado: boolean; obligatorio: boolean }> = {},
) {
  const { rows } = await db.query<{ id_requisito: number }>(
    `INSERT INTO requisito_documental (id_grado, tipo_documento, categoria, condicion_aplicacion, obligatorio, por_apoderado)
     VALUES ($1, $2, $3::categoria_requisito, $4::condicion_aplicacion, $5, $6) RETURNING id_requisito`,
    [idGrado, tipo, extra.categoria ?? "postulante_y_padres", condicion, extra.obligatorio ?? true, extra.porApoderado ?? false],
  );
  return rows[0]!.id_requisito;
}

export async function filaPostulante(db: Consultable, idExpediente: number) {
  const { rows } = await db.query(
    `SELECT p.*, e.estado::text AS estado_expediente
       FROM expediente e LEFT JOIN postulante p ON p.id_postulante = e.id_postulante
      WHERE e.id_expediente = $1`,
    [idExpediente],
  );
  return rows[0];
}
