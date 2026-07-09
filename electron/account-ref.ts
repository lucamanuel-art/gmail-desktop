// Re-export the pure account-ref model for Electron-side import paths. The
// implementation lives under renderer/ so Next.js can compile it too.
export * from '../renderer/lib/account-ref';
