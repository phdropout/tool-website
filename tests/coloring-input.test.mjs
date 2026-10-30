import test from 'node:test';
import assert from 'node:assert/strict';
import {createCanvas} from '@napi-rs/canvas';
import {attachColoringInput, attachColoringWheelZoom, scrollZoom} from '../src/scripts/coloring-input.js';
import {createDrawingSession} from '../src/scripts/coloring-core.js';

class Surface {
 constructor(){this.events=new Map();this.captured=new Set();}
 addEventListener(type,handler,options){const list=this.events.get(type)||[];list.push({handler,options});this.events.set(type,list);}
 removeEventListener(type,handler){this.events.set(type,(this.events.get(type)||[]).filter(item=>item.handler!==handler));}
 emit(type,values={}) {
  const event={type,pointerId:1,isPrimary:true,button:0,clientX:10,clientY:20,prevented:false,stopped:false,preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;},...values};
  for(const {handler} of this.events.get(type)||[])handler(event);return event;
 }
 setPointerCapture(id){this.captured.add(id);}
 hasPointerCapture(id){return this.captured.has(id);}
 releasePointerCapture(id){this.captured.delete(id);this.emit('lostpointercapture',{pointerId:id});}
}
function setup(brush='round'){
 const target=new Surface(),win=new Surface(),display=createCanvas(80,80),ctx=display.getContext('2d');
 const session=createDrawingSession(80,80,()=>createCanvas(1,1));let active=null,ends=0,enabled=true;
 const controller=attachColoringInput(target,{
  canStart:()=>enabled,
  onStart:event=>{active={type:'stroke',brush,color:'#ef4444',size:20,opacity:1,seed:42,points:[{x:event.clientX,y:event.clientY,pressure:1}]};session.render(ctx,active);},
  onMove:events=>{for(const event of events)active.points.push({x:event.clientX,y:event.clientY,pressure:1});session.render(ctx,active);},
  onEnd:(commit,event)=>{if(event)active.points.push({x:event.clientX,y:event.clientY,pressure:1});if(commit)session.commit(active);active=null;session.render(ctx);ends++;},
 },win);
 return {target,win,ctx,session,controller,get ends(){return ends;},disable(){enabled=false;},alpha:()=>ctx.getImageData(0,0,80,80).data.filter((_,i)=>i%4===3).reduce((a,b)=>a+b,0)};
}

test('round, pencil and soft marks remain after unexpected capture loss and cancellation',()=>{
 for(const brush of ['round','pencil','soft'])for(const ending of ['lostpointercapture','pointercancel']){
  const s=setup(brush);s.target.emit('pointerdown');s.target.emit('pointermove',{clientX:50,clientY:30});
  assert(s.alpha()>0);s.target.captured.clear();s.target.emit(ending);
  assert(s.alpha()>0,`${brush} must remain after ${ending}`);assert.equal(s.session.canUndo,true);assert.equal(s.ends,1);
  s.target.emit('pointerup');assert.equal(s.ends,1,'A later pointerup cannot commit twice');
  s.session.undo();s.session.render(s.ctx);assert.equal(s.alpha(),0);s.controller.dispose();s.session.dispose();
 }
});
test('window pointerup commits a stroke released outside the canvas exactly once',()=>{
 const s=setup();s.target.emit('pointerdown');s.target.emit('pointermove',{clientX:40,clientY:30});
 s.win.emit('pointerup',{clientX:60,clientY:35});s.target.emit('pointerup');s.target.emit('lostpointercapture');
 assert.equal(s.ends,1);assert(s.alpha()>0);s.session.undo();assert.equal(s.session.canUndo,false);s.controller.dispose();s.session.dispose();
});
test('events from a second pointer cannot erase or complete the active stroke',()=>{
 const s=setup();s.target.emit('pointerdown');
 s.target.emit('pointerdown',{pointerId:2,isPrimary:false});
 for(const type of ['pointermove','pointerup','pointercancel','lostpointercapture'])s.target.emit(type,{pointerId:2});
 assert.equal(s.ends,0);s.target.emit('pointerup');assert.equal(s.ends,1);assert(s.alpha()>0);s.controller.dispose();s.session.dispose();
});
test('delayed capture-loss events do not interrupt a stroke which still owns capture',()=>{
 const s=setup();s.target.emit('pointerdown');s.target.emit('lostpointercapture');assert.equal(s.ends,0);
 s.target.emit('pointerup');assert.equal(s.ends,1);s.controller.dispose();s.session.dispose();
});
test('empty coalesced-event lists fall back to the actual move and Hand mode cannot start painting',()=>{
 const s=setup();s.target.emit('pointerdown');s.target.emit('pointermove',{clientX:50,clientY:20,getCoalescedEvents:()=>[]});s.target.emit('pointerup',{clientX:50,clientY:20});
 assert(s.ctx.getImageData(40,20,1,1).data[3]>0);s.disable();const event=s.target.emit('pointerdown');assert.equal(event.stopped,false);
 s.controller.dispose();s.session.dispose();
});
test('explicit discard is available for teardown without changing committed marks',()=>{
 const s=setup();s.target.emit('pointerdown');s.controller.end(false);assert.equal(s.alpha(),0);assert.equal(s.session.canUndo,false);
 s.controller.dispose();assert.equal(s.win.events.get('pointerup').length,0);s.session.dispose();
});
test('scroll zoom is gradual, reversible for small deltas, normalizes wheel units and clamps bounds',()=>{
 assert(scrollZoom(1,-10)>1&&scrollZoom(1,-10)<1.02);
 assert(Math.abs(scrollZoom(scrollZoom(1,-10),10)-1)<1e-10);
 assert.equal(scrollZoom(1,1,1),scrollZoom(1,16));
 assert.equal(scrollZoom(1,1,2,100),scrollZoom(1,100));
 assert.equal(scrollZoom(4,-100),4);assert.equal(scrollZoom(0.1,100),0.1);
});
test('wheel zoom keeps the image point under the cursor fixed and leaves the rest of the page alone',()=>{
 const viewport=new Surface();viewport.clientHeight=600;viewport.scrollLeft=100;viewport.scrollTop=150;
 let zoom=1,before=0,enabled=true;
 const paper={getBoundingClientRect:()=>({left:20-viewport.scrollLeft,top:30-viewport.scrollTop,width:800*zoom,height:1000*zoom})};
 const old=paper.getBoundingClientRect(),x=(200-old.left)/old.width,y=(250-old.top)/old.height;
 const detach=attachColoringWheelZoom(viewport,paper,{getZoom:()=>enabled?zoom:null,setZoom:value=>{zoom=value;},beforeZoom:()=>{before++;}});
 const event=viewport.emit('wheel',{deltaY:-40,deltaMode:0,clientX:200,clientY:250});
 assert(event.prevented);assert.equal(before,1);const bounds=paper.getBoundingClientRect();
 assert(Math.abs(bounds.left+x*bounds.width-200)<1e-8);assert(Math.abs(bounds.top+y*bounds.height-250)<1e-8);
 assert.equal(viewport.events.get('wheel')[0].options.passive,false);
 enabled=false;assert.equal(viewport.emit('wheel',{deltaY:-40}).prevented,false);detach();assert.equal(viewport.events.get('wheel').length,0);
});
