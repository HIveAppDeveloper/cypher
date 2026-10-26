import sys,json
from pathlib import Path
import numpy as np
import onnx
from onnx import helper,numpy_helper

def replace(m):
 v={x.name:numpy_helper.to_array(x) for x in m.graph.initializer};nodes=[];added=[];counts={'forward':0,'inverse':0}
 for index,nod in enumerate(m.graph.node):
  w=v.get(nod.input[1]) if len(nod.input)>1 else None
  if nod.op_type not in ('Conv','ConvTranspose') or w is None or w.ndim!=3 or w.shape[1]!=1 or w.shape[0]!=w.shape[2]+2 or w.shape[2] not in (150,600):nodes.append(nod);continue
  n=w.shape[2];hop=next((x.ints[0] for x in nod.attribute if x.name=='strides'),1);p=f'paradee_cpu_fft_{index}'
  window=w[0,0] if nod.op_type=='Conv' else w[0,0]*n
  # Refuse to rewrite an unrelated convolution with a coincidental shape.
  k=np.arange(n//2+1,dtype=np.float64)[:,None];t=np.arange(n,dtype=np.float64)[None,:]
  angle=2*np.pi*((k*t)%n)/n
  expected=np.concatenate((np.cos(angle),-np.sin(angle)),axis=0)*window
  if nod.op_type=='ConvTranspose':
   scale=np.full(n//2+1,2/n);scale[[0,-1]]=1/n;expected*=np.tile(scale,2)[:,None]
  if not np.allclose(w[:,0,:],expected,atol=3e-6,rtol=3e-5):raise ValueError('Unrecognized Fourier basis')
  wn=p+'_window';hn=p+'_hop';added.extend([numpy_helper.from_array(window.astype(np.float32),wn),numpy_helper.from_array(np.array(hop,dtype=np.int64),hn)])
  kind='ParadeeRFFT' if nod.op_type=='Conv' else 'ParadeeIRFFT';counts['forward' if nod.op_type=='Conv' else 'inverse']+=1
  nodes.append(helper.make_node(kind,[nod.input[0],wn,hn],list(nod.output),domain='ai.onnx.contrib',name=p))
 del m.graph.node[:];m.graph.node.extend(nodes);m.graph.initializer.extend(added)
 used={i for n in nodes for i in n.input}|{o.name for o in m.graph.output};inits=[i for i in m.graph.initializer if i.name in used]
 del m.graph.initializer[:];m.graph.initializer.extend(inits)
 if not any(o.domain=='ai.onnx.contrib' for o in m.opset_import):m.opset_import.append(helper.make_opsetid('ai.onnx.contrib',1))
 if counts!={'forward':7,'inverse':2}:raise ValueError('Unexpected Paradee Fourier graph')
 return counts
if __name__=='__main__':
 m=onnx.load(sys.argv[1]);print(json.dumps(replace(m)));onnx.checker.check_model(m);onnx.save(m,sys.argv[2]);print(Path(sys.argv[2]).stat().st_size)
