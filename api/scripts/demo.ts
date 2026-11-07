// Solo para dev (npm run dev:demo). Genera los datos ficticios del tablero G08 en la campaña DEMO (HU0019, D4-A).
// Se niega a correr fuera de dev y si la campaña ya existe. No se puede deshacer: la bitácora es de solo inserción, así que todo
// va en una transacción que se valida antes del COMMIT (ver demoGenerador.ts). Imprime solo cuántos expedientes creó.
import { cargarEntorno } from "../../scripts/lib/keycloak.mjs";
import { motivoFueraDeDev, prepararEntornoHost } from "../../scripts/lib/entornoLocal.mjs";

cargarEntorno();

const motivo = motivoFueraDeDev();
if (motivo) {
  console.error(`Abortado: ${motivo}. Este script es solo para dev.`);
  process.exit(1);
}

prepararEntornoHost();

const { cerrarPool, enTransaccion } = await import("../src/db/pool");
const { CAMPANA_DEMO } = await import("../src/services/indicadores");
const { generarDemo } = await import("./demoGenerador");

try {
  const { expedientes } = await enTransaccion((c) => generarDemo(c, CAMPANA_DEMO));
  console.log(`Demo creada: ${expedientes} expedientes ficticios en la campaña ${CAMPANA_DEMO}. Elígela en G08.`);
} catch (e) {
  console.error(`Abortado, no se escribió nada. ${e instanceof Error ? e.message : "Error desconocido"}`);
  process.exitCode = 1;
} finally {
  await cerrarPool();
}
