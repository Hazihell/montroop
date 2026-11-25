// Files the server imports, typed for tsc: the app's files as vite built
// them (ui/dist/files.ts, there only once built), the heads and the
// installer as files (Bun gives their paths); as text, the chat's first
// message.
declare module "*/dist/files.ts" { const files: Record<string, unknown>; export default files; }
declare module "*.css" { const path: string; export default path; }
declare module "*.svg" { const path: string; export default path; }
declare module "*.sh" { const path: string; export default path; }
declare module "*.md" { const text: string; export default text; }
