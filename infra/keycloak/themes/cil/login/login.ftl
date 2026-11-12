<#--
  Tema de login del CIL: un solo tema que distingue el cliente (ADR-02, HU0023, decisión D5-A de John):
  - portal-familias: P03 (acceso al portal) y P03c (cuenta bloqueada), en p03.ftl;
  - cualquier otro cliente (gestion-interna): G01 (acceso del personal), en g01.ftl, sin cambios desde HU0021.
  Sin `client` (p. ej. una página de error sin sesión de autenticación) se muestra G01, como hasta HU0023.
-->
<#if client?? && client.clientId == "portal-familias">
  <#include "p03.ftl">
<#else>
  <#include "g01.ftl">
</#if>
