import { engine } from './vendor/engine';
import type { ReaderPreferences } from '../library/types';

export type ReaderEvent =
  | { type: 'ready'; toc: { label: string; href: string }[] }
  | { type: 'location'; cfi: string; progress: number; chapter: string }
  | { type: 'search'; results: { excerpt: string; cfi: string }[] }
  | { type: 'error'; message: string }
  | { type: 'tap' };
export type ReaderCommand =
  | { type: 'next' | 'previous' }
  | { type: 'goto'; target: string }
  | { type: 'preferences'; preferences: ReaderPreferences }
  | { type: 'search'; query: string };
export type ReaderHandle = { command(value: ReaderCommand): void };
export const readerColors = {
  light: { background: '#FFFFFF', color: '#212529' },
  sepia: { background: '#F5EEDF', color: '#453D32' },
  dark: { background: '#1D2124', color: '#E5E4DF' },
};
const json = (value: unknown) => JSON.stringify(value ?? null).replace(/</g, '\\u003c');

export function readerDocument(
  base64: string,
  location: string | null,
  preferences: ReaderPreferences,
  savedProgress = 0,
): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; style-src 'unsafe-inline' blob:; img-src data: blob:; font-src data: blob:; frame-src blob: about:; connect-src blob:; worker-src blob:"><style>html,body,#reader{margin:0;width:100%;height:100%;overflow:hidden;background:${readerColors[preferences.theme].background}}body{-webkit-user-select:text}iframe{border:0}</style></head><body><div id="reader"></div><script>${engine.replace(/<\/script/gi, '<\\/script')}</script><script>
(function(){
  const send = (message) => { if(window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(message)); else window.parent.postMessage({bookReader:true,...message}, '*'); };
  const book = ePub(${json(base64)}, { encoding:'base64', replacements:'blobUrl' });
  // EPUB spine documents are XHTML even when their filenames end in .html.
  const load=book.load.bind(book);
  book.load=path=>book.archived && ['.html','.htm','.xhtml'].some(ext=>String(path).split(/[?#]/)[0].toLowerCase().endsWith(ext)) ? book.archive.request(book.resolve(path),'xhtml') : load(path);
  let prefs = ${json(preferences)}, toc = [], ready = false, searchGeneration = 0, relocating = false, locationsReady = false;
  const colors = ${json(readerColors)};
  const rendition = book.renderTo('reader', { width:'100%',height:'100%',spread:'none',flow:'paginated',method:'blobUrl',allowScriptedContent:false,allowPopups:false });
  const cfi = new ePub.CFI();
  const chapterPoints = new Map();
  rendition.on('rendered',(section,view)=>{
    for(const item of toc.filter(item=>item.href.split('#')[0]===section.href)){
      const id=item.href.split('#')[1],element=id?view.contents.document.getElementById(decodeURIComponent(id)):view.contents.document.body;
      if(element)chapterPoints.set(item.href,{label:item.label,cfi:view.contents.cfiFromNode(element)});
    }
  });
  const flatten = (items) => items.flatMap(item => [{label:item.label.trim(),href:item.href}, ...flatten(item.subitems || [])]);
  const reportLocation = (location) => {
    if(!ready || relocating || !location || !location.start) return;
    const points=[...chapterPoints.values()].filter(item=>cfi.compare(item.cfi,location.end?.cfi || location.start.cfi)<=0).sort((a,b)=>cfi.compare(a.cfi,b.cfi));
    const chapter=points.at(-1)?.label || '';
    const measured = locationsReady ? book.locations.percentageFromCfi(location.start.cfi) : ${json(savedProgress)};
    send({type:'location', cfi:location.start.cfi, progress: location.atEnd ? 1 : Math.max(0,Math.min(1, measured || 0)),chapter});
  };
  function applyPreferences() {
    const theme=colors[prefs.theme] || colors.light;
    document.body.style.background=theme.background;
    document.documentElement.style.background=theme.background;
    rendition.themes.default({body:{color:theme.color+' !important',background:theme.background+' !important','line-height':prefs.lineHeight+' !important','text-align':'start !important'},'p':{'line-height':prefs.lineHeight+' !important','text-align':'start !important'},'img':{'max-width':'100%','object-fit':'contain'},'a':{color:'inherit'}});
    rendition.themes.fontSize(prefs.fontSize+'px');
    rendition.themes.font(prefs.font==='serif'?'Georgia, serif':'-apple-system, Arial, sans-serif');
  }
  rendition.hooks.content.register(function(contents) {
    const doc=contents.document;
    doc.addEventListener('click',function(event){
      const link=event.target.closest?.('a');
      if(link){
        const href=link.getAttribute('href') || '';
        if(/^(?:https?:|mailto:|tel:|javascript:|data:)/i.test(href)||href.startsWith('//')){event.preventDefault();event.stopPropagation();}
        return;
      }
      if(!doc.getSelection()?.toString())send({type:'tap'});
    });
    let x=0,y=0;
    doc.addEventListener('touchstart',e=>{x=e.changedTouches[0].screenX;y=e.changedTouches[0].screenY;},{passive:true});
    doc.addEventListener('touchend',e=>{const dx=e.changedTouches[0].screenX-x,dy=e.changedTouches[0].screenY-y;if(Math.abs(dx)>65&&Math.abs(dx)>Math.abs(dy)*1.5&&!doc.getSelection()?.toString()) window.readerCommand({type:dx<0?'next':'previous'});},{passive:true});
  });
  const fail=()=>send({type:'error',message:'This chapter could not be opened. Try reopening the book or choose another chapter.'});
  rendition.on('relocated',reportLocation);
  rendition.on('displayError',fail);
  const settleLayout=async()=>{
    await Promise.all(rendition.getContents().map(c=>c.document.fonts?.ready));
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    rendition.getContents().forEach(c=>c.resizeCheck());
  };
  async function displayAt(target){
    relocating=true;
    try{
      await rendition.display(target);
      // epub.js applies theme hooks after first layout. Re-measure before restoring the target.
      await settleLayout();
      await rendition.display(target);
    }finally{relocating=false;}
    reportLocation(rendition.currentLocation());
  }
  async function handleCommand(command){
    try {
      if(command.type==='next')await rendition.next();
      if(command.type==='previous')await rendition.prev();
      if(command.type==='goto')await displayAt(command.target);
      if(command.type==='preferences' && JSON.stringify(prefs)!==JSON.stringify(command.preferences)){
        const anchor=rendition.currentLocation()?.start?.cfi;
        relocating=true; prefs=command.preferences;applyPreferences();
        await settleLayout();
        await displayAt(anchor);
      }
      if(command.type==='search'){
        const generation=++searchGeneration,results=[],term=String(command.query).trim().slice(0,120);
        if(term.length>=2) for(const section of book.spine.spineItems){
          if(generation!==searchGeneration) return;
          await section.load(book.load.bind(book));
          results.push(...section.find(term).slice(0,100-results.length));
          section.unload();
          if(results.length>=100)break;
        }
        if(generation===searchGeneration)send({type:'search',results:results.map(item=>({excerpt:item.excerpt,cfi:item.cfi}))});
      }
    } catch(error){fail();}
  };
  let commands=Promise.resolve();
  window.readerCommand=command=>{commands=commands.then(()=>handleCommand(command)).catch(fail);};
  window.addEventListener('message',function(event){if(event.source===window.parent&&event.data?.bookReaderCommand)window.readerCommand(event.data.command);});
  document.addEventListener('keydown',function(event){if(event.key==='ArrowRight')rendition.next();if(event.key==='ArrowLeft')rendition.prev();});
  book.ready.then(async function(){
    toc=flatten((await book.loaded.navigation).toc);
    applyPreferences();
    try {await displayAt(${location ? json(location) : 'undefined'});}catch(error){await displayAt();}
    ready=true;send({type:'ready',toc});reportLocation(rendition.currentLocation());
    book.locations.generate(1600).then(()=>{locationsReady=true;reportLocation(rendition.currentLocation());}).catch(()=>{});
  }).catch(()=>send({type:'error',message:'This EPUB could not be opened. Try importing a different edition.'}));
})();</script></body></html>`;
}

export function parseReaderEvent(value: unknown): ReaderEvent | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  if (item.type === 'tap') return { type: 'tap' };
  if (item.type === 'error' && typeof item.message === 'string')
    return { type: 'error', message: item.message.slice(0, 300) };
  if (
    item.type === 'location' &&
    typeof item.cfi === 'string' &&
    item.cfi.length < 4096 &&
    typeof item.progress === 'number' &&
    Number.isFinite(item.progress)
  )
    return {
      type: 'location',
      cfi: item.cfi,
      progress: Math.min(1, Math.max(0, item.progress)),
      chapter: typeof item.chapter === 'string' ? item.chapter : '',
    };
  if (item.type === 'ready' && Array.isArray(item.toc))
    return {
      type: 'ready',
      toc: item.toc
        .filter((entry) => typeof entry?.label === 'string' && typeof entry?.href === 'string')
        .slice(0, 2000),
    };
  if (item.type === 'search' && Array.isArray(item.results))
    return {
      type: 'search',
      results: item.results
        .filter((entry) => typeof entry?.excerpt === 'string' && typeof entry?.cfi === 'string')
        .slice(0, 100),
    };
  return null;
}
