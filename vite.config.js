const { defineConfig } = require('vite');

module.exports = defineConfig({
  base: './',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});
