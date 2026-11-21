import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

// Temporary, isolated pinned formatter capture for TWO files only.
// The scratch directory never modifies checkout source or hardware.
describe("E5 second-class final two-file pinned normalization", () => {
  it("captures exact oxfmt output on private scratch copies", () => {
    const files=[
      "scripts/national-qa/browser-r11-peer.mjs",
      "scripts/national-qa/browser-r11-political-verdict.mjs",
    ];
    const scratch=mkdtempSync(resolve(".e5-r11-final-format-"));
    try{
      for(const path of files){
        const target=resolve(scratch,path);
        mkdirSync(resolve(target,".."),{recursive:true});
        copyFileSync(path,target);
      }
      const result=spawnSync(
        resolve("node_modules/.bin/oxfmt"),
        ["--write",...files.map(path=>resolve(scratch,path))],
        {encoding:"utf8",timeout:30000,maxBuffer:1024*1024},
      );
      expect(result.error).toBeUndefined();
      expect(result.status, String(result.stderr)).toBe(0);
      for(const path of files){
        const encoded=readFileSync(resolve(scratch,path)).toString("base64");
        const chunks=Math.ceil(encoded.length/3700);
        for(let index=0;index<chunks;index++){
          console.info("E5_CLASS2_LAST_FORMAT "+JSON.stringify({
            path,index,chunks,payload:encoded.slice(index*3700,(index+1)*3700),
          }));
        }
      }
      console.info("E5_CLASS2_LAST_FORMAT_DONE="+files.length);
    }finally{rmSync(scratch,{recursive:true,force:true});}
  });
});