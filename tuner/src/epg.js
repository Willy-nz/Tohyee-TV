import {gunzipSync} from 'node:zlib';
import {readFile,writeFile,mkdir,rename,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {escapeXml} from './hdhr.js';
import {channelConfigs} from './config.js';
import {xmltv} from './guide.js';
export const GUIDE_URL='https://nzxmltv.com/sky/guide-static.xml.gz';
export const GUIDE_SOURCES = [
 {id:'sky',name:'Sky',url:GUIDE_URL},
 {id:'tvnz',name:'TVNZ+',url:'https://nzxmltv.com/iptv/tvnz-static.xml.gz'},
 {id:'threenow',name:'ThreeNow',url:'https://nzxmltv.com/iptv/threenow-static.xml.gz'}
];
const sourceForUrl = url => {
 try { return ({'www.skygo.co.nz':'sky','www.tvnz.co.nz':'tvnz','www.threenow.co.nz':'threenow'})[new URL(url).hostname]; } catch { return undefined; }
};
const normalName = name => String(name || '').toLowerCase().replace(/[^a-z0-9]/g,'').replace(/^tvnzduke$/, 'duke');
// Explicit mappings always win. Auto-match only an unambiguous channel name,
// preferring the guide for the same website as the captured video.
export function matchGuide(channels, channel) {
 if (channel.guideId) return channels.get(channel.guideId);
 const matches = [...channels.values()].filter(c => normalName(c.name) === normalName(channel.channelName));
 const preferred = matches.filter(c => c.source === sourceForUrl(channel.url));
 if (preferred.length === 1) return preferred[0];
 return matches.length === 1 ? matches[0] : undefined;
}
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
 constructor({directory,fetchImpl=fetch,log=()=>{}}={}){
  this.directory=directory;this.fetch=fetchImpl;this.log=log;this.data=null;
  this.updatedAt=null;this.error='';this.busy=false;this.feeds=new Map();this.errors=new Map();
 }
 rebuild(){
  const channels=new Map();let count=0,end='';
  for(const source of [...GUIDE_SOURCES,{id:'import',name:'Imported'}]){
   const feed=this.feeds.get(source.id);if(!feed)continue;
   for(const c of feed.data.channels.values()){
    // Preserve existing Sky and imported IDs. Namespace streaming guides so
    // overlapping IDs never replace another broadcaster's programme schedule.
    const id=['sky','import'].includes(source.id)?c.id:`${source.id}:${c.id}`;
    channels.set(id,{...c,id,source:source.id,sourceName:source.name});
   }
  }
  for(const c of channels.values())for(const p of c.programmes){count++;const stop=attr(p.slice(0,p.indexOf('>')+1),'stop');if(stop>end)end=stop;}
  this.data=channels.size?{channels,count,end}:null;
  const dates=[...this.feeds.values()].map(f=>f.updatedAt).sort();this.updatedAt=dates.at(-1)||null;
  this.error=[...this.errors].map(([id,error])=>`${id}: ${error}`).join('; ');
 }
 async load(){
  if(!this.directory)return;
  for(const id of [...GUIDE_SOURCES.map(s=>s.id),'import'])try{
   const file=join(this.directory,`${id}.xml`);
   this.feeds.set(id,{data:parseGuide(await readFile(file)),updatedAt:(await stat(file)).mtime.toISOString()});
  }catch(e){if(e.code!=='ENOENT')this.errors.set(id,e.message);}
  this.rebuild();
 }
 status(){return {busy:this.busy,updatedAt:this.updatedAt,error:this.error,programmeCount:this.data?.count??0,through:this.data?.end??'',
  sources:GUIDE_SOURCES.map(s=>({id:s.id,name:s.name,updatedAt:this.feeds.get(s.id)?.updatedAt||null,error:this.errors.get(s.id)||'',programmeCount:this.feeds.get(s.id)?.data.count||0})),
  channels:this.data?[...this.data.channels.values()].map(({id,name,sourceName})=>({id,name:['Sky','Imported'].includes(sourceName)?name:`${name} (${sourceName})` })):[]};}
 async save(id,bytes){
  const next=parseGuide(bytes);
  if(this.directory){await mkdir(this.directory,{recursive:true});const file=join(this.directory,`${id}.xml`);await writeFile(file+'.tmp',next.xml,'utf8');await rename(file+'.tmp',file);}
  this.feeds.set(id,{data:next,updatedAt:new Date().toISOString()});this.errors.delete(id);this.rebuild();
 }
 async import(bytes){
  if(this.busy)throw Error('Wait for the current guide download to finish.');
  this.busy=true;try{await this.save('import',bytes);}finally{this.busy=false;}
 }
 async refresh(){
  if(this.busy)return;this.busy=true;
  try{
   // Each provider has an independent cache: a failed download never discards
   // its previous schedule or blocks successful updates from the other sites.
   for(const source of GUIDE_SOURCES)try{
    const res=await this.fetch(source.url,{signal:AbortSignal.timeout(45000)});
    if(!res.ok)throw Error(`Guide download returned HTTP ${res.status}`);
    const parts=[];let size=0;
    for await(const chunk of res.body){size+=chunk.length;if(size>LIMIT)throw Error('Guide download too large');parts.push(chunk);}
    await this.save(source.id,Buffer.concat(parts));this.log(`${source.name} programme guide updated.`);
   }catch(e){this.errors.set(source.id,e.message);this.rebuild();this.log(`${source.name} guide refresh failed; retaining cached listings: ${e.message}`);}
  }finally{this.busy=false;}
 }
 render(config){if(!config.guideEnabled||!this.data)return xmltv(config);
  const channelXml=[],programmes=[];
  for(const c of channelConfigs(config)){
   const id=`tohyee.${c.channelNumber}`;const match=matchGuide(this.data.channels,c);
   const icon=match?.icon?`<icon src="${escapeXml(match.icon)}"/>`:'';
   channelXml.push(`<channel id="${escapeXml(id)}"><display-name>${escapeXml(c.channelName)}</display-name><display-name>${escapeXml(c.channelNumber)}</display-name>${icon}</channel>`);
   if(match?.programmes.length)for(const p of match.programmes)programmes.push(p.replace(/^(<programme\b[^>]*\bchannel\s*=)(["']).*?\2/,`$1"${escapeXml(id)}"`));
   else {const fallback=xmltv({...c,channels:undefined});programmes.push(...(fallback.match(/<programme\b[\s\S]*?<\/programme>/g)||[]));}
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<tv generator-info-name="Tohyee TV — NZXMLTV">${channelXml.join('\n')}\n${programmes.join('\n')}</tv>`;
 }
}
