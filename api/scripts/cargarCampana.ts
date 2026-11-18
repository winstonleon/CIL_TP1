// Crea los grados y los requisitos documentales de una campaña nueva (C26, punto 1). Corre DENTRO del contenedor `api` (acceso a
// la base): `npm run campana:cargar -- <archivo.json> [--simular] [--responsable "<nombre>"]` (raíz del repo) le pasa el archivo por la
// entrada estándar y el responsable por CIL_RESPONSABLE (la carga real lo exige: sus eventos no tienen actor).
// Una sola transacción: queda todo o no queda nada; con --simular valida y deshace. Imprime solo conteos.
import { cerrarPool } from "../src/db/pool";
import { ErrorApi } from "../src/errores";
import { cargarCampana, validarResponsable } from "../src/services/cargaCampana";

async function entradaEstandar(): Promise<string> {
  const partes: Buffer[] = [];
  for await (const parte of process.stdin) partes.push(parte as Buffer);
  return Buffer.concat(partes).toString("utf8");
}

try {
  const simular = process.argv.slice(2).includes("--simular");
  const responsable = validarResponsable(process.env.CIL_RESPONSABLE, !simular);
  const r = await cargarCampana(await entradaEstandar(), { simular, responsable });
  console.log(
    simular
      ? `Simulación de la campaña ${r.campana}: se crearían ${r.grados} grados y ${r.requisitos} requisitos. No se escribió nada.`
      : `Campaña ${r.campana} cargada: ${r.grados} grados y ${r.requisitos} requisitos. Para usarla, CAMPANA_ACTIVA debe ser ${r.campana} (GUIA-INSTALACION.md, sección 9).`,
  );
} catch (error) {
  console.error(error instanceof ErrorApi ? `${error.codigo}: ${error.message}` : "No se pudo cargar la campaña");
  process.exitCode = 1;
} finally {
  await cerrarPool();
}
