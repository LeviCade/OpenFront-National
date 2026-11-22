import type { Intent } from "@openfront/engine-api/Schemas";
import type { NationalPactDisclosureViewData, NationalPublicPactView } from "@openfront/engine-api/game/NationalPactView";

export type PactIntent = Extract<Intent, {type:
  "national_found_pact" | "national_invite_pact" | "national_accept_pact" |
  "national_betray_pact" | "national_propose_pact_amendment" |
  "national_approve_pact_amendment" | "national_expel_pact"}>;
export type PactAction = PactIntent extends infer T ? T extends PactIntent ? Omit<T,"requestId"> : never : never;
export interface PactReceipt {
  type: PactIntent["type"]; actorId: string; recipientId: string; requestId: string;
  commandTargetId: string; tick: number; sequence: number; accepted: boolean; reason: string;
}
const types = new Set<string>(["national_found_pact","national_invite_pact","national_accept_pact",
  "national_betray_pact","national_propose_pact_amendment","national_approve_pact_amendment","national_expel_pact"]);
export function readPactReceipts(input: unknown, actor: string | null, tick: number): PactReceipt[] {
  if (!actor || !Array.isArray(input)) return [];
  const out: PactReceipt[] = [];
  for (const v of input) {
    if (!v || typeof v !== "object" || !types.has(v.type) || v.actorId !== actor ||
        v.recipientId !== actor || !/^[A-Za-z0-9_-]{1,64}$/.test(v.commandTargetId) ||
        typeof v.commandTargetId !== "string" || typeof v.requestId !== "string" ||
        !/^np_[0-9a-f]{32}$/.test(v.requestId) || !Number.isSafeInteger(v.tick) ||
        v.tick < 0 || v.tick > tick || !Number.isSafeInteger(v.sequence) || v.sequence < 0 ||
        typeof v.accepted !== "boolean" || !["accepted","actor-inactive","political-rule"].includes(v.reason) ||
        v.accepted !== (v.reason === "accepted")) continue;
    out.push({type:v.type,actorId:actor,recipientId:actor,requestId:v.requestId,
      commandTargetId:v.commandTargetId,tick:v.tick,sequence:v.sequence,accepted:v.accepted,reason:v.reason});
  }
  return out;
}
export function retainPactReceipts(previous: readonly PactReceipt[], incoming: readonly PactReceipt[], tick: number): PactReceipt[] {
  // Preserve contradictory receipts for the UI to reject, not first-wins.
  return [...new Map([...previous,...incoming].filter(v=>v.tick>=tick-200 && v.tick<=tick)
    .map(v=>[JSON.stringify(v),v])).values()].slice(-512);
}
export interface PactContext {
  actor: string; roster: readonly NationalPublicPactView[];
  disclosure: NationalPactDisclosureViewData;
  independentCandidates: readonly string[];
}
export function pactActionAllowed(action: PactAction, context: PactContext): boolean {
  const {actor,roster,disclosure,independentCandidates}=context;
  if (disclosure.recipientId !== actor || !/^[A-Za-z0-9_-]{1,64}$/.test(action.pactId)) return false;
  const pact=roster.find(p=>p.id===action.pactId);
  const privateView=disclosure.pacts.find(p=>p.pactId===action.pactId);
  if(action.type==="national_found_pact") return !pact && action.name.trim().length>0 && action.name.length<=64;
  if(!pact || !privateView) return false;
  if(action.type==="national_accept_pact") return privateView.relationship==="invited" && !pact.memberIds.includes(actor);
  if(privateView.relationship!=="member" || !pact.memberIds.includes(actor)) return false;
  switch(action.type) {
    case "national_invite_pact":
      return independentCandidates.includes(action.candidateId) && !pact.memberIds.includes(action.candidateId) &&
        (privateView.terms.admission==="unanimous" || pact.administratorId===actor);
    case "national_betray_pact": return true;
    case "national_propose_pact_amendment": return !privateView.pendingAmendment &&
      (action.administratorId===null || pact.memberIds.includes(action.administratorId));
    case "national_approve_pact_amendment": return !!privateView.pendingAmendment &&
      !privateView.pendingAmendment.approvedBy.includes(actor);
    case "national_expel_pact": return privateView.terms.expulsion==="leader" && pact.administratorId===actor &&
      action.memberId!==actor && pact.memberIds.includes(action.memberId);
  }
}
/** Bind consent to the exact visible current constitution/proposal, not merely ID. */
export function pactConsentKey(context: PactContext, pactId: string): string {
  return JSON.stringify([context.roster.find(p=>p.id===pactId)??null,
    context.disclosure.pacts.find(p=>p.pactId===pactId)??null]);
}
export function reconcilePactReceipt(receipts: readonly PactReceipt[], attempt: {
  requestId:string; actorId:string; pactId:string; type:PactIntent["type"]; tick:number;
}, tick:number): "pending"|"accepted"|"rejected"|"conflict"|"unknown" {
  const matching=receipts.filter(r=>r.requestId===attempt.requestId && r.actorId===attempt.actorId &&
    r.recipientId===attempt.actorId && r.commandTargetId===attempt.pactId && r.type===attempt.type &&
    r.tick>=attempt.tick && r.tick<=tick);
  const r=matching[0];
  if(r && matching.some(v=>JSON.stringify(v)!==JSON.stringify(r))) return "conflict";
  if(r) return r.accepted?"accepted":"rejected";
  return tick-attempt.tick>=200?"unknown":"pending";
}
