import * as path from "node:path";
import ts from "typescript";

const HERE = import.meta.dir;

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
  "Server.ts": [
    "Msg", "Chat", "Chat.open", "Chat.pick_name", "Chat.name", "Chat.you", "Chat.system", "Chat.share",
    "Chat.account", "Chat.say", "Chat.read", "Chat.posted", "Chat.queued", "Chat.pictured", "Chat.writing",
    "Chat.hold", "Chat.pieces", "Chat.voice", "Chat.begin", "Chat.leader", "Chat.leader_block", "Chat.ending",
    "Chat.finish", "Chat.from", "Chat.call", "Chat.ended", "Chat.check", "Chat.checked", "Chat.said",
    "Chat.message", "Chat.failed", "Chat.limits", "Chat.park", "Chat.go_on", "Chat.unpark", "Chat.note",
    "Chat.noted", "Chat.behind", "Chat.push", "Chat.log", "Chat.line_of", "Chat.later", "Chat.put",
    "Chat.started_unlogged", "Chat.mid_message", "Chat.flush", "Chat.talked", "Chat.talk_off", "Chat.used",
    "Chat.meter", "Chat.guess", "Chat.room", "Chat.model_name", "Chat.talk", "Chat.on", "Chat.limit",
    "Chat.ran", "Chat.waiting", "Chat.unanswered", "Chat.asks", "Chat.live", "Chat.subs_of", "Chat.sub_doing",
    "Chat.sub_view", "Chat.spawn", "Chat.sub_start", "Chat.sub_restart", "Chat.sub_kind", "Chat.sub_pick",
    "Chat.sub_shown", "Chat.sub_how", "Chat.sub_picked", "Chat.sub_meter", "Chat.sub_row", "Chat.sub_bytes",
    "Chat.sub_ask", "Chat.sub_put", "Chat.sub_on", "Chat.sub_done", "Chat.tell", "Chat.sub_gone",
    "Chat.sub_stop", "Chat.sub_sweep", "Chat.archived", "Chat.held", "Chat.report", "Chat.job_done",
    "Chat.seen", "Chat.opened", "Chat.phone", "Chat.ring", "Chat.after", "Chat.ingest", "Chat.batch",
    "Chat.built", "Chat.time", "Chat.keep", "Chat.resumed", "Chat.reads", "Chat.fresh", "Chat.done",
    "Chat.imported", "Chat.made", "Chat.copies", "Chat.progress", "Chat.digest", "Chat.go", "Chat.resume",
    "Chat.timed", "Chat.fire", "Chat.full", "Chat.running", "Chat.interrupt", "Chat.stop", "Chat.halted",
    "Chat.all", "Chat.send", "Chat.state", "Chat.sums", "Chat.waits", "Chat.offer", "Chat.change",
    "Chat.last", "Chat.real", "Chat.gist", "Chat.join", "Chat.greet", "Chat.opening", "Chat.answer",
    "Chat.fail", "Chat.ask", "Chat.apply", "Chat.act", "Chat.stop_recorded", "Chat.set_state", "Chat.pick_to",
    "Chat.no_plug", "Chat.plug", "Chat.post", "Chat.mark", "Chat.eye", "Chat.import_cover", "Chat.show",
    "Chat.blocks", "Chat.teach", "Chat.know", "Main", "Main.asked", "Main.approve", "Main.pin_sweep",
    "Main.pins", "Main.first", "Main.by_who", "Main.stored", "Main.own_picture", "Main.chat_of",
    "Main.keep_picks", "Main.offer", "Main.mates", "Main.team_soon", "Main.attach", "Main.leave",
    "Main.heard", "Main.made", "Main.knobs", "Main.lead_set", "Main.team", "Main.agent", "Main.manages",
    "Main.agents_tool", "Main.settings_of", "Main.shown", "Main.edited", "Main.revert", "Main.template",
    "Main.shelve", "Main.left", "Main.forget", "Main.lock", "Main.locked", "Main.file", "Main.navigated",
    "Main.page", "Main.room", "Main.media", "Main.http", "Main.post_only", "Main.event", "Main.start",
    "Main.settings", "Main.scratch_sweep", "Main.watch", "Main.follow", "Main.unowned", "Main.chats",
    "Main.socks", "Main.tools", "Main.server",
  ],
  "Service.ts": ["command"],
  "Tools.ts": [
    "Tools.base", "Tools.fetch", "Tools.answer", "Tools.asker", "Tools.gated", "Tools.shortened",
    "Tools.listed", "Tools.call", "Tools.seat", "Tools.schedule", "Tools.device_name", "Tools.sync",
    "Tools.jobs_gone", "Tools.detach_unless_back", "Tools.forget", "Tools.same_prefix_note", "Tools.plug",
    "Tools.live", "Tools.held", "Tools.open", "Tools.track", "Tools.report",
  ],
};

const config = ts.getParsedCommandLineOfConfigFile(HERE + "/tsconfig.json", {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => undefined });
if (config === undefined) {
  throw new Error("tsconfig.json can't be read");
}
const program = ts.createProgram(config.fileNames, config.options);
const checker = program.getTypeChecker();
const files = program.getSourceFiles().filter((file) => !file.isDeclarationFile && !file.fileName.includes("/node_modules/") && !file.fileName.endsWith(".config.ts"));

type Export = { name: string; rel: string; line: number; file: ts.SourceFile; used: boolean };

const exports = new Map<ts.Symbol, Export>();
const names = new Set<string>();

function own(sym: ts.Symbol): ts.Symbol {
  return checker.getExportSymbolOfSymbol(sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym);
}

function gather(owner: ts.Symbol, file: ts.SourceFile, prefix = ""): void {
  for (const sym of checker.getExportsOfModule(owner)) {
    const decl = sym.declarations?.find((d) => d.getSourceFile() === file);
    // `export { x } from "./Y.ts"` is Y's export
    if (decl === undefined || (ts.isExportSpecifier(decl) && decl.parent.parent.moduleSpecifier !== undefined)) {
      continue;
    }
    const name = prefix + (sym.name === "default" ? ts.getNameOfDeclaration(decl)?.getText() ?? "default" : sym.name);
    exports.set(own(sym), { name, rel: path.relative(HERE, file.fileName), line: file.getLineAndCharacterOfPosition(decl.getStart()).line + 1, file, used: false });
    names.add(sym.name);
    if (sym.flags & ts.SymbolFlags.Namespace) {
      gather(sym, file, name + ".");
    }
  }
}

for (const file of files) {
  const sym = checker.getSymbolAtLocation(file);
  if (sym !== undefined) {
    gather(sym, file);
  }
}

function resolved(id: ts.Identifier): ts.Symbol | undefined {
  const sym = ts.isShorthandPropertyAssignment(id.parent) ? checker.getShorthandAssignmentValueSymbol(id.parent) : checker.getSymbolAtLocation(id);
  return sym === undefined ? undefined : own(sym);
}

// what a file takes from a module it imports when it runs: `lazy(() =>
// import("./X.tsx"))` X's default, `lazyRouteComponent(() =>
// import("./X.tsx"), "Name")` its Name, and an import by a path built at
// run time, `(await import(path.join(dir, "X.ts"))) as { X: { f: … } }`,
// what its cast names
function mark_loaded(call: ts.CallExpression, file: ts.SourceFile): void {
  const [spec] = call.arguments;
  let up: ts.Node = call.parent;
  if (ts.isStringLiteral(spec)) {
    const mod = checker.getSymbolAtLocation(spec);
    while (ts.isArrowFunction(up) || ts.isParenthesizedExpression(up)) {
      up = up.parent;
    }
    if (mod !== undefined && ts.isCallExpression(up) && up.arguments.some((arg) => arg.pos <= call.pos && arg.end >= call.end)) {
      for (const name of ["default", ...up.arguments.filter(ts.isStringLiteral).map((arg) => arg.text)]) {
        mark_used(checker.tryGetMemberInModuleExports(name, mod), file);
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
    mark_used(sym, file);
    if (sym !== undefined && sym.flags & ts.SymbolFlags.Namespace) {
      for (const inner of checker.getTypeOfSymbol(prop).getProperties()) {
        mark_used(checker.tryGetMemberInModuleExports(inner.name, sym), file);
      }
    }
  }
}

function literals(node: ts.Node): string[] {
  return ts.isStringLiteral(node) ? [node.text] : node.getChildren().flatMap(literals);
}

function mark_used(sym: ts.Symbol | undefined, file: ts.SourceFile): void {
  const found = sym === undefined ? undefined : exports.get(own(sym));
  if (found !== undefined && found.file !== file) {
    found.used = true;
  }
}

for (const file of files) {
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && (names.has(node.text) || ts.isImportClause(node.parent))) {
      mark_used(resolved(node), file);
    }
    if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
      const key = node.propertyName ?? node.name;
      if (ts.isIdentifier(key)) {
        mark_used(checker.getTypeAtLocation(node.parent).getProperty(key.text), file);
      }
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments.length > 0) {
      mark_loaded(node, file);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
}

const unused = new Map([...exports.values()].filter((e) => !e.used).map((e) => [e.rel + " " + e.name, e]));
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
