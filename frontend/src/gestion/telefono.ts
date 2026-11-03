// Teléfono en G04 (S9, plan HU0002): un celular peruano (+51 y 9 dígitos que empiezan con 9) se muestra como en el
// mockup, «984 222 731»; cualquier otro número, en E.164 tal como lo guarda la API (ADR-17).
export function telefonoVisible(e164: string): string {
  const celular = /^\+51(9\d{2})(\d{3})(\d{3})$/.exec(e164);
  return celular ? celular.slice(1).join(" ") : e164;
}
