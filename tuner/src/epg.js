import {gunzipSync} from 'node:zlib';
import {readFile,writeFile,mkdir,rename,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {escapeXml} from './hdhr.js';
import {channelConfigs} from './config.js';
import {xmltv} from './guide.js';
export const GUIDE_URL='https://nzxmltv.com/sky/guide-static.xml.gz';
const LIMIT=100*1024*1024;
function decode(s){return s.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi,(_,v)=>v[0]==='#'?String.fromCodePoint(v[1].toLowerCase()==='x'?parseInt(v.slice(2),16):Number(v.slice(1))):({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"})[v]);}
function attr(s,key){const match=s.match(new RegExp(`\\b${key}\\s*=\\s*(["'])(.*?)\\1`));return match?decode(match[2]):'';}
export function parseGuide(bytes){
 const data=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes);
 const xml=(data[0]===31&&data[1]===139?gunzipSync(data,{maxOutputLength:LIMIT}):data).toString('utf8');
 if(Buffer.byteLength(xml)>LIMIT||/<!ENTITY/i.test(xml)||!/<tv\b/.test(xml)||!/<\/tv>\s*$/.test(xml))throw Error('Invalid or oversized XMLTV guide');
 const channels=new Map();const clean=xml.replace(/<!--[\s\S]*?-->/g,'');
 for(const m of clean.matchAll(/<channel\b([^>]+)>([\s\S]*?)<\/channel>/g)){
  const id=attr(m[1],'id');const names=[...m[2].matchAll(/<display-name\b[^>]*>([^<]*)<\/display-name>/g)].map(x=>decode(x[1]));
  // The channel's logo, if the guide has one. Plex only shows logos from https addresses.
  const icon=attr((m[2].match(/<icon\b[^>]*>/)||[''])[0],'src');
  if(id&&names.length)channels.set(id,{id,name:names.find(n=>!/^\d+$/.test(n))||names[0],icon:/^https:\/\/[^\s"<>]+$/.test(icon)?icon:'',programmes:[]});
 }
 let end='',count=0;
 for(const m of clean.matchAll(/<programme\b([^>]+)>[\s\S]*?<\/programme>/g)){
  const c=channels.get(attr(m[1],'channel'));const stop=attr(m[1],'stop');const start=attr(m[1],'start');
  if(!c||!/^\d{14} [+-]\d{4}$/.test(stop)||!/^\d{14} [+-]\d{4}$/.test(start))continue;
  c.programmes.push(m[0]);count++;if(stop>end)end=stop;
 }
 if(!channels.size||!count)throw Error('No channels or dated programmes found in XMLTV');
 return {channels,count,end,xml};
}
export class GuideStore {
 constructor({directory,fetchImpl=fetch,log=()=>{}}={}){this.directory=directory;this.fetch=fetchImpl;this.log=log;this.data=null;this.updatedAt=null;this.error='';this.busy=false;}
 async load(){if(!this.directory)return;try{const file=await readFile(join(this.directory,'sky.xml'));this.data=parseGuide(file);this.updatedAt=(await stat(join(this.directory,'sky.xml'))).mtime.toISOString();}catch(e){if(e.code!=='ENOENT')this.error=e.message;}}
 status(){return {busy:this.busy,updatedAt:this.updatedAt,error:this.error,programmeCount:this.data?.count??0,through:this.data?.end??'',channels:this.data?[...this.data.channels.values()].map(({id,name})=>({id,name})):[]};}
 async import(bytes){const next=parseGuide(bytes);if(this.directory){await mkdir(this.directory,{recursive:true});const file=join(this.directory,'sky.xml');await writeFile(file+'.tmp',next.xml,'utf8');await rename(file+'.tmp',file);}this.data=next;this.updatedAt=new Date().toISOString();this.error='';}
 async refresh(){if(this.busy)return;this.busy=true;try{
  const res=await this.fetch(GUIDE_URL,{signal:AbortSignal.timeout(45000)});if(!res.ok)throw Error(`Guide download returned HTTP ${res.status}`);
  const parts=[];let size=0;for await(const chunk of res.body){size+=chunk.length;if(size>LIMIT)throw Error('Guide download too large');parts.push(chunk);}await this.import(Buffer.concat(parts));this.log('Sky programme guide updated.');
 }catch(e){this.error=e.message;this.log(`Guide refresh failed; retaining cached listings: ${e.message}`);}finally{this.busy=false;}}
 render(config){if(!config.guideEnabled||!this.data)return xmltv(config);
  const channelXml=[],programmes=[];
  for(const c of channelConfigs(config)){
   const id=`tohyee.${c.channelNumber}`;const match=this.data.channels.get(c.guideId);
   const icon=match?.icon?`<icon src="${escapeXml(match.icon)}"/>`:'';
   channelXml.push(`<channel id="${escapeXml(id)}"><display-name>${escapeXml(c.channelName)}</display-name><display-name>${escapeXml(c.channelNumber)}</display-name>${icon}</channel>`);
   if(match)for(const p of match.programmes)programmes.push(p.replace(/^(<programme\b[^>]*\bchannel\s*=)(["']).*?\2/,`$1"${escapeXml(id)}"`));
   else {const fallback=xmltv({...c,channels:undefined});programmes.push(...(fallback.match(/<programme\b[\s\S]*?<\/programme>/g)||[]));}
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<tv generator-info-name="Tohyee TV — NZXMLTV">${channelXml.join('\n')}\n${programmes.join('\n')}</tv>`;
 }
}
