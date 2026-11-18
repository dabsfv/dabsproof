// brand.config.json lives at the repo root, outside this package's TypeScript root. Declaring
// the import here keeps the compiler inside src/; the bundler still inlines the file's values
// into dist/index.js, and index.ts checks their shape when the module loads.
declare module '*/brand.config.json' {
  const value: unknown;
  export default value;
}
