// Solo para dev (npm run dev:agenda). Crea los horarios de la demo en la campaña activa, desde hoy hasta AGENDA_HASTA, con el
// servicio de G09 (ver agendaGenerador.ts). Misma guarda que dev:demo. Es seguro repetirlo: salta lo que ya existe.
// Imprime solo conteos.
import { cargarEntorno } from "../../scripts/lib/keycloak.mjs";
import { motivoFueraDeDev, prepararEntornoHost } from "../../scripts/lib/entornoLocal.mjs";

cargarEntorno();

const motivo = motivoFueraDeDev();
if (motivo) {
  console.error(`Abortado: ${motivo}. Este script es solo para dev.`);
  process.exit(1);
}

prepararEntornoHost();

const { obtenerConfig } = await import("../src/config");
const { cerrarPool, obtenerPool } = await import("../src/db/pool");
const { AGENDA_HASTA, ahoraEnLima, generarAgenda, leerCuentas, leerFeriados, planificarAgenda } = await import("./agendaGenerador");

try {
  const campana = obtenerConfig().CAMPANA_ACTIVA;
  const ahora = ahoraEnLima();
  const cuentas = await leerCuentas(obtenerPool());
  const { turnos, diasFeriado } = planificarAgenda(ahora.fecha, AGENDA_HASTA, leerFeriados(), ahora);
  const r = await generarAgenda(obtenerPool(), campana, cuentas, turnos);
  const total = Object.values(r.creados).reduce((a, b) => a + b, 0);
  console.log(`Agenda de la campaña ${campana}, del ${ahora.fecha} al ${AGENDA_HASTA}: ${total} horarios creados.`);
  for (const [tipo, n] of Object.entries(r.creados)) console.log(`  ${tipo}: ${n}`);
  console.log(`Saltados: ${r.yaExistian} ya existían, ${r.seCruzan} se cruzan con otro horario del responsable (no se tocan).`);
  console.log(`Días de lunes a viernes saltados por feriado: ${diasFeriado}.`);
} catch (e) {
  console.error(`Abortado. ${e instanceof Error ? e.message : "Error desconocido"} Lo creado hasta aquí queda; puedes volver a correrlo.`);
  process.exitCode = 1;
} finally {
  await cerrarPool();
}
