import { createPinia } from "pinia";
import { createApp } from "vue";
import { createWebHistory } from "vue-router";
import App from "./App.vue";
import "./estilos/variables.css";
import { crearEnrutador } from "./router";

createApp(App).use(createPinia()).use(crearEnrutador(createWebHistory())).mount("#app");
