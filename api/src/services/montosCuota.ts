// Monto de cada pago de la cuota de ingreso (R17, HU0013-1.0): partes iguales a dos decimales y la última absorbe los
// céntimos (supuesto 2 del plan del bloque 8). Se calcula en céntimos para no arrastrar errores de punto flotante.
export function montosDeFracciones(monto: number, fracciones: number): number[] {
  const centimos = Math.round(monto * 100);
  const parte = Math.floor(centimos / fracciones);
  return Array.from({ length: fracciones }, (_, i) => (i === fracciones - 1 ? centimos - parte * (fracciones - 1) : parte) / 100);
}
