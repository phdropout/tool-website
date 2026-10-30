import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, PDFArray, degrees, decodePDFRawStream } from 'pdf-lib';
import { selectionQuads, pointerPdfPoint, exportHighlightedPdf, highlightPath } from '../src/scripts/pdf-viewer-core.js';

function viewport(rotation, scale = 2) {
  // A cropped page [20, 30, 220, 330], with PDF.js-style viewport transforms.
  const transforms = {
    0: [scale, 0, 0, -scale, -20 * scale, 330 * scale],
    90: [0, scale, scale, 0, -30 * scale, -20 * scale],
    180: [-scale, 0, 0, scale, 220 * scale, -30 * scale],
    270: [0, -scale, -scale, 0, 330 * scale, 220 * scale],
  };
  const [a,b,c,d,e,f] = transforms[rotation];
  return { width: (rotation % 180 ? 300 : 200) * scale, height: (rotation % 180 ? 200 : 300) * scale,
    convertToViewportPoint: (x,y) => [a*x+c*y+e,b*x+d*y+f],
    convertToPdfPoint: (x,y) => { const det=a*d-b*c; return [(d*(x-e)-c*(y-f))/det,(-b*(x-e)+a*(y-f))/det]; },
  };
}

test('selection coordinates survive zoom, rotated pages, and nonzero crop origins', () => {
  for (const rotation of [0,90,180,270]) for (const scale of [0.5,1,2,3]) {
    const view = viewport(rotation, scale), bounds = { left: 40, top: 80 };
    const rect = { left: 40 + 10, top: 80 + 20, right: 40 + 50, bottom: 80 + 35 };
    const quads = selectionQuads([rect, {...rect}], bounds, view);
    assert.equal(quads.length,1);
    const screen = quads[0].map(([x,y]) => view.convertToViewportPoint(x,y));
    for (const [i,point] of [[10,20],[50,20],[50,35],[10,35]].entries()) {
      assert(Math.abs(screen[i][0]-point[0])<1e-8);
      assert(Math.abs(screen[i][1]-point[1])<1e-8);
    }
  }
});

test('selection rectangles clip to the page and empty ranges are ignored', () => {
  const view=viewport(0,1);
  const result=selectionQuads([{left:-10,top:10,right:30,bottom:20},{left:500,top:10,right:520,bottom:20},{left:0,top:0,right:0,bottom:10}], {left:0,top:0}, view);
  assert.equal(result.length,1);
  assert.deepEqual(result[0][0], [20,320]);
});

test('brush pointers clamp to the page and use stable PDF units', () => {
  const view=viewport(90,2);
  assert.deepEqual(pointerPdfPoint(-100,900,{left:10,top:20},view), view.convertToPdfPoint(0,view.height));
  assert.equal(highlightPath([[1,2],[3,4]],true,true),'M1 -2 L3 -4 Z');
});

function streams(pdf, page) {
  const contents=page.node.lookup(PDFName.of('Contents'));
  const refs=contents instanceof PDFArray ? contents.asArray() : [contents];
  return refs.map(ref=>Buffer.from(decodePDFRawStream(pdf.context.lookup(ref)).decode()).toString('latin1'));
}

test('export keeps original pages, text streams, rotation and crop while adding vector highlights', async () => {
  const original=await PDFDocument.create();
  const first=original.addPage([300,400]); first.drawText('Original selectable text',{x:35,y:300});
  const second=original.addPage([400,500]); second.setRotation(degrees(90)); second.setCropBox(20,30,300,400);
  second.drawRectangle({x:40,y:50,width:30,height:60});
  const bytes=await original.save();
  const source=await PDFDocument.load(bytes);
  const sourceStreams=streams(source,source.getPage(0));
  const marks=[{type:'text',page:0,color:'yellow',quads:[[[35,310],[100,310],[100,295],[35,295]]]},{type:'brush',page:1,color:'pink',width:16,points:[[40,50],[70,90],[90,80]]},{type:'brush',page:1,color:'blue',width:8,points:[[120,140]]}];
  const unchanged=JSON.stringify(marks);
  const saved=await PDFDocument.load(await exportHighlightedPdf(bytes,marks));
  assert.equal(saved.getPageCount(),2);
  assert.equal(saved.getPage(1).getRotation().angle,90);
  assert.deepEqual(saved.getPage(1).getCropBox(),{x:20,y:30,width:300,height:400});
  const firstStreams=streams(saved,saved.getPage(0));
  assert(sourceStreams.every(stream=>firstStreams.includes(stream)),'Original text content must be preserved');
  const added=firstStreams.join('\n');
  assert.match(added,/35 -310 m/); // SVG y is inverted by pdf-lib's drawing transform.
  assert.match(added,/100 -295 l/);
  const brush=streams(saved,saved.getPage(1)).join('\n');
  assert.match(brush,/16 w/);
  assert.match(brush,/1 J/); // Round line caps, including a single-point brush dab.
  const states=saved.getPage(0).node.Resources().lookup(PDFName.of('ExtGState'));
  const state=states.lookup(states.keys()[0]);
  assert.equal(state.lookup(PDFName.of('BM')).toString(),'/Multiply');
  assert.equal(state.lookup(PDFName.of('ca')).asNumber(),0.35);
  assert.equal(JSON.stringify(marks),unchanged);
  assert.equal((await PDFDocument.load(bytes)).getPageCount(),2);
});

test('export rejects invalid page references and colors', async () => {
  const pdf=await PDFDocument.create(); pdf.addPage(); const bytes=await pdf.save();
  await assert.rejects(()=>exportHighlightedPdf(bytes,[{page:3,color:'yellow'}]),/missing page/);
  await assert.rejects(()=>exportHighlightedPdf(bytes,[{page:0,color:'invalid'}]),/Unknown highlight color/);
});

test('PDF.js renders exported text and brush highlights at the right pixels on rotated cropped pages', async () => {
  // PDF.js supplies the optional Node canvas dependency. No files or uploads are used.
  const { createCanvas } = await import('@napi-rs/canvas');
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { rgb } = await import('pdf-lib');
  const pdf=await PDFDocument.create();
  for (const rotation of [0,90,180,270]) {
    const page=pdf.addPage([300,400]); page.setCropBox(20,30,200,300); page.setRotation(degrees(rotation));
    page.drawRectangle({x:80,y:180,width:10,height:10,color:rgb(0,0,0)});
  }
  const marks=Array.from({length:4},(_,page)=>[
    {type:'text',page,color:'yellow',quads:[[[60,200],[120,200],[120,170],[60,170]]]},
    {type:'brush',page,color:'yellow',width:16,points:[[60,120],[120,120]]},
  ]).flat();
  const bytes=await exportHighlightedPdf(await pdf.save(),marks);
  const task=getDocument({data:bytes});
  try {
    const doc=await task.promise;
    for (let i=1;i<=4;i++) {
      const page=await doc.getPage(i), view=page.getViewport({scale:2});
      const canvas=createCanvas(view.width,view.height), context=canvas.getContext('2d');
      await page.render({canvasContext:context,canvas,viewport:view}).promise;
      const pixel=(x,y)=>{const [vx,vy]=view.convertToViewportPoint(x,y);return [...context.getImageData(Math.floor(vx),Math.floor(vy),1,1).data];};
      for (const point of [[65,185],[90,120]]) {
        const [r,g,b,a]=pixel(...point);
        assert(r>240 && g>225 && b<210 && a===255,`Expected yellow at ${point} on rotated page ${i}: ${[r,g,b,a]}`);
      }
      assert.deepEqual(pixel(85,185),[0,0,0,255],'Highlight must leave underlying black content readable');
      assert.deepEqual(pixel(150,150),[255,255,255,255],'Unmarked content stays unchanged');
      page.cleanup();
    }
  } finally {await task.destroy();}
});

test('custom zoom accepts precise percentages, clamps bounds, and safely ignores invalid input', async () => {
  const {zoomFromPercent}=await import('../src/scripts/pdf-viewer-core.js');
  assert.equal(zoomFromPercent('137',1),1.37);
  assert.equal(zoomFromPercent(' 85 ',1),0.85);
  assert.equal(zoomFromPercent('137.6',1),1.38);
  assert.equal(zoomFromPercent('5',1),0.1);
  assert.equal(zoomFromPercent('400',1),3);
  for (const value of ['', ' ', 'invalid', 'Infinity', NaN]) assert.equal(zoomFromPercent(value,1.37),1.37);
  let zoom=1;
  zoom=zoomFromPercent(Math.round(zoom*100)+5,zoom);
  assert.equal(zoom,1.05);
  zoom=zoomFromPercent(Math.round(zoom*100)-5,zoom);
  assert.equal(zoom,1);
});
