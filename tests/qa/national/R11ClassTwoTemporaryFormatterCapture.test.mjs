import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

describe("E5 class-two isolated pinned source formatter capture",()=>{
  it("exports only exact normalized E5-owned SOURCE to deterministic log chunks",()=>{
    const paths=[
      "scripts/national-qa/browser-gameplay.mjs",
      "scripts/national-qa/browser-r11-peer.mjs",
      "scripts/national-qa/browser-r11-political-verdict.mjs",
      "scripts/national-qa/browser-verdict.mjs",
      "tests/qa/national/RoundElevenBrowserActions.test.mjs",
      "tests/qa/national/BrowserVerdict.test.mjs",
      "docs/release/NATIONAL_R11_E5_REAL_BROWSER_VERDICT.md",
    ];
    const scratch=mkdtempSync(resolve(".e5-class2-format-"));
    try{
      for(const path of paths){
        const target=resolve(scratch,path);
        mkdirSync(resolve(target,".."),{recursive:true});
        copyFileSync(path,target);
      }
      const formatted=spawnSync(
        resolve("node_modules/.bin/oxfmt"),
        ["--write",...paths.map(path=>resolve(scratch,path))],
        {encoding:"utf8",timeout:35000,maxBuffer:1024*1024},
      );
      expect(formatted.error).toBeUndefined();
      expect(formatted.status,String(formatted.stderr)).toBe(0);
      for(const path of paths){
        const b64=readFileSync(resolve(scratch,path)).toString("base64");
        const count=Math.ceil(b64.length/3800);
        for(let index=0;index<count;index++){
          console.info("E5_CLASS2_PINNED "+JSON.stringify({
            path,index,count,payload:b64.slice(index*3800,(index+1)*3800),
          }));
        }
      }
      console.info("E5_CLASS2_FORMAT_DONE="+paths.length);
    }finally{
      rmSync(scratch,{recursive:true,force:true});
    }
  });
});
