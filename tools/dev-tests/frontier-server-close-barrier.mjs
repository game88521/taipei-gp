// Rex <game88521@gmail.com>. Test-only authority-close barrier; never advances or extends a game clock.
import {setImmediate as yieldIO} from 'node:timers/promises';
export async function waitForServerClose(service,timeoutMs=4000){
 const deadline=performance.now()+timeoutMs;
 while(service&&service.clients.size&&performance.now()<deadline)await yieldIO();
 if(service?.clients.size)throw Error(`Server-side close was not acknowledged before cleanup clock advance (${service.clients.size} connection(s))`);
}
