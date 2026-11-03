// Calendario de P02 (HU0003) y formatos de fecha y hora de la visita, como en los mockups P02 y G04. Las fechas llegan
// de la API como «AAAA-MM-DD» en la hora de Lima: se calculan en UTC para no correrlas un día.
import type { HorarioVisita } from "../api/visita";

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
export const DIAS_SEMANA = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

const fechaUtc = (fecha: string) => new Date(`${fecha}T00:00:00Z`);
const mayuscula = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const dosDigitos = (n: number) => String(n).padStart(2, "0");

export interface Mes {
  anio: number;
  mes: number; // 0 = enero
}

export const fechaDe = (anio: number, mes: number, dia: number) => `${anio}-${dosDigitos(mes + 1)}-${dosDigitos(dia)}`;

export function mesDe(fecha: string): Mes {
  const d = fechaUtc(fecha);
  return { anio: d.getUTCFullYear(), mes: d.getUTCMonth() };
}

export function sumarMeses(m: Mes, n: number): Mes {
  const total = m.anio * 12 + m.mes + n;
  return { anio: Math.floor(total / 12), mes: total % 12 };
}

// «Octubre 2026»
export const nombreMes = (m: Mes) => `${mayuscula(MESES[m.mes]!)} ${m.anio}`;

// Celdas del mes de lunes a domingo: null para los huecos antes del día 1.
export function celdasDelMes(m: Mes): (string | null)[] {
  const primero = new Date(Date.UTC(m.anio, m.mes, 1));
  const huecos = (primero.getUTCDay() + 6) % 7;
  const dias = new Date(Date.UTC(m.anio, m.mes + 1, 0)).getUTCDate();
  return [...Array.from({ length: huecos }, () => null), ...Array.from({ length: dias }, (_, i) => fechaDe(m.anio, m.mes, i + 1))];
}

export const numeroDia = (fecha: string) => fechaUtc(fecha).getUTCDate();

// «jueves 15 de octubre»
export function diaYMes(fecha: string): string {
  const d = fechaUtc(fecha);
  return `${DIAS[d.getUTCDay()]} ${d.getUTCDate()} de ${MESES[d.getUTCMonth()]}`;
}

// «Jueves 15 de octubre de 2026»
export const fechaLarga = (fecha: string) => `${mayuscula(diaYMes(fecha))} de ${fechaUtc(fecha).getUTCFullYear()}`;

// «10:00» → «10:00 a. m.», «12:30» → «12:30 p. m.», «08:30» → «8:30 a. m.»
export function horaVisible(hora: string): string {
  const [h, m] = hora.split(":").map(Number) as [number, number];
  return `${((h + 11) % 12) + 1}:${dosDigitos(m)} ${h < 12 ? "a. m." : "p. m."}`;
}

// Horarios agrupados por día, en el orden de la API (por hora).
export function horariosPorDia(horarios: HorarioVisita[]): Map<string, HorarioVisita[]> {
  const mapa = new Map<string, HorarioVisita[]>();
  for (const h of horarios) mapa.set(h.fecha, [...(mapa.get(h.fecha) ?? []), h]);
  return mapa;
}

// Un día se resalta si tiene al menos un horario disponible.
export const diaDisponible = (mapa: Map<string, HorarioVisita[]>, fecha: string) => (mapa.get(fecha) ?? []).some((h) => h.disponible);

// El primer día con un horario disponible, o null.
export function primerDiaDisponible(horarios: HorarioVisita[]): string | null {
  return horarios.find((h) => h.disponible)?.fecha ?? null;
}
