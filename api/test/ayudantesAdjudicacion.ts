// Fixtures del bloque 8 (HU0012 a HU0015): directora con su token, grados con vacantes y cuota propias, expedientes en `apto`
// y en `vacante_asignada`. Datos ficticios @ejemplo.test; n8n se simula con el disparador falso de entornoFicha.
// - `apto`: la precondición escrita por SQL (expediente en apto con su dictamen), para las pruebas cuyo foco es la
//   adjudicación. El camino real desde G06 lo prueba `HU0010-1.0 [parte: derivación]`.
// - `conVacante`: desde ahí todo es por las rutas reales: POST /direccion/expedientes/:id/adjudicacion.
import { randomUUID } from "node:crypto";
import type { Consultable } from "../src/db/pool";
import { insertarDictamen } from "../src/repositories/dictamen";
import { BANCOS } from "../src/services/derechoAdmision";
import { crearFirmante, crearPersonal, unico } from "./ayudantes";
import { pdf, subir } from "./ayudantesCarga";
import { entornoEvaluacion } from "./ayudantesEvaluacion";

type Firmante = Awaited<ReturnType<typeof crearFirmante>>;
type DatosGrado = Partial<{ autorizadas: number; disponibles: number; monto: number; maxFracciones: number; nivel: string }>;

export const rutaAdjudicacion = (id: number) => `/direccion/expedientes/${id}/adjudicacion`;
export const rutaDictamenDireccion = (id: number) => `/direccion/expedientes/${id}/dictamen`;
export const rutaCuota = (id: number) => `/familia/expedientes/${id}/cuota-ingreso`;
export const rutaModalidad = (id: number) => `${rutaCuota(id)}/modalidad`;

export async function entornoAdjudicacion(db: Consultable, firmante: Firmante) {
  const e = await entornoEvaluacion(db, firmante);
  const subDirectora = randomUUID();
  const directora = await crearPersonal(db, "directora", subDirectora);
  const tokenDirectora = await firmante.token(subDirectora, ["directora"]);

  async function grado(d: DatosGrado = {}) {
    const autorizadas = d.autorizadas ?? 10;
    const { rows } = await db.query<{ id_grado: number }>(
      `INSERT INTO grado (nivel, nombre_grado, campana_admision, vacantes_autorizadas, vacantes_disponibles, monto_cuota_ingreso, max_fracciones)
       VALUES ($1::nivel_educativo, $2, $3, $4, $5, $6, $7) RETURNING id_grado`,
      [d.nivel ?? "primaria", `3.° de primaria ${unico()}`, e.campana, autorizadas, d.disponibles ?? autorizadas, d.monto ?? 7000, d.maxFracciones ?? 3],
    );
    return rows[0]!.id_grado;
  }

  // Expediente en apto con su dictamen, en el grado dado o en uno nuevo.
  async function apto(idGrado?: number) {
    const f = await e.familia("apto", idGrado ?? (await grado()));
    await insertarDictamen(db, {
      idExpediente: f.idExpediente,
      idPersonal: e.psicologa,
      dictamen: "apto",
      conclusiones: "Conclusiones ficticias del dictamen",
      requisitosComplementarios: null,
      informeUrl: null,
    });
    return f;
  }

  const direccion = () => e.api(tokenDirectora);

  // Expediente con la vacante otorgada por la ruta real.
  async function conVacante(d: DatosGrado = {}) {
    const f = await apto(await grado(d));
    const res = await direccion().post(rutaAdjudicacion(f.idExpediente));
    if (res.status !== 200 || res.body.resultado !== "vacante_asignada") throw new Error(`Adjudicación de prueba fallida (${res.status})`);
    e.eventos.disparar.mockClear();
    return f;
  }

  const campos = (cambios: Record<string, string> = {}) => ({
    banco: BANCOS[0],
    numero_operacion: `OP-${unico()}`,
    fecha_pago: "2026-10-20",
    monto: "7000",
    ...cambios,
  });

  const comprobante = (f: { idExpediente: number; token: string }, cambios: Record<string, string> = {}, contenido = pdf("voucher de la cuota")) =>
    subir(e.app, rutaCuota(f.idExpediente), f.token, campos(cambios), contenido, "voucher.pdf");

  // Vacante, modalidad elegida y comprobante registrado: la cuota queda en conciliación.
  async function enConciliacion(d: DatosGrado = {}) {
    const f = await conVacante(d);
    const m = await e.familiaApi(f.token).post(rutaModalidad(f.idExpediente), { modalidad: "unico" });
    if (m.status !== 200) throw new Error(`Modalidad de prueba fallida (${m.status})`);
    const operacion = `OP-${unico()}`;
    const res = await comprobante(f, { numero_operacion: operacion });
    if (res.status !== 201) throw new Error(`Comprobante de prueba fallido (${res.status} ${JSON.stringify(res.body)})`);
    e.eventos.disparar.mockClear();
    return { f, operacion, idPago: res.body.pago.id_pago as number };
  }

  return { ...e, directora, subDirectora, tokenDirectora, grado, apto, direccion, conVacante, campos, comprobante, enConciliacion };
}
