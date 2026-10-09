---
paths:
  - "frontend/**"
---

# Reglas del frontend (Vue)

- Implementa contra el mockup aprobado de `docs/ui/` (código P0x, G0x o variante como P05b). Los archivos `.dc.html` son la fuente: lee sus etiquetas, campos, textos y colores, aunque no se puedan abrir fuera del lienzo. No rediseñes pantallas ni inventes campos que el mockup no tiene.
- Las pantallas P03, P03b, P03c y G01 **no son páginas de Vue**: son el tema de login de Keycloak (`infra/keycloak/themes/cil/`, FreeMarker). Vue solo redirige a Keycloak con `oidc-client-ts`.
- Identidad visual del CIL (TI 6.4): azul marino `#10326E` (estructura y acciones principales), dorado `#E9BD23` (acentos y elemento activo), amarillo claro `#FEE05B` (avisos). Tipografías: Fraunces (títulos) y Public Sans (texto). Define los colores como variables CSS.
- Referencia de escritorio: 1440 px, responsiva hasta móvil.
- Los valores que el mockup muestra entre corchetes (`[horarios]`, `[máx. fracciones]`) son configuración (HU0022). No los fijes en el código.
- Muestra los estados del trámite con los mismos nombres del mockup: conforme, en revisión, observado, pendiente.
- En la gestión interna, la navegación lateral muestra solo las opciones del rol de la sesión.
- Las llamadas HTTP pasan por un único cliente (`src/api/`), y las cookies de sesión se envían con `credentials: 'include'`.
