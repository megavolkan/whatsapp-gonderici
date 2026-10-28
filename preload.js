const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    oturumBaslat: (oturumAdi) => ipcRenderer.invoke('oturum-baslat', oturumAdi),
    oturumKapat: () => ipcRenderer.invoke('oturum-kapat'),
    listeSec: (senaryo) => ipcRenderer.invoke('liste-sec', senaryo),
    listeYenidenDogrula: (senaryo, esleme) => ipcRenderer.invoke('liste-yeniden-dogrula', senaryo, esleme),
    dosyaSec: () => ipcRenderer.invoke('dosya-sec'),
    mesajOnizle: (sablon) => ipcRenderer.invoke('mesaj-onizle', sablon),
    gonderimBaslat: (ayarlar) => ipcRenderer.invoke('gonderim-baslat', ayarlar),
    gonderimIptal: () => ipcRenderer.invoke('gonderim-iptal'),
    onWaOlay: (callback) => ipcRenderer.on('wa-olay', (_e, olay) => callback(olay)),
    onIlerleme: (callback) => ipcRenderer.on('gonderim-ilerleme', (_e, ilerleme) => callback(ilerleme)),
});
