"""Offline constant folding and a stable closed form for the harmonic bank."""
from pathlib import Path
import sys,json,collections
import numpy as np
import onnx
from onnx import helper,numpy_helper,TensorProto
from onnx.reference import ReferenceEvaluator

def constants(model):
    values={x.name:numpy_helper.to_array(x) for x in model.graph.initializer}
    kept=[];counts=collections.Counter()
    excluded={'RandomNormal','RandomNormalLike','RandomUniform','RandomUniformLike','Bernoulli','Dropout','Multinomial','MatMul'}
    opsets={o.domain:o.version for o in model.opset_import}
    for node in model.graph.node:
        if node.op_type not in excluded and all(not name or name in values for name in node.input):
            try:
                if node.op_type=='Gemm':
                    # Static style projections: accumulate in a fixed order in
                    # float64, then round once to float32. This avoids BLAS CPU
                    # dispatch changing the exported constants' last bits.
                    attrs={a.name:helper.get_attribute_value(a) for a in node.attribute}
                    left=values[node.input[0]];right=values[node.input[1]]
                    a=left.astype(np.float64);b=right.astype(np.float64)
                    if attrs.get('transA',0):a=a.T
                    if attrs.get('transB',0):b=b.T
                    total=np.zeros((a.shape[0],b.shape[1]),dtype=np.float64)
                    for k in range(a.shape[1]):total+=a[:,k:k+1]*b[k:k+1,:]
                    total*=attrs.get('alpha',1.0)
                    if len(node.input)>2 and node.input[2]:total+=attrs.get('beta',1.0)*values[node.input[2]].astype(np.float64)
                    result=[total.astype(left.dtype)]
                else:
                    result=ReferenceEvaluator(node,opsets=opsets).run(None,{name:values[name] for name in node.input if name})
                if any(np.asarray(v).nbytes>64*1024*1024 for v in result):raise ValueError('Too large')
                for name,value in zip(node.output,result):values[name]=np.asarray(value)
                counts[node.op_type]+=1
                continue
            except (Exception,NotImplementedError):pass
        kept.append(node)
    used={i for node in kept for i in node.input}|{o.name for o in model.graph.output}
    del model.graph.initializer[:];model.graph.initializer.extend(numpy_helper.from_array(v,name) for name,v in values.items() if name in used)
    del model.graph.node[:];model.graph.node.extend(kept)
    return dict(counts)

def sparse_warps(model):
    # The frequency interpolation matrices have exactly two nonzero weights
    # per output bin. Express interpolation directly rather than multiplying
    # every bin by all 80 (or 24) input bands.
    values={x.name:numpy_helper.to_array(x) for x in model.graph.initializer}
    nodes=[];count=0
    for node in model.graph.node:
        if node.name not in ('/head/MatMul','/head/MatMul_1'):
            nodes.append(node);continue
        w=values[node.input[1]]
        if w.shape not in ((80,301),(24,76)) or not np.all(np.count_nonzero(w,axis=0)<=2) or not np.allclose(w.sum(0),1):
            raise ValueError('Unexpected frequency interpolation matrix')
        indices=np.zeros((2,w.shape[1]),dtype=np.int64)
        gains=np.zeros((2,w.shape[1]),dtype=np.float32)
        for j in range(w.shape[1]):
            ix=np.flatnonzero(w[:,j]);indices[:len(ix),j]=ix;gains[:len(ix),j]=w[ix,j]
        prefix='cpu_warp_'+str(count)+'/'
        terms=[]
        for q in range(2):
            index=prefix+'index'+str(q);gain=prefix+'gain'+str(q);gather=prefix+'gather'+str(q);scaled=prefix+'scaled'+str(q)
            model.graph.initializer.extend([numpy_helper.from_array(indices[q],index),numpy_helper.from_array(gains[q],gain)])
            nodes.extend([helper.make_node('Gather',[node.input[0],index],[gather],axis=-1),helper.make_node('Mul',[gather,gain],[scaled])]);terms.append(scaled)
        nodes.append(helper.make_node('Add',terms,list(node.output),name=prefix+'result'));count+=1
    if count!=2:raise ValueError('Unexpected frequency interpolation graph')
    del model.graph.node[:];model.graph.node.extend(nodes)
    return count


def harmonic(model):
    # Pinned upstream 1.1 export: cyc [1,S], f0s [1,S]. Replace only
    # sum_k sin(2*pi*k*cyc), k*f0<11000, with its finite-series identity.
    names={n.name:n for n in model.graph.node}
    assert names['/head/ReduceSum'].input[0]=='/head/Mul_8_output_0'
    prefix='cpu_harmonic/'
    inits=[];nodes=[]
    def c(name,value):
        name=prefix+name;inits.append(numpy_helper.from_array(np.asarray(value,dtype=np.float32),name));return name
    def op(kind,inputs,name,**kw):
        name=prefix+name;nodes.append(helper.make_node(kind,inputs,[name],name=name,**kw));return name
    zero=c('zero',0);one=c('one',1);two=c('two',2);pi=c('pi',np.pi);twopi=c('twopi',2*np.pi);maximum=c('max_k',64);cutoff=c('cutoff',11000);epsilon=c('eps',1e-4)
    f0='/head/Gather_7_output_0'
    # The original sample-rate f0 tensor is the input to the 64-harmonic mask.
    mul6=names['/head/Mul_6']
    # Its Less input is [1,1,S]*[1,64,1]; trace the sample-rate Unsqueeze.
    by_output={o:n for n in model.graph.node for o in n.output}
    cast=by_output[mul6.input[0]];less=by_output[cast.input[0]];multiply=by_output[less.input[0]]
    f0_unsqueeze=next(i for i in multiply.input if i in by_output and by_output[i].op_type=='Unsqueeze')
    f0=by_output[f0_unsqueeze].input[0]
    safe=op('Max',[f0,one],'safe_f0')
    upper=op('Div',[cutoff,safe],'upper');upper=op('Ceil',[upper],'ceil');upper=op('Sub',[upper,one],'strict_max')
    k=op('Clip',[upper,zero,maximum],'k')
    voiced=op('Greater',[f0,c('voiced_floor',10)],'voiced')
    k=op('Where',[voiced,k,zero],'voiced_k')
    cycles='/head/Add_3_output_0'
    fractional=op('Sub',[cycles,op('Floor',[cycles],'floor_cycles')],'fractional_cycles')
    angle=op('Mul',[fractional,twopi],'angle')
    half=op('Div',[angle,two],'half_angle')
    denom=op('Sin',[half],'denom')
    a=op('Sin',[op('Mul',[k,half],'k_half')],'sin_k')
    b=op('Sin',[op('Mul',[op('Add',[k,one],'k_one'),half],'k1_half')],'sin_k1')
    product=op('Mul',[a,b],'product')
    magnitude=op('Abs',[denom],'denom_abs');safe_den=op('Where',[op('Less',[magnitude,epsilon],'near_zero'),one,denom],'safe_den')
    series=op('Div',[product,safe_den],'series')
    # Use signed distance to the nearest cycle for the removable singularity.
    delta=op('Where',[op('Greater',[angle,pi],'upper_half'),op('Sub',[angle,twopi],'negative_delta'),angle],'delta')
    limit=op('Mul',[op('Div',[op('Mul',[k,op('Add',[k,one],'k_plus_one')],'k_k1'),two],'slope'),delta],'limit')
    final=op('Where',[op('Less',[magnitude,epsilon],'small_denominator'),limit,series],'sum')
    original_output=names['/head/ReduceSum'].output[0]
    nodes.append(helper.make_node('Identity',[final],[original_output],name=prefix+'result'))
    result=[]
    for node in model.graph.node:
        if node.name=='/head/ReduceSum':result.extend(nodes)
        else:result.append(node)
    del model.graph.node[:];model.graph.node.extend(result);model.graph.initializer.extend(inits)
    # Backward reachability drops the now-unused 64x sine/mask branch.
    original=list(model.graph.node);producer={o:i for i,n in enumerate(original) for o in n.output};needed=set();pending=[o.name for o in model.graph.output]
    while pending:
        name=pending.pop();i=producer.get(name)
        if i is None or i in needed:continue
        needed.add(i);pending.extend(original[i].input)
    retained=[n for i,n in enumerate(original) if i in needed]
    del model.graph.node[:];model.graph.node.extend(retained)
    used={i for n in retained for i in n.input}|{o.name for o in model.graph.output}
    initializers=[i for i in model.graph.initializer if i.name in used]
    del model.graph.initializer[:];model.graph.initializer.extend(initializers)
    return {'removed_harmonic_expansion':True,'nodes_remaining':len(retained)}

if __name__=='__main__':
    source,target=sys.argv[1:3];m=onnx.load(source)
    report={'constant_folded':constants(m)}
    if '--harmonic' in sys.argv:
        report['sparse_warps']=sparse_warps(m)
        report['harmonic']=harmonic(m)
    onnx.checker.check_model(m);onnx.save(m,target);report['bytes']=Path(target).stat().st_size
    print(json.dumps(report))
