import * as path from "node:path";
import ts from "typescript";

const ROOT = import.meta.dir;

// today's offenders, file by file: the list only shrinks
const LEGACY: Record<string, string[]> = {
  "Agent.ts": [
    "Agent.loop", "Agent.step", "Agent.steered", "Agent.entries_queued_till_started", "Agent.paired",
    "Agent.reset", "Agent.token", "Agent.room", "Agent.seat", "Agent.import_seated_elsewhere",
    "Agent.take_seat", "Agent.leave_seat", "Agent.give_way", "Agent.request", "Agent.send", "Agent.reason",
    "Agent.limited", "Agent.passing", "Agent.stream", "Agent.events", "Agent.use", "Agent.server",
    "Agent.notes_of", "Agent.call", "Agent.rpc",
  ],
  "Anthropic.ts": [
    "Anthropic.headers", "Anthropic.body", "Anthropic.message", "Anthropic.image", "Anthropic.read",
    "Anthropic.usage", "Anthropic.delta", "Anthropic.step", "Anthropic.sources", "Anthropic.cited",
    "Anthropic.docs", "Anthropic.entry", "Anthropic.server_echo", "Anthropic.result_text",
  ],
  "AskAI.ts": [
    "AskAI.falls", "AskAI.same", "AskAI.nap_till_woken", "AskAI.repicked", "AskAI.start", "AskAI.up",
    "AskAI.down", "AskAI.down_key", "AskAI.prefix_keys", "AskAI.view_blocks", "AskAI.warm_or_writing",
    "AskAI.rewarm", "AskAI.drop_cold", "AskAI.lead_flight",
  ],
  "ChatGPT.ts": [
    "Tokens", "Auth", "ChatGPT.claims", "ChatGPT.json", "ChatGPT.load", "ChatGPT.save", "ChatGPT.got",
    "ChatGPT.auth", "ChatGPT.due", "ChatGPT.token", "ChatGPT.busy", "ChatGPT.refreshed_elsewhere",
    "ChatGPT.refreshed_elsewhere_soon", "ChatGPT.save_unless_refreshed_elsewhere", "ChatGPT.refresh",
    "ChatGPT.exchange", "ChatGPT.device", "ChatGPT.logout", "ChatGPT.who", "ChatGPT.cli", "ChatGPT.body",
    "ChatGPT.unmark", "ChatGPT.headers", "ChatGPT.read", "ChatGPT.refusal", "ChatGPT.reset",
  ],
  "ClaudeSub.ts": [
    "SUMS", "ClaudeSub.carried", "ClaudeSub.platform", "ClaudeSub.extract_under_ki_dir",
    "ClaudeSub.with_tmpdir", "ClaudeSub.claim", "ClaudeSub.prune", "ClaudeSub.used", "ClaudeSub.sdk",
    "ClaudeSub.account", "ClaudeSub.limit_key", "ClaudeSub.sign_in", "ClaudeSub.env", "ClaudeSub.cli",
    "ClaudeSub.options", "ClaudeSub.mcp", "ClaudeSub.url", "ClaudeSub.slot", "ClaudeSub.grant",
    "ClaudeSub.free", "ClaudeSub.start", "ClaudeSub.close", "ClaudeSub.read", "ClaudeSub.connect",
    "ClaudeSub.reset", "ClaudeSub.note", "ClaudeSub.off", "ClaudeSub.run", "ClaudeSub.bin_on_disk",
    "ClaudeSub.first_message", "ClaudeSub.go_on", "ClaudeSub.died_before_saying", "ClaudeSub.after_tools",
    "ClaudeSub.limit_ended", "ClaudeSub.turn", "ClaudeSub.settle", "ClaudeSub.backs", "ClaudeSub.inbox",
  ],
  "Machine.ts": [
    "Machine.shell", "Machine.job_id", "Machine.fenced", "Machine.exit", "Machine.spawn_in_group_marked",
    "Machine.decoded_output", "Machine.read_into", "Machine.within", "Machine.group_may_hold_job",
    "Machine.halt", "Machine.sweep", "Machine.read", "Machine.head", "Machine.side", "Machine.image",
    "Machine.encoded", "Machine.image_as_is", "Machine.image_scaled", "Machine.video", "Machine.video_probe",
    "Machine.frame_times", "Machine.sheet_layout", "Machine.seek_plan", "Machine.rate", "Machine.exec",
    "Machine.write", "Machine.edit", "Machine.skills", "Machine.skill",
  ],
  "Mcp.ts": [
    "Mcp.tools", "Mcp.starting", "Mcp.kept", "Mcp.left_note", "Mcp.start", "Mcp.open", "Mcp.listed",
    "Mcp.schema", "Mcp.tell", "Mcp.say", "Mcp.out", "Mcp.close", "Mcp.name", "Mcp.reason", "Mcp.answer",
    "Mcp.texts", "Mcp.stdio", "Mcp.device", "Mcp.http",
  ],
  "Memory.ts": [
    "Memory.saved", "Memory.open", "Memory.queues", "Memory.index", "Memory.scan", "Memory.slot",
    "Memory.place", "Memory.read", "Memory.fd", "Memory.pread", "Memory.slice", "Memory.path", "Memory.file",
    "Memory.parse", "Memory.append", "Memory.root", "Memory.pages", "Memory.built", "Memory.down",
    "Memory.source", "Memory.part_of", "Memory.page_of", "Memory.ctx", "Memory.ready", "Memory.side",
    "Memory.store_fitting_at_once", "Memory.start_jobs", "Memory.todo", "Memory.running", "Memory.job",
    "Memory.build", "Memory.ask_till_fits", "Memory.cut_short", "Memory.shortest", "Memory.served",
    "Memory.store", "Memory.ask", "Memory.heard", "Memory.compact", "Memory.task", "Memory.over",
    "Memory.text", "Memory.size", "Memory.fit", "Memory.reach", "Memory.unshown", "Memory.end",
    "Memory.cover", "Memory.held", "Memory.due", "Memory.merge", "Memory.ref", "Memory.last",
    "Memory.talking", "Memory.upto", "Memory.said", "Memory.talk_line", "Memory.levels",
  ],
  "Owner.ts": [
    "FILE", "Owner.random", "Owner.ticket", "Owner.ticket_read", "Owner.code", "Owner.cookie", "Owner.https",
    "Owner.origin", "Owner.web_subscribe", "Owner.out", "Owner.confirm", "Owner.login", "Owner.relative",
    "Owner.page_login", "Owner.page_confirm", "Owner.safe", "Owner.page",
  ],
  "Push.ts": [
    "Push.gist", "Push.browsers", "Push.deliver", "Push.after", "Push.make_if_missing", "Push.read_keys",
    "Push.point", "Push.encrypt", "Push.ecdh", "Push.vapid", "Push.subject", "Push.send",
  ],
  "Server.ts": ["Msg", "Chat", "Main"],
  "Service.ts": ["command"],
  "Tools.ts": [
    "Tools.base", "Tools.fetch", "Tools.answer", "Tools.asker", "Tools.gated", "Tools.shortened",
    "Tools.listed", "Tools.call", "Tools.seat", "Tools.schedule", "Tools.device_name", "Tools.sync",
    "Tools.jobs_gone", "Tools.detach_unless_back", "Tools.forget", "Tools.same_prefix_note", "Tools.plug",
    "Tools.live", "Tools.held", "Tools.open", "Tools.track", "Tools.report",
  ],
};

const config = ts.getParsedCommandLineOfConfigFile(ROOT + "/tsconfig.json", {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => undefined });
if (config === undefined) {
  throw new Error("tsconfig.json can't be read");
}
const program = ts.createProgram(config.fileNames, config.options);
const checker = program.getTypeChecker();
const files = program.getSourceFiles().filter((file) => !file.isDeclarationFile && !file.fileName.includes("/node_modules/") && !file.fileName.endsWith(".config.ts"));

type Export = { name: string; rel: string; line: number; file: ts.SourceFile; within?: Export; used: boolean };

const exports = new Map<ts.Symbol, Export>();
const names = new Set<string>();

function gather(owner: ts.Symbol, file: ts.SourceFile, within?: Export): void {
  for (const sym of checker.getExportsOfModule(owner)) {
    const decl = sym.declarations?.find((d) => d.getSourceFile() === file);
    if (decl === undefined) {
      continue;
    }
    const name = (within === undefined ? "" : within.name + ".") + (sym.name === "default" ? ts.getNameOfDeclaration(decl)?.getText() ?? "default" : sym.name);
    const e: Export = { name, rel: path.relative(ROOT, file.fileName), line: file.getLineAndCharacterOfPosition(decl.getStart()).line + 1, file, within, used: false };
    exports.set(sym, e);
    names.add(sym.name);
    if (sym.flags & ts.SymbolFlags.Namespace) {
      gather(sym, file, e);
    }
  }
}

for (const file of files) {
  const sym = checker.getSymbolAtLocation(file);
  if (sym !== undefined) {
    gather(sym, file);
  }
}

function target(id: ts.Identifier): ts.Symbol | undefined {
  let sym = ts.isShorthandPropertyAssignment(id.parent) ? checker.getShorthandAssignmentValueSymbol(id.parent) : checker.getSymbolAtLocation(id);
  if (sym !== undefined && sym.flags & ts.SymbolFlags.Alias) {
    sym = checker.getAliasedSymbol(sym);
  }
  return sym === undefined ? undefined : checker.getExportSymbolOfSymbol(sym);
}

// what a file takes from a module it imports when it runs: `lazy(() =>
// import("./X.tsx"))` X's default, `lazyRouteComponent(() =>
// import("./X.tsx"), "Name")` its Name, and an import by a path built at
// run time, `(await import(path.join(dir, "X.ts"))) as { X: { f: … } }`,
// what its cast names
function loaded(call: ts.CallExpression, file: ts.SourceFile): void {
  const [spec] = call.arguments;
  let up: ts.Node = call.parent;
  if (ts.isStringLiteral(spec)) {
    const mod = checker.getSymbolAtLocation(spec);
    while (ts.isArrowFunction(up) || ts.isParenthesizedExpression(up)) {
      up = up.parent;
    }
    if (mod !== undefined && ts.isCallExpression(up) && up.arguments.some((arg) => arg.pos <= call.pos && arg.end >= call.end)) {
      for (const name of ["default", ...up.arguments.filter(ts.isStringLiteral).map((arg) => arg.text)]) {
        use(checker.tryGetMemberInModuleExports(name, mod), file);
      }
    }
    return;
  }
  const named = literals(spec).find((text) => /\.tsx?$/.test(text));
  const source = named === undefined ? undefined : program.getSourceFile(path.resolve(path.dirname(file.fileName), named));
  const mod = source === undefined ? undefined : checker.getSymbolAtLocation(source);
  while (ts.isAwaitExpression(up) || ts.isParenthesizedExpression(up)) {
    up = up.parent;
  }
  if (mod === undefined || !ts.isAsExpression(up)) {
    return;
  }
  for (const prop of checker.getTypeFromTypeNode(up.type).getProperties()) {
    const sym = checker.tryGetMemberInModuleExports(prop.name, mod);
    use(sym, file);
    if (sym !== undefined && sym.flags & ts.SymbolFlags.Namespace) {
      for (const inner of checker.getTypeOfSymbol(prop).getProperties()) {
        use(checker.tryGetMemberInModuleExports(inner.name, sym), file);
      }
    }
  }
}

function literals(node: ts.Node): string[] {
  return ts.isStringLiteral(node) ? [node.text] : node.getChildren().flatMap(literals);
}

function use(sym: ts.Symbol | undefined, file: ts.SourceFile): void {
  const found = sym === undefined ? undefined : exports.get(sym);
  if (found !== undefined && found.file !== file) {
    found.used = true;
  }
}

for (const file of files) {
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && (names.has(node.text) || ts.isImportClause(node.parent))) {
      use(target(node), file);
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments.length > 0) {
      loaded(node, file);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
}

// a namespace no other file uses is reported alone, not with its members
const unused = new Map([...exports.values()].filter((e) => !e.used && e.within?.used !== false).map((e) => [e.rel + " " + e.name, e]));
const legacy = new Set(Object.entries(LEGACY).flatMap(([rel, list]) => list.map((name) => rel + " " + name)));
const fresh = [...unused].filter(([key]) => !legacy.has(key)).map(([, e]) => e).sort((a, b) => a.rel.localeCompare(b.rel) || a.line - b.line);
const gone = [...legacy].filter((key) => !unused.has(key));
if (fresh.length > 0) {
  console.error("Exported, but no other file uses it: unexport it (a namespace's helper stays inside it, called by its bare name).\n" + fresh.map((e) => "  " + e.rel + ":" + e.line + " " + e.name).join("\n"));
}
if (gone.length > 0) {
  console.error("No longer an unused export: take it off LEGACY in Seams.ts.\n" + gone.map((key) => "  " + key).join("\n"));
}
process.exitCode = fresh.length + gone.length > 0 ? 1 : 0;
