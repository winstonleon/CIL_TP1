---
paths:
  - "**/*.test.*"
  - "**/*.spec.*"
  - "e2e/**"
---

# Reglas de pruebas

- Cada escenario de aceptación tiene al menos una prueba, y el nombre de la prueba empieza con el ID exacto del escenario: `it('HU0017-2.0 mantiene el expediente en postulación si falta un documento', ...)`.
- Prueba el comportamiento observable por la interfaz pública (HTTP, pantalla). No pruebes detalles internos.
- Las pruebas de autorización por rol (403 y auditoría del intento) son obligatorias cuando la HU toca datos restringidos.
- Las pruebas no dependen de servicios externos reales: el correo va a Mailpit y n8n se simula o se usa la instancia de pruebas.
- No marques una prueba como `skip` para que la suite pase. Si falla, se reporta.
