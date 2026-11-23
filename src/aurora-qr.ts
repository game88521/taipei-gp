/** QR Model 2, byte mode, error correction L, versions 1–6. No remote QR service or tracking. */
const SPECS=[{v:1,data:19,ecc:7,blocks:1},{v:2,data:34,ecc:10,blocks:1},{v:3,data:55,ecc:15,blocks:1},{v:4,data:80,ecc:20,blocks:1},{v:5,data:108,ecc:26,blocks:1},{v:6,data:136,ecc:18,blocks:2}];
const gf=(a:number,b:number)=>{let r=0;for(let i=0;i<8;i++){if(b&1)r^=a;b>>>=1;a<<=1;if(a&256)a^=0x11d;}return r;};
function parity(data:number[],degree:number){let gen=[1];for(let i=0,x=1;i<degree;i++,x=gf(x,2)){const next=Array(gen.length+1).fill(0);for(let j=0;j<gen.length;j++){next[j]^=gen[j];next[j+1]^=gf(gen[j],x);}gen=next;}const out=Array(degree).fill(0);for(const byte of data){const f=byte^out.shift()!;out.push(0);for(let j=0;j<degree;j++)out[j]^=gf(gen[j+1],f);}return out;}
function formatBits(mask:number){const data=(1<<3)|mask;let r=data<<10;for(let i=14;i>=10;i--)if((r>>>i)&1)r^=0x537<<(i-10);return ((data<<10)|r)^0x5412;}
function penalty(a:boolean[][]){const n=a.length;let p=0,dark=0;for(let y=0;y<n;y++)for(let x=0;x<n;x++){if(a[y][x])dark++;if(x+1<n&&y+1<n&&a[y][x]===a[y][x+1]&&a[y][x]===a[y+1][x]&&a[y][x]===a[y+1][x+1])p+=3;}
 for(let axis=0;axis<2;axis++)for(let line=0;line<n;line++){const row=Array.from({length:n},(_,i)=>axis?a[i][line]:a[line][i]);let len=1;for(let i=1;i<=n;i++){if(i<n&&row[i]===row[i-1])len++;else{if(len>=5)p+=len-2;len=1;}}const s=row.map(x=>x?'1':'0').join('');for(let i=0;i+11<=n;i++)if(['00001011101','10111010000'].includes(s.slice(i,i+11)))p+=40;}
 return p+Math.floor(Math.abs(dark*100/(n*n)-50)/5)*10;
}
export function makeInviteQr(text:string):boolean[][] {
 const bytes=[...new TextEncoder().encode(text)],spec=SPECS.find(s=>bytes.length*8+12<=s.data*8);if(!spec)throw Error('邀請網址較長，請使用複製連結或六碼房間碼。');
 const bits:number[]=[],append=(value:number,count:number)=>{for(let i=count-1;i>=0;i--)bits.push((value>>>i)&1);};append(4,4);append(bytes.length,8);for(const b of bytes)append(b,8);append(0,Math.min(4,spec.data*8-bits.length));while(bits.length%8)bits.push(0);const data:number[]=[];for(let i=0;i<bits.length;i+=8)data.push(bits.slice(i,i+8).reduce((a,b)=>(a<<1)|b,0));while(data.length<spec.data)data.push(data.length%2===(Math.ceil(bits.length/8)%2)?0xec:0x11);
 const chunks=Array.from({length:spec.blocks},(_,i)=>data.slice(i*spec.data/spec.blocks,(i+1)*spec.data/spec.blocks)),checks=chunks.map(c=>parity(c,spec.ecc)),words:number[]=[];for(let i=0;i<chunks[0].length;i++)for(const c of chunks)words.push(c[i]);for(let i=0;i<spec.ecc;i++)for(const c of checks)words.push(c[i]);
 const n=17+spec.v*4,base=Array.from({length:n},()=>Array(n).fill(false)),reserved=Array.from({length:n},()=>Array(n).fill(false));
 const set=(x:number,y:number,value:boolean)=>{if(x>=0&&y>=0&&x<n&&y<n){base[y][x]=value;reserved[y][x]=true;}};
 for(const [cx,cy]of[[3,3],[n-4,3],[3,n-4]])for(let dy=-4;dy<=4;dy++)for(let dx=-4;dx<=4;dx++){const r=Math.max(Math.abs(dx),Math.abs(dy));set(cx+dx,cy+dy,r!==2&&r!==4);}
 for(let i=8;i<n-8;i++){set(i,6,i%2===0);set(6,i,i%2===0);}
 if(spec.v>1){const c=n-7;for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)set(c+dx,c+dy,Math.max(Math.abs(dx),Math.abs(dy))!==1);}
 const format=(m:boolean[][],mask:number,mark=false)=>{const b=formatBits(mask),put=(x:number,y:number,i:number)=>{m[y][x]=!!((b>>>i)&1);if(mark)reserved[y][x]=true;};for(let i=0;i<=5;i++)put(8,i,i);put(8,7,6);put(8,8,7);put(7,8,8);for(let i=9;i<15;i++)put(14-i,8,i);for(let i=0;i<8;i++)put(n-1-i,8,i);for(let i=8;i<15;i++)put(8,n-15+i,i);m[n-8][8]=true;if(mark)reserved[n-8][8]=true;};format(base,0,true);
 let best:boolean[][]|null=null,bestPenalty=Infinity;
 for(let mask=0;mask<8;mask++){const m=base.map(row=>[...row]);let index=0;for(let right=n-1;right>=1;right-=2){if(right===6)right=5;for(let vert=0;vert<n;vert++){const y=((right+1)&2)===0?n-1-vert:vert;for(let d=0;d<2;d++){const x=right-d;if(reserved[y][x])continue;const bit=index<words.length*8?((words[index>>>3]>>>(7-(index&7)))&1)!==0:false;index++;const product=x*y,flip=[(x+y)%2===0,y%2===0,x%3===0,(x+y)%3===0,(Math.floor(x/3)+Math.floor(y/2))%2===0,product%2+product%3===0,(product%2+product%3)%2===0,((x+y)%2+product%3)%2===0][mask];m[y][x]=bit!==flip;}}}format(m,mask);const score=penalty(m);if(score<bestPenalty){bestPenalty=score;best=m;}}
 return best!;
}
export function drawInviteQr(canvas:HTMLCanvasElement,text:string){const matrix=makeInviteQr(text),scale=6,quiet=4,n=matrix.length;canvas.width=canvas.height=(n+quiet*2)*scale;const ctx=canvas.getContext('2d');if(!ctx)throw Error('無法產生QR，請複製邀請網址。');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#000';for(let y=0;y<n;y++)for(let x=0;x<n;x++)if(matrix[y][x])ctx.fillRect((x+quiet)*scale,(y+quiet)*scale,scale,scale);}
