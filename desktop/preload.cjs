const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('tohyee',{
  status:()=>ipcRenderer.invoke('status'),
  action:(name,value)=>ipcRenderer.invoke('action',name,value)
});
