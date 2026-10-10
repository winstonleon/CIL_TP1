// S0-B9: separación de roles. La API se conecta como ADMISION_DB_USER (miembro de admision_app),
// sin ser dueña de nada; el esquema es del rol de migración (ADMISION_MIGRATOR_USER).
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { cerrarPool, obtenerPool } from "../src/db/pool";

afterAll(cerrarPool);
const db = () => obtenerPool();

const usuarioApi = process.env.ADMISION_DB_USER!;
const usuarioMigrador = process.env.ADMISION_MIGRATOR_USER!;
const basePrueba = process.env.ADMISION_DB!; // admision_test
const baseDesarrollo = basePrueba.replace(/_test$/, ""); // admision

function cliente(usuario: string, clave: string, base: string) {
  return new pg.Client({ host: process.env.POSTGRES_HOST, port: Number(process.env.POSTGRES_PORT), database: base, user: usuario, password: clave });
}

interface ErrorPg {
  code: string;
  message: string;
}

async function errorDe(promesa: Promise<unknown>): Promise<ErrorPg> {
  try {
    await promesa;
  } catch (e) {
    return e as ErrorPg;
  }
  throw new Error("Se esperaba un error de permisos y la operación se aceptó");
}

async function insertarEvento(c: pg.Pool | pg.Client) {
  const { rows } = await c.query<{ id_evento: string }>(
    "INSERT INTO registro_auditoria (tipo_evento, detalle) VALUES ('inicio_sesion', '{}') RETURNING id_evento",
  );
  return rows[0]!.id_evento;
}

describe("S0-B9 conexión del usuario de la API", () => {
  it("S0-B9 api_admision conecta a admision y a admision_test por el grupo admision_app, sin TEMPORARY", async () => {
    for (const base of [baseDesarrollo, basePrueba]) {
      const c = cliente(usuarioApi, process.env.ADMISION_DB_PASSWORD!, base);
      await c.connect();
      try {
        const { rows } = await c.query(
          `SELECT current_user AS usuario,
                  pg_has_role(current_user, 'admision_app', 'MEMBER') AS en_grupo,
                  has_database_privilege(current_user, current_database(), 'TEMPORARY') AS temporal`,
        );
        expect(rows[0]).toEqual({ usuario: usuarioApi, en_grupo: true, temporal: false });
      } finally {
        await c.end();
      }
    }
  });

  it("S0-B9 api_admision no puede crear tablas temporales", async () => {
    const e = await errorDe(db().query("CREATE TEMP TABLE intrusa (x int)"));
    expect(e.code).toBe("42501");
  });

  it("S0-B9 api_admision no es dueño de la base ni de ningún objeto del esquema public", async () => {
    const { rows } = await db().query(
      `WITH yo AS (SELECT oid FROM pg_roles WHERE rolname = current_user),
            pub AS (SELECT oid FROM pg_namespace WHERE nspname = 'public')
       SELECT (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = current_database()) AS duenio_base,
              (SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname = 'public') AS duenio_esquema,
              (SELECT count(*) FROM pg_class WHERE relnamespace = (SELECT oid FROM pub) AND relowner = (SELECT oid FROM yo))::int AS relaciones,
              (SELECT count(*) FROM pg_type WHERE typnamespace = (SELECT oid FROM pub) AND typowner = (SELECT oid FROM yo))::int AS tipos,
              (SELECT count(*) FROM pg_proc WHERE pronamespace = (SELECT oid FROM pub) AND proowner = (SELECT oid FROM yo))::int AS funciones`,
    );
    expect(rows[0]).toEqual({ duenio_base: usuarioMigrador, duenio_esquema: usuarioMigrador, relaciones: 0, tipos: 0, funciones: 0 });
  });
});

describe("S0-B9 la bitácora de auditoría no se puede alterar desde la API", () => {
  it("S0-B9 api_admision no puede desactivar el trigger de registro_auditoria", async () => {
    for (const sql of [
      "ALTER TABLE registro_auditoria DISABLE TRIGGER tg_auditoria_sin_update_delete",
      "ALTER TABLE registro_auditoria DISABLE TRIGGER ALL",
    ]) {
      const e = await errorDe(db().query(sql));
      expect(e.code).toBe("42501");
    }
    const { rows } = await db().query(
      "SELECT tgname, tgenabled FROM pg_trigger WHERE tgrelid = 'registro_auditoria'::regclass AND NOT tgisinternal ORDER BY tgname",
    );
    expect(rows).toEqual([
      { tgname: "tg_auditoria_sin_truncate", tgenabled: "O" },
      { tgname: "tg_auditoria_sin_update_delete", tgenabled: "O" },
    ]);
  });

  it("S0-B9 api_admision no puede hacer UPDATE, DELETE ni TRUNCATE en registro_auditoria: lo frena el permiso", async () => {
    const id = await insertarEvento(db());
    for (const [sql, params] of [
      ["UPDATE registro_auditoria SET detalle = '{\"x\":1}' WHERE id_evento = $1", [id]],
      ["DELETE FROM registro_auditoria WHERE id_evento = $1", [id]],
      ["TRUNCATE registro_auditoria", []],
    ] as const) {
      const e = await errorDe(db().query(sql, [...params]));
      expect(e.code).toBe("42501");
      expect(e.message).toMatch(/permission denied for table registro_auditoria/);
      expect(e.message).not.toMatch(/solo inserción/);
    }
  });

  it("S0-B9 sobre registro_auditoria la API solo tiene SELECT e INSERT", async () => {
    const privilegios = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"];
    const { rows } = await db().query(
      "SELECT p AS privilegio, has_table_privilege(current_user, 'registro_auditoria', p) AS tiene FROM unnest($1::text[]) AS p",
      [privilegios],
    );
    expect(Object.fromEntries(rows.map((r) => [r.privilegio, r.tiene]))).toEqual({
      SELECT: true, INSERT: true, UPDATE: false, DELETE: false, TRUNCATE: false, REFERENCES: false, TRIGGER: false,
    });
  });

  it("S0-B9 el trigger sigue rechazando UPDATE, DELETE y TRUNCATE aunque lo intente el dueño del esquema", async () => {
    const c = cliente(usuarioMigrador, process.env.ADMISION_MIGRATOR_PASSWORD!, basePrueba);
    await c.connect();
    try {
      const id = await insertarEvento(c);
      for (const [sql, params] of [
        ["UPDATE registro_auditoria SET detalle = '{\"x\":1}' WHERE id_evento = $1", [id]],
        ["DELETE FROM registro_auditoria WHERE id_evento = $1", [id]],
        ["TRUNCATE registro_auditoria", []],
      ] as const) {
        const e = await errorDe(c.query(sql, [...params]));
        expect(e.code).toBe("42501");
        expect(e.message).toMatch(/registro_auditoria es de solo inserción/);
      }
    } finally {
      await c.end();
    }
  });
});

describe("S0-B9 permisos de ejecución de la API", () => {
  it("S0-B9 api_admision no puede alterar, crear ni borrar tablas", async () => {
    for (const sql of [
      "ALTER TABLE expediente ADD COLUMN intrusa integer",
      "ALTER TABLE expediente DROP CONSTRAINT ck_expediente_posicion_lista_espera",
      "CREATE TABLE public.intrusa (x integer)",
      "DROP TABLE grado",
    ]) {
      const e = await errorDe(db().query(sql));
      expect(e.code).toBe("42501");
    }
  });

  it("S0-B9 api_admision conserva SELECT, INSERT, UPDATE y DELETE en las tablas de negocio, sin TRUNCATE", async () => {
    const { rows } = await db().query(
      `SELECT c.relname AS tabla,
              has_table_privilege(current_user, c.oid, 'SELECT') AND has_table_privilege(current_user, c.oid, 'INSERT')
              AND has_table_privilege(current_user, c.oid, 'UPDATE') AND has_table_privilege(current_user, c.oid, 'DELETE') AS crud,
              has_table_privilege(current_user, c.oid, 'TRUNCATE') AS truncate
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname NOT IN ('registro_auditoria', 'schema_migrations')
        ORDER BY 1`,
    );
    expect(rows).toHaveLength(18);
    expect(rows.filter((r) => !r.crud || r.truncate)).toEqual([]);

    const { rows: secuencias } = await db().query(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'S' AND NOT has_sequence_privilege(current_user, c.oid, 'USAGE')`,
    );
    expect(secuencias).toEqual([]);
  });

  it("S0-B9 api_admision no puede leer la tabla de control de migraciones", async () => {
    const e = await errorDe(db().query("SELECT * FROM schema_migrations"));
    expect(e.code).toBe("42501");
  });
});
