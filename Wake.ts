// "[Tag name] body" from a job, timer, work session, subagent or approval,
// "[name]" from an older subagent's report or another agent: the sender is
// read back from the text, so a message stored before reads the same

// one to deliver: its id makes it taken once; agent: whose chat it goes to
export type Wake = { id: string; agent: string; text: string };

type Tagged = "job" | "timer" | "session" | "subagent" | "approval";

type Kind = Tagged | "agent";

const TAGS: Record<Tagged, string> = { job: "Job", timer: "Timer", session: "Session", subagent: "Subagent", approval: "Approval" };

const READ = /^\[([^\]\n]+)\]\s*([\s\S]*?)\s*$/;

export function wake_text(kind: Kind, name: string, body: string): string {
  const tag = kind === "agent" ? "" : TAGS[kind] + " ";
  return "[" + tag + name + "]" + (kind === "timer" ? "\n" : " ") + body;
}

// who: what the brackets hold; kind: null for a subagent's or an agent's
export function wake_read(text: string): { kind: Tagged | null; who: string; text: string } | null {
  const m = READ.exec(text);
  if (m === null) {
    return null;
  }
  const kind = (Object.keys(TAGS) as Tagged[]).find((k) => m[1].startsWith(TAGS[k] + " ")) ?? null;
  return { kind, who: m[1], text: m[2] };
}

// a job's wake, told as agent's job, in a chat other than agent's
export function wake_relayed(text: string, agent: string): string {
  return text.replace("] ", "] " + agent + "'s job, ");
}
