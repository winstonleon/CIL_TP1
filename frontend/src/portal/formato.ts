// Formatos de fecha y tamaño de P06 y P07b (zona horaria del colegio, como los mockups: «10/10/2026, 7:05 p. m.»).
const ZONA = "America/Lima";

const dia = new Intl.DateTimeFormat("es-PE", { timeZone: ZONA, day: "2-digit", month: "2-digit", year: "numeric" });
const diaHora = new Intl.DateTimeFormat("es-PE", {
  timeZone: ZONA,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

export const fechaCorta = (iso: string) => dia.format(new Date(iso));
export const fechaHora = (iso: string) => diaHora.format(new Date(iso));

// «AAAA-MM-DD» (un día sin hora, como `fecha_pago`) a «DD/MM/AAAA», sin pasar por zonas horarias.
export function fechaDeDia(aaaammdd: string): string {
  const [a, m, d] = aaaammdd.split("-");
  return a && m && d ? `${d}/${m}/${a}` : aaaammdd;
}

// El tamaño de la API viene en KB: «820 KB», «1,2 MB».
export function tamano(kb: number): string {
  if (kb < 1024) return `${kb} KB`;
  return `${(kb / 1024).toFixed(1).replace(".", ",")} MB`;
}

// Hoy en Lima como AAAA-MM-DD, para el máximo del campo «Fecha de pago».
export const hoyEnLima = () => new Intl.DateTimeFormat("en-CA", { timeZone: ZONA }).format(new Date());
