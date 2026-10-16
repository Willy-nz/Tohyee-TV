import {SourceHub} from './source.js';
// A lease belongs to one channel until its last viewer leaves. SourceHub session
// IDs and tune tokens keep late packets/acknowledgements out of a new channel.
export class TabPool {
  constructor({count=3,log=()=>{},makeHub=()=>new SourceHub({log})}={}) {
    this.sequence=0;this.log=log;
    this.slots=Array.from({length:count},(_,i)=>({id:String(i+1),hub:makeHub(),lease:null}));
    for(const slot of this.slots) {
      slot.hub.onControl=m=>{
        const lease=slot.lease;
        if(m.type!=='tuned'||!lease||m.token!==lease.token)return;
        if(!m.ok){this.log(`Tab ${slot.id}: ${m.error||'Channel could not start'}`);lease.fail?.();this.release(lease);return;}
        lease.ready=true;this.connectInput(lease);
      };
      slot.hub.onDisconnect=()=>{const lease=slot.lease;if(lease){lease.fail?.();this.release(lease);}};
    }
  }
  source(channel){
    const pool=this;let lease=null;
    return {
      get available(){return !!lease?.slot.hub.available||pool.slots.some(s=>s.hub.available&&!s.lease);},
      acquire(fail){
        if(lease)return true;
        if(!channel.url)return false;
        let slot=pool.slots.find(s=>s.hub.available&&!s.lease);
        if(!slot){slot=pool.slots.find(s=>s.hub.available&&s.lease?.ready&&s.lease.viewers===0);if(slot){const old=slot.lease;old.fail?.();pool.release(old);}}
        if(!slot)return false;
        lease={slot,channel,token:++pool.sequence,ready:false,viewers:0,fail};slot.lease=lease;
        // Discard any input from the previous session before navigating.
        slot.hub.detach();slot.hub.connection.sendJson({type:'tune',token:lease.token,url:channel.url,channelName:channel.channelName});return true;
      },
      attach(sink,onSession){if(!lease){sink.destroy();return;}lease.input={sink,onSession};pool.connectInput(lease);},
      detach(){if(lease){pool.release(lease);lease=null;}},
      setViewers(count){if(lease){lease.viewers=count;if(lease.ready)lease.slot.hub.setViewers(count);}},
      stopBroadcast(){this.detach();},
      status(){return lease?{...lease.slot.hub.status(),slot:lease.slot.id,message:lease.ready?'Playing':`Switching tab ${lease.slot.id}…`}:{connected:false,message:channel.url?'Waiting for Plex':'Set the channel web address'};}
    };
  }
  connectInput(lease){if(!lease.ready||!lease.input)return;const {sink,onSession}=lease.input;lease.input=null;lease.slot.hub.attach(sink,onSession);lease.slot.hub.setViewers(lease.viewers);}
  release(lease){if(lease.slot.lease!==lease)return;lease.slot.hub.detach();lease.slot.hub.setViewers(0);lease.input?.sink.end();lease.slot.lease=null;lease.slot.hub.connection?.sendJson({type:'park',token:++this.sequence});}
  status(){return this.slots.map(s=>({id:s.id,connected:s.hub.available,channelNumber:s.lease?.channel.channelNumber,channelName:s.lease?.channel.channelName,...s.hub.status()}));}
  close(){for(const s of this.slots){if(s.lease)this.release(s.lease);s.hub.stopBroadcast();}}
}
