import { defineConfig } from "vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";

// @ton/core и @ton/crypto насквозь используют Buffer, которого в браузере нет.
// Полифилим только его и process — тянуть весь node-shim незачем.
export default defineConfig({
  plugins: [
    nodePolyfills({
      include: ["buffer"],
      globals: { Buffer: true, global: true, process: true },
    }),
  ],
  build: {
    target: "es2020",
    // Криптобиблиотеки крупные; разносим их, чтобы splash показался раньше.
    // В rolldown (Vite 8) manualChunks принимает только функцию.
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/@ton") || id.includes("node_modules/tweetnacl")) return "ton";
        },
      },
    },
  },
  server: {
    host: true, // чтобы открывать с телефона в локальной сети
  },
});
