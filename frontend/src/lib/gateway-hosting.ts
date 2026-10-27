// The caller supplies the validated build-time app origin, never request headers.
export function companionSetup(origin:string){
  try{
    const url=new URL(origin);
    if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash||origin!==url.origin||/[\u0000-\u0020\u007f]/.test(origin))return null;
    const downloadUrl=url.origin+'/grokbot_device.py';
    const sh=(value:string)=>"'"+value.replace(/'/g,"'\"'\"'")+"'";
    const ps=(value:string)=>"'"+value.replace(/'/g,"''")+"'";
    return {downloadUrl,
      unix:`mkdir -p "$HOME/Cypher"\ncurl --fail --silent --show-error ${sh(downloadUrl)} -o cypher_device.py\npython3 cypher_device.py --server ${sh(url.origin)} --allow-folder "$HOME/Cypher"`,
      windows:`New-Item -ItemType Directory -Force "$HOME/Cypher" | Out-Null\nInvoke-WebRequest ${ps(downloadUrl)} -OutFile cypher_device.py\npy -3 cypher_device.py --server ${ps(url.origin)} --allow-folder "$HOME/Cypher"`,
    };
  }catch{return null;}
}
