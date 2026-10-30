import test from 'node:test';
import assert from 'node:assert/strict';
import {createThumbnailSidebar, attachViewerFullscreen} from '../src/scripts/pdf-viewer-navigation.js';

class Element {
  constructor(doc) { this.ownerDocument=doc; this.children=[]; this.attributes={}; this.dataset={}; this.events={}; this.scrollTop=0; this.bounds={top:0,bottom:400}; }
  append(...nodes) { for(const node of nodes) { if(node.fragment) this.append(...node.children); else {node.parent=this;this.children.push(node);} } }
  replaceChildren(...nodes) {this.children=[];this.append(...nodes);}
  remove() {if(this.parent) this.parent.children=this.parent.children.filter(node=>node!==this);}
  setAttribute(key,value) {this.attributes[key]=value;}
  removeAttribute(key) {delete this.attributes[key];}
  addEventListener(type,fn) {(this.events[type]??=[]).push(fn);}
  removeEventListener(type,fn) {this.events[type]=(this.events[type]??[]).filter(item=>item!==fn);}
  async emit(type) {await Promise.all((this.events[type]??[]).map(fn=>fn({target:this})));}
  querySelector(selector) {return this.children.find(node=>node.className===selector.slice(1));}
  getBoundingClientRect() {return this.bounds;}
  getContext() {return {};}
}
function documentMock() {
  const doc=new Element();
  doc.createElement=()=>new Element(doc);
  doc.createDocumentFragment=()=>Object.assign(new Element(doc),{fragment:true});
  return doc;
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));

function setup(t,{limit=60,delayed=false}={}) {
  let observer;
  const old=globalThis.IntersectionObserver;
  globalThis.IntersectionObserver=class {
    constructor(callback,options) {this.callback=callback;this.options=options;this.observed=[];observer=this;}
    observe(node) {this.observed.push(node);}
    disconnect() {this.observed=[];}
    show(index) {this.callback([{target:this.observed[index],isIntersecting:true}]);}
  };
  t.after(()=>{if(old) globalThis.IntersectionObserver=old;else delete globalThis.IntersectionObserver;});
  const doc=documentMock(), container=new Element(doc), selected=[], rendered=[];
  const pdf={numPages:5,async getPage(number) {return {
    getViewport:({scale})=>({width:100*scale,height:200*scale}),
    render() {
      const task={number,cancelled:false};rendered.push(task);
      task.promise=delayed?new Promise((resolve,reject)=>{task.finish=resolve;task.cancel=()=>{task.cancelled=true;reject(new Error('cancelled'));};}):Promise.resolve();
      task.cancel??=()=>{task.cancelled=true;};return task;
    },
  };}};
  const sidebar=createThumbnailSidebar(container,index=>selected.push(index),{cacheLimit:limit});
  t.after(()=>sidebar.clear());
  return {sidebar,container,pdf,selected,rendered,get observer(){return observer;}};
}

test('vertical page buttons select pages and track the current page with accessible state',async t=>{
  const s=setup(t);s.sidebar.load(s.pdf);await flush();
  assert.equal(s.container.children.length,5);
  assert.equal(s.container.children[0].attributes['aria-current'],'page');
  assert.equal(s.rendered.length,1,'Only the active thumbnail renders before visibility events');
  await s.container.children[2].emit('click');assert.deepEqual(s.selected,[2]);
  s.container.children[2].bounds={top:500,bottom:650};s.sidebar.setActive(2);await flush();
  assert.equal(s.container.children[2].attributes['aria-current'],'page');
  assert.equal(s.container.children[0].attributes['aria-current'],undefined);
  assert.equal(s.container.scrollTop,258,'Only the thumbnail pane scrolls to reveal the active page');
  assert.equal(s.observer.options.root,s.container);
  assert.deepEqual(s.rendered.map(task=>task.number),[1,3]);
});

test('thumbnail cache stays bounded and evicted pages render again when visible',async t=>{
  const s=setup(t,{limit:2});s.sidebar.load(s.pdf);await flush();
  const old=s.container.children[0].children[0].children[0];
  s.observer.show(1);s.observer.show(2);await flush();
  assert.equal(old.width,0);assert.equal(old.height,0);
  assert.equal(s.container.children[0].children[0].children.length,0);
  s.observer.show(0);await flush();
  assert.deepEqual(s.rendered.map(task=>task.number),[1,2,3,1]);
});

test('replacing a PDF cancels pending renders and cannot insert old previews into the new sidebar',async t=>{
  const s=setup(t,{delayed:true});s.sidebar.load(s.pdf);await flush();
  const previous=s.container.children[0];
  const clearing=s.sidebar.clear();await clearing;
  assert.equal(s.rendered[0].cancelled,true);assert.equal(s.container.children.length,0);
  s.sidebar.load({...s.pdf,numPages:2});await flush();
  s.rendered[1].finish();await flush();
  assert.equal(s.container.children.length,2);
  assert.equal(previous.children[0].children.length,0);
  assert.equal(s.container.children[0].children[0].children.length,1);
});

test('fullscreen label follows entry and Escape-style exit, and rejected requests report an error',async()=>{
  const doc=documentMock();doc.fullscreenEnabled=true;
  const target=new Element(doc),button=new Element(doc),changes=[],errors=[];
  target.requestFullscreen=async()=>{doc.fullscreenElement=target;await doc.emit('fullscreenchange');};
  doc.exitFullscreen=async()=>{doc.fullscreenElement=null;await doc.emit('fullscreenchange');};
  const detach=attachViewerFullscreen(target,button,{onChange:state=>changes.push(state),onError:error=>errors.push(error)});
  assert.equal(button.hidden,false);
  await button.emit('click');assert.equal(button.textContent,'Exit fullscreen');assert.equal(button.attributes['aria-pressed'],'true');
  await doc.exitFullscreen();assert.equal(button.textContent,'Fullscreen');assert.deepEqual(changes,[true,false]);
  target.requestFullscreen=async()=>{throw new Error('Denied');};
  await button.emit('click');assert.equal(errors[0].message,'Denied');assert.equal(button.attributes['aria-pressed'],'false');
  detach();assert.equal(doc.events.fullscreenchange.length,0);
});

test('fullscreen control is hidden on unsupported browsers',()=>{
  const doc=documentMock(),target=new Element(doc),button=new Element(doc);
  const detach=attachViewerFullscreen(target,button);assert.equal(button.hidden,true);detach();
});
