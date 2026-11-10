/** Executed by scripting.executeScript in the ISOLATED world, top frame only. No runtime/token access. */
export function captureVisiblePage(){
  if(document.visibilityState!=='visible')return {visible:false};
  const excluded='script,style,noscript,input,textarea,select,option,form,[contenteditable],[autocomplete],iframe,object,embed,[hidden],[aria-hidden="true"]';
  const visible=el=>{if(!el||el.closest(excluded))return false;for(let p=el;p;p=p.parentElement){const s=getComputedStyle(p);if(s.display==='none'||s.visibility==='hidden'||Number(s.opacity)===0)return false;}const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&r.bottom>0&&r.right>0&&r.top<innerHeight&&r.left<innerWidth;};
  const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);const encoder=new TextEncoder();let text='',bytes=0,truncated=false,steps=0;const start=performance.now();
  while(walker.nextNode()){if(++steps>20000||performance.now()-start>150){truncated=true;break;}const n=walker.currentNode;if(!visible(n.parentElement))continue;const part=n.textContent.replace(/\s+/g,' ').trim();if(!part)continue;const length=encoder.encode(part+'\n').length;if(bytes+length>262144){truncated=true;break;}text+=part+'\n';bytes+=length;}
  const urls=[];let links=0;for(const a of document.querySelectorAll('a[href]')){if(++links>2000){truncated=true;break;}if(!visible(a))continue;try{const u=new URL(a.getAttribute('href'),location.href);if(['http:','https:'].includes(u.protocol)&&!u.username&&!u.password&&u.href.length<=4096&&!urls.includes(u.href)){if(urls.length>=199){truncated=true;break;}urls.push(u.href);}}catch{ /* Untrusted hrefs are omitted. */ }}
  return {visible:true,url:location.href,text:text.trim(),urls,truncated};
}
