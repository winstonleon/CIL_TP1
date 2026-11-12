<#--
  Definir o cambiar la contraseña (acción requerida UPDATE_PASSWORD). El tema distingue el cliente (ADR-02, D5-A):
  - portal-familias: P03b (HU0023-1.0), en p03b.ftl;
  - el personal (gestion-interna, enlace de HU0021): la página de keycloak.v2 sin cambios, copiada en
    login-update-password-padre.ftl.
-->
<#if client?? && client.clientId == "portal-familias">
  <#include "p03b.ftl">
<#else>
  <#include "login-update-password-padre.ftl">
</#if>
