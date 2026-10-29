export function untilAborted<T>(operation:()=>Promise<T>,signal:AbortSignal):Promise<T>{
  if(signal.aborted)return Promise.reject(new Error('Connection stopped.'));
  return new Promise((resolve,reject)=>{
    const stop=()=>{signal.removeEventListener('abort',stop);reject(new Error('Connection stopped.'));};
    signal.addEventListener('abort',stop,{once:true});
    try{operation().then(value=>{signal.removeEventListener('abort',stop);resolve(value);},error=>{signal.removeEventListener('abort',stop);reject(error);});}
    catch(error){signal.removeEventListener('abort',stop);reject(error);}
  });
}
export type ConnectionJobState='queued'|'connecting'|'waiting'|'connected'|'setup'|'failed'|'cancelled';
export interface ConnectionJob<T> { key:string; item:T; state:ConnectionJobState; message?:string; }
export type ConnectionOutcome={state:'waiting'|'connected'|'setup';message?:string};

// Only requests explicitly submitted by the user enter this queue. A completed
// authorization start releases the slot even while the provider waits for consent.
export class ConnectionQueue<T> {
  private jobs:ConnectionJob<T>[]=[];
  private running=false;
  private disposed=false;
  constructor(private readonly run:(item:T)=>Promise<ConnectionOutcome>,private readonly publish:(jobs:ConnectionJob<T>[])=>void,private readonly limit=12,private readonly onCancel?:(item:T)=>void){}
  get isDisposed(){return this.disposed;}
  private changed(){if(!this.disposed)this.publish(this.jobs.map(job=>({...job})));}
  canEnqueue(key:string):boolean {return !this.disposed&&!this.jobs.some(job=>job.key===key&&['queued','connecting','waiting'].includes(job.state))&&this.jobs.filter(job=>['queued','connecting','waiting'].includes(job.state)).length<this.limit;}
  enqueue(key:string,item:T):boolean {
    if(!this.canEnqueue(key))return false;
    this.jobs=this.jobs.filter(job=>job.key!==key);
    while(this.jobs.length>=this.limit*2){const index=this.jobs.findIndex(job=>!['queued','connecting','waiting'].includes(job.state));if(index<0)break;this.jobs.splice(index,1);}
    this.jobs.push({key,item,state:'queued'});this.changed();void this.pump();return true;
  }
  cancel(key:string):boolean {
    const job=this.jobs.find(item=>item.key===key);
    if(!job||!['queued','connecting'].includes(job.state))return false;
    job.state='cancelled';job.message='Stopped on this device. The provider may still be processing the request.';this.onCancel?.(job.item);this.changed();return true;
  }
  update(key:string,state:ConnectionJobState,message?:string){
    const job=this.jobs.find(item=>item.key===key);if(!job)return;
    job.state=state;job.message=message;this.changed();
  }
  dismiss(key:string){this.jobs=this.jobs.filter(job=>job.key!==key||['queued','connecting','waiting'].includes(job.state));this.changed();}
  dispose(){this.disposed=true;for(const job of this.jobs)if(job.state==='queued'){job.state='cancelled';this.onCancel?.(job.item);}}
  private async pump(){
    if(this.running||this.disposed)return;this.running=true;
    try{
      while(!this.disposed){
        const job=this.jobs.find(item=>item.state==='queued');if(!job)break;
        job.state='connecting';this.changed();
        try{const outcome=await this.run(job.item);if(job.state==='connecting'){job.state=outcome.state;job.message=outcome.message;}}
        catch(error){if(job.state==='connecting'){job.state='failed';job.message='Connection failed. Try again.';}}
        this.changed();
      }
    }finally{this.running=false;}
  }
}
