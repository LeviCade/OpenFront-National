// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  acceptRadialTarget,
  classifyFoundingEvidence,
  describePanel,
  distinctPeacePrincipal,
  unobstructedCanvasPoint,
} from "../../../scripts/national-qa/browser-r11-verdict.mjs";

function createPanel(expanded = true) {
  const panel = document.createElement("national-diplomacy-panel");
  const toggle = document.createElement("button");
  toggle.setAttribute("aria-controls", "national-diplomacy-content");
  toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
  panel.append(toggle);
  return {panel,toggle};
}
const input = {
  actorId: "a",
  empireId: "Empire_A",
  requestId: "fr_abc",
  issuedTick: 10,
  tick: 12,
  paused: false,
  snapshotTick: 12,
  uiConfirmed: true,
  results: [{
    type: "national_found_empire",
    actorId: "a",
    recipientId: "a",
    empireId: "Empire_A",
    requestId: "fr_abc",
    accepted: true,
    tick: 11,
    sequence: 5,
  }],
  publicEmpires: [{id:"Empire_A",leaderId:"a",memberIds:["a"]}],
};
describe("R11 E5 visual map input occlusion gate",()=>{
  it("reads an actual visible panel toggle, rejecting absent or invalid state",()=>{
    const {panel,toggle}=createPanel(true);
    expect(describePanel(toggle,panel)).toMatchObject({valid:true,expanded:true});
    toggle.setAttribute("aria-expanded","false");
    expect(describePanel(toggle,panel)).toMatchObject({valid:true,expanded:false});
    toggle.setAttribute("aria-expanded","unknown");
    expect(describePanel(toggle,panel).valid).toBe(false);
    expect(describePanel(null,panel).valid).toBe(false);
  });
  it("rejects a touch obscured by the actual panel and chooses only unobstructed canvas",()=>{
    const canvas=document.createElement("canvas");
    canvas.getBoundingClientRect=()=>({x:0,y:0,width:390,height:750});
    Object.defineProperty(document.documentElement,"clientWidth",{configurable:true,value:390});
    Object.defineProperty(document.documentElement,"clientHeight",{configurable:true,value:844});
    const modal=document.createElement("div");
    document.elementFromPoint=(_x,y)=>y<450?modal:canvas;
    expect(unobstructedCanvasPoint(document,canvas,[[0.5,0.2],[0.5,0.8]])).toEqual({x:195,y:600});
    document.elementFromPoint=()=>modal;
    expect(unobstructedCanvasPoint(document,canvas,[[0.5,0.8]])).toBeNull();
  });
});
describe("R11 E5 authentic founding lifecycle and ownership",()=>{
  it("accepts only actor-matched receipt, current public roster, and UI confirmation",()=>{
    expect(classifyFoundingEvidence(input)).toMatchObject({
      status:"accepted",reason:"AUTHENTIC_FOUNDING_AND_ROSTER",
    });
    expect(classifyFoundingEvidence({...input,uiConfirmed:false}).reason)
      .toBe("FOUNDING_UI_CONFIRMATION_MISSING");
    expect(classifyFoundingEvidence({...input,publicEmpires:[]}).reason)
      .toBe("FOUNDING_PUBLIC_ROSTER_MISSING");
  });
  it("separates paused tick, stalled tick, and missing result instead of timing out generically",()=>{
    expect(classifyFoundingEvidence({...input,results:[],tick:10,paused:true}).reason)
      .toBe("GAME_PAUSED_NO_FOUNDING_TICK");
    expect(classifyFoundingEvidence({...input,results:[],tick:10,paused:false}).reason)
      .toBe("GAME_TICK_NOT_ADVANCING");
    expect(classifyFoundingEvidence({...input,results:[],tick:12}).reason)
      .toBe("FOUNDING_RECEIPT_ABSENT");
  });
  it("fails closed on cross-actor, contradictory and negative engine receipts",()=>{
    const foreign={...input.results[0],recipientId:"b"};
    expect(classifyFoundingEvidence({...input,results:[foreign]}).reason)
      .toBe("FOUNDING_RECEIPT_ACTOR_MISMATCH");
    expect(classifyFoundingEvidence({...input,results:[
      input.results[0],{...input.results[0],accepted:false},
    ]}).reason).toBe("FOUNDING_CONTRADICTORY_RECEIPTS");
    expect(classifyFoundingEvidence({...input,results:[
      {...input.results[0],accepted:false},
    ]}).status).toBe("rejected");
    expect(classifyFoundingEvidence({...input,results:[{
      ...input.results[0],sequence:-1,
    }]}).reason).toBe("FOUNDING_RECEIPT_TICK_OR_SEQUENCE_INVALID");
    expect(classifyFoundingEvidence({...input,results:[{
      ...input.results[0],tick:9,
    }]}).status).toBe("blocked");

  });
});
describe("R11 E5 genuine radial and peace authority gates",()=>{
  it("cannot accept a radial action for a wrong target or disabled Attack",()=>{
    expect(acceptRadialTarget({expectedId:"enemy",actualId:"enemy",buttonEnabled:true}).accepted).toBe(true);
    expect(acceptRadialTarget({expectedId:"enemy",actualId:"other",buttonEnabled:true}).accepted).toBe(false);
    expect(acceptRadialTarget({expectedId:"enemy",actualId:"enemy",buttonEnabled:false}).reason)
      .toBe("RADIAL_ATTACK_DISABLED");
    expect(acceptRadialTarget({expectedId:"enemy",actualId:null,buttonEnabled:true}).accepted).toBe(false);
  });
  it("requires an opposing principal, exact unaccepted motion and active war",()=>{
    const motion={id:"m",proposedBy:"nation-a",layerId:"w",acceptedTick:null};
    const layer={id:"w",endedTick:null};
    const args={proposerId:"nation-a",acceptorId:"nation-b",motionId:"m",warId:"w",offeredMotion:motion,warLayer:layer};
    expect(distinctPeacePrincipal(args).accepted).toBe(true);
    expect(distinctPeacePrincipal({...args,acceptorId:"nation-a"}).reason).toBe("OPPOSING_PRINCIPAL_REQUIRED");
    expect(distinctPeacePrincipal({...args,warLayer:{...layer,endedTick:22}}).accepted).toBe(false);
    expect(distinctPeacePrincipal({...args,offeredMotion:{...motion,proposedBy:"someone-else"}}).accepted).toBe(false);
  });
});
