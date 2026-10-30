import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../src/scripts/analytics.js',import.meta.url),'utf8');
const id='G-S2L3Q2591F',key='papers-and-pixels-analytics-v1';
const saved=(choice,time=Date.now())=>JSON.stringify({choice,time});
function setup({host='papersandpixels.net',storage=null,blocked=false}={}) {
 const fields=new Map(),scripts=[],writes=[],cookies=[],events={};
 const node=()=>({hidden:true,textContent:'',events:{},addEventListener(type,fn){this.events[type]=fn;},focus(){this.focused=true;}});
 for(const name of ['accept','decline','current'])fields.set(name,node());
 const root={...node(),dataset:{measurementId:id},querySelector(selector){return fields.get(selector.slice(16,-1));}};
 const settings=node();
 const document={title:'Image Tools | Papers & Pixels',referrer:'https://example.com/article?secret=value#private',querySelector:()=>root,querySelectorAll:()=>[settings],head:{append:script=>scripts.push(script)},createElement:()=>({remove(){this.removed=true;}})};
 Object.defineProperty(document,'cookie',{get:()=> '_ga=123; _ga_S2L3Q2591F=456; unrelated=keep',set:value=>cookies.push(value)});
 const window={location:{hostname:host,href:`https://${host}/image-tools/?filename=private.png#name`},addEventListener(type,handler){events[type]=handler;}};
 runInNewContext(source,{document,window,Date,URL,localStorage:{getItem(){if(blocked)throw new Error('blocked');return storage;},setItem(k,v){if(blocked)throw new Error('blocked');writes.push([k,v]);}}});
 const click=name=>fields.get(name).events.click();
 return {root,window,scripts,writes,cookies,settings,fields,click,events,commands:()=>Array.from(window.dataLayer||[],args=>Array.from(args))};
}

test('no Google tag or data queue loads before consent or after an initial decline',()=>{
 const a=setup();assert.equal(a.root.hidden,false);assert.equal(a.scripts.length,0);assert.equal(a.window.dataLayer,undefined);
 a.click('decline');assert.equal(a.root.hidden,true);assert.equal(a.scripts.length,0);assert.equal(a.window['ga-disable-'+id],true);
 const b=setup({storage:saved('declined')});assert.equal(b.root.hidden,true);assert.equal(b.scripts.length,0);
});
test('acceptance loads one tag, grants analytics only, and configures one sanitized pageview',()=>{
 const a=setup();a.click('accept');assert.equal(a.scripts.length,1);assert.equal(a.scripts[0].async,true);assert(a.scripts[0].src.endsWith('?id='+id));
 const defaults=a.commands().find(command=>command[0]==='consent'&&command[1]==='default')[2];
 assert.equal(defaults.analytics_storage,'denied');
 const grant=a.commands().find(command=>command[1]==='update')[2];assert.equal(grant.analytics_storage,'granted');assert.equal(grant.ad_storage,'denied');
 a.scripts[0].onload();
 const config=a.commands().find(command=>command[0]==='config');assert.equal(config[1],id);
 assert.equal(config[2].page_location,'https://papersandpixels.net/image-tools/');assert.equal(config[2].page_referrer,'https://example.com/article');
 assert.equal(config[2].allow_google_signals,false);assert.equal(config[2].allow_ad_personalization_signals,false);
 a.scripts[0].onload();a.click('accept');assert.equal(a.scripts.length,1);assert.equal(a.commands().filter(command=>command[0]==='config').length,1);
 assert.equal(JSON.parse(a.writes[0][1]).choice,'accepted');assert.equal(a.writes[0][0],key);
});
test('saved consent starts measurement on a new page, but expired and malformed choices do not',()=>{
 const a=setup({storage:saved('accepted')});assert.equal(a.scripts.length,1);assert.equal(a.root.hidden,true);
 for(const storage of ['garbage',saved('accepted',Date.now()-181*86400000),saved('accepted',Date.now()+86400000),saved('unknown')]){
  const b=setup({storage});assert.equal(b.scripts.length,0);assert.equal(b.root.hidden,false);
 }
});
test('changing preferences withdraws consent and removes only Analytics cookies without reloading the page',()=>{
 const a=setup({storage:saved('accepted')});a.scripts[0].onload();
 a.settings.events.click();assert.equal(a.root.hidden,false);assert.equal(a.fields.get('decline').focused,true);
 a.click('decline');assert.equal(a.window['ga-disable-'+id],true);assert(a.cookies.some(value=>value.startsWith('_ga=;')));
 assert(!a.cookies.some(value=>value.startsWith('unrelated=')));assert.equal(a.settings.focused,true);
 a.click('accept');assert.equal(a.window['ga-disable-'+id],false);assert.equal(a.scripts.length,1);
});
test('withdrawing while the tag is loading prevents config and later acceptance can recover',()=>{
 const a=setup();a.click('accept');a.click('decline');a.scripts[0].onload();assert(!a.commands().some(command=>command[0]==='config'));
 a.click('accept');assert.equal(a.commands().filter(command=>command[0]==='config').length,1);
});
test('storage restrictions and script loading errors do not break consent controls',()=>{
 const a=setup({blocked:true});a.click('accept');assert.equal(a.scripts.length,1);a.scripts[0].onerror();assert.equal(a.scripts[0].removed,true);
 a.click('accept');assert.equal(a.scripts.length,2);a.scripts[1].onload();assert.equal(a.commands().filter(command=>command[0]==='config').length,1);
});
test('localhost and unrelated deployments never load Analytics or show consent UI',()=>{
 for(const host of ['localhost','127.0.0.1','phdropout.github.io','preview.example.com']){
  const a=setup({host,storage:saved('accepted')});assert.equal(a.scripts.length,0);assert.equal(a.root.hidden,true);assert.equal(a.settings.hidden,true);
 }
});
test('consent changes in another tab are respected',()=>{
 const a=setup({storage:saved('accepted')});a.events.storage({key,newValue:saved('declined')});assert.equal(a.window['ga-disable-'+id],true);
 a.events.storage({key:null});assert.equal(a.root.hidden,false);assert.equal(a.window['ga-disable-'+id],true);
});
