/**
 * Type shim for lucide-react.
 *
 * lucide-react@1.24.0 ships its declarations via the legacy `typings` field
 * (dist/lucide-react.d.ts) and has no `exports` map, which TypeScript's
 * "Bundler" module resolution does not pick up automatically (it resolves the
 * CJS `main` and reports an implicit-any). This redirects the bare-specifier
 * import to the real, fully-typed declaration file so we keep complete icon
 * typings without touching tsconfig.
 */
declare module 'lucide-react' {
  export * from 'lucide-react/dist/lucide-react'
}
