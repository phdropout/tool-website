import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import { createDrawingSession, fitDrawingSize, drawingPoint, palettes, coloringImageMime } from '../src/scripts/coloring-core.js';

const canvas=()=>createCanvas(1,1);
const stroke=(changes={})=>({type:'stroke',brush:'round',color:'#ef4444',size:12,opacity:1,erase:false,seed:42,points:[{x:10,y:30,pressure:1},{x:50,y:30,pressure:1}],...changes});
const pixel=(ctx,x,y)=>[...ctx.getImageData(x,y,1,1).data];
const output=()=>createCanvas(80,80).getContext('2d');

test('drawing dimensions are bounded and retain proportions, including narrow images',()=>{
 assert.deepEqual(fitDrawingSize(4000,2000),{width:2048,height:1024,resized:true});
 assert.deepEqual(fitDrawingSize(800,1000),{width:800,height:1000,resized:false});
 assert.deepEqual(fitDrawingSize(1,10000),{width:1,height:2048,resized:true});
 assert.throws(()=>fitDrawingSize(0,10));assert.throws(()=>fitDrawingSize(Infinity,10));
});
test('mouse and pen coordinates scale with the display and clamp outside the page',()=>{
 const bounds={left:10,top:20,width:100,height:200};
 assert.deepEqual(drawingPoint({clientX:60,clientY:120,pointerType:'mouse',pressure:0},bounds,800,1600),{x:400,y:800,pressure:1});
 assert.deepEqual(drawingPoint({clientX:-10,clientY:300,pointerType:'pen',pressure:0.5},bounds,800,1600),{x:0,y:1600,pressure:0.5});
});
test('file signatures reject disguised formats and recognize supported raster images',()=>{
 assert.equal(coloringImageMime(Uint8Array.from([137,80,78,71,13,10,26,10])),'image/png');
 assert.equal(coloringImageMime(Uint8Array.from([255,216,255,224])),'image/jpeg');
 assert.equal(coloringImageMime(Buffer.from('RIFF0000WEBP')),'image/webp');
 assert.equal(coloringImageMime(Buffer.from('<svg>')),null);
 assert.equal(coloringImageMime(Buffer.from('GIF89a')),null);
});
test('round brush covers continuous paths and treats opacity once across overlapping points',()=>{
 const session=createDrawingSession(80,80,canvas),ctx=output();
 session.commit(stroke({opacity:0.5,points:[{x:10,y:30,pressure:1},{x:50,y:30,pressure:1},{x:10,y:30,pressure:1}]}));session.render(ctx);
 const center=pixel(ctx,30,30);assert(center[0]>230);assert(center[3]>=126&&center[3]<=129);
 assert.equal(pixel(ctx,30,50)[3],0);
 session.dispose();
});
test('eraser removes only coloring and undo restores the previous raster',()=>{
 const session=createDrawingSession(80,80,canvas),ctx=output();session.commit(stroke());session.render(ctx);
 const original=pixel(ctx,30,30);session.commit(stroke({erase:true,size:8}));session.render(ctx);assert.equal(pixel(ctx,30,30)[3],0);
 session.undo();session.render(ctx);assert.deepEqual(pixel(ctx,30,30),original);
 session.redo();session.render(ctx);assert.equal(pixel(ctx,30,30)[3],0);session.dispose();
});
test('pencil texture is deterministic through undo and redo, and history owns its input',()=>{
 const session=createDrawingSession(80,80,canvas),ctx=output(),mark=stroke({brush:'pencil'});
 session.commit(mark);session.render(ctx);const expected=Buffer.from(ctx.getImageData(0,0,80,80).data);
 mark.points[0].x=1000;mark.color='#000000';
 session.undo();session.redo();session.render(ctx);assert.deepEqual(Buffer.from(ctx.getImageData(0,0,80,80).data),expected);
 assert(expected.some((value,i)=>i%4===3&&value>0&&value<255));session.dispose();
});
test('soft brush has a soft edge and supports a single-point stroke',()=>{
 const session=createDrawingSession(80,80,canvas),ctx=output();
 session.commit(stroke({brush:'soft',size:40,points:[{x:30,y:30,pressure:1}]}));session.render(ctx);
 assert(pixel(ctx,30,30)[3]>pixel(ctx,46,30)[3]);assert.equal(pixel(ctx,55,30)[3],0);session.dispose();
});
test('clear can be undone and drawing after undo discards the redo branch',()=>{
 const session=createDrawingSession(80,80,canvas),ctx=output();session.commit(stroke());session.commit({type:'clear'});session.render(ctx);assert.equal(pixel(ctx,30,30)[3],0);
 session.undo();session.render(ctx);assert.equal(pixel(ctx,30,30)[3],255);
 session.commit(stroke({color:'#0000ff'}));assert.equal(session.canRedo,false);session.dispose();
});
test('bounded undo history preserves older artwork in the baseline',()=>{
 const session=createDrawingSession(80,80,canvas,2),ctx=output();
 session.commit(stroke({points:[{x:10,y:10,pressure:1}]}));
 session.commit(stroke({points:[{x:30,y:30,pressure:1}]}));
 session.commit(stroke({points:[{x:50,y:50,pressure:1}]}));
 session.undo();session.undo();assert.equal(session.canUndo,false);session.render(ctx);
 assert.equal(pixel(ctx,10,10)[3],255);assert.equal(pixel(ctx,30,30)[3],0);assert.equal(pixel(ctx,50,50)[3],0);session.dispose();
});
test('PNG export preserves black line art in multiply mode and can paint over it in normal mode',async()=>{
 const session=createDrawingSession(80,80,canvas),base=createCanvas(80,80),ctx=output();
 const original=base.getContext('2d');original.fillStyle='white';original.fillRect(0,0,80,80);original.fillStyle='black';original.fillRect(28,20,4,20);
 session.commit(stroke());session.export(ctx,base,true);
 assert.deepEqual(pixel(ctx,30,30),[0,0,0,255]);assert(pixel(ctx,20,30)[0]>230);
 session.export(ctx,base,false);assert.deepEqual(pixel(ctx,30,30),[239,68,68,255]);
 assert.deepEqual(pixel(original,30,30),[0,0,0,255]);
 const png=ctx.canvas.toBuffer('image/png');
 assert.deepEqual(png.subarray(0,8),Buffer.from([137,80,78,71,13,10,26,10]));
 const {loadImage}=await import('@napi-rs/canvas');const decoded=await loadImage(png),saved=output();saved.drawImage(decoded,0,0);
 assert.deepEqual(pixel(saved,30,30),[239,68,68,255]);session.dispose();
});
test('palettes expose twelve valid, distinct colors',()=>{
 for(const palette of Object.values(palettes)){assert.equal(palette.colors.length,12);assert.equal(new Set(palette.colors).size,12);for(const color of palette.colors)assert.match(color,/^#[0-9a-f]{6}$/i);}
});

test('starter gallery discovers only PNGs, sorts naturally, and encodes asset paths safely',async()=>{
 const {starterColoringPages}=await import('../src/scripts/coloring-pages.js');
 const pages=starterColoringPages(['page-10.png','page-2.PNG','garden & flowers.png','old.svg','notes.txt']);
 assert.deepEqual(pages.map(page=>page.title),['Garden & Flowers','Page 2','Page 10']);
 assert.equal(pages[0].path,'/coloring-pages/garden%20%26%20flowers.png');
 assert.deepEqual(starterColoringPages([]),[]);
});

test('draft strokes and draft erasing never alter committed artwork',()=>{
 const session=createDrawingSession(80,80,canvas),ctx=output();
 session.render(ctx,stroke());assert.equal(pixel(ctx,30,30)[3],255);
 session.render(ctx);assert.equal(pixel(ctx,30,30)[3],0);assert.equal(session.canUndo,false);
 session.commit(stroke());session.render(ctx,stroke({erase:true}));assert.equal(pixel(ctx,30,30)[3],0);
 session.render(ctx);assert.equal(pixel(ctx,30,30)[3],255);session.dispose();
});

test('pen pressure narrows a brush without changing the selected size',()=>{
 const session=createDrawingSession(80,80,canvas),ctx=output();
 session.commit(stroke({size:30,points:[{x:20,y:30,pressure:0.2},{x:60,y:30,pressure:1}]}));session.render(ctx);
 assert.equal(pixel(ctx,20,39)[3],0);assert.equal(pixel(ctx,60,39)[3],255);session.dispose();
});
