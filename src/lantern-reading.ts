/** Rex <game88521@gmail.com>. Retain each heading's authored size when reading grows. */
let queued=false,needsAll=true;const pending=new Set<HTMLElement>();
function measure(){
 queued=false;const root=document.documentElement;root.dataset.lanternReadingMeasure='true';
 const headings=(needsAll?[...document.querySelectorAll<HTMLElement>('[data-harbor-reading-surface] :is(h1,h2,h3,h4)')]:[...pending]).filter(node=>node.isConnected&&node.closest('[data-harbor-reading-surface]'));needsAll=false;pending.clear();
 // Read first, then write: avoid one style/layout flush for every heading.
 const sizes=headings.map(node=>{const style=getComputedStyle(node),font=parseFloat(style.fontSize),line=parseFloat(style.lineHeight);return{node,font,line:Number.isFinite(line)?line:font*1.4};});
 for(const {node,font,line}of sizes)if(Number.isFinite(font)){node.style.setProperty('--lantern-heading-font',font+'px');node.style.setProperty('--lantern-heading-line',line+'px');}
 delete root.dataset.lanternReadingMeasure;
}
function schedule(all=false){needsAll=needsAll||all;if(!queued){queued=true;requestAnimationFrame(measure);}}
function collect(node:Element){if(node instanceof HTMLElement&&node.matches('h1,h2,h3,h4'))pending.add(node);for(const heading of node.querySelectorAll<HTMLElement>('h1,h2,h3,h4'))pending.add(heading);}
const observer=new MutationObserver(records=>{
 for(const record of records)if(record.type==='attributes'){if(record.attributeName==='data-harbor-reading-surface'&&record.target instanceof Element)collect(record.target);}else for(const node of record.addedNodes)if(node instanceof Element)collect(node);
 if(pending.size)schedule();
});
observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['data-harbor-reading','data-harbor-reading-surface']});
addEventListener('resize',()=>schedule(true));addEventListener('orientationchange',()=>schedule(true));schedule(true);
