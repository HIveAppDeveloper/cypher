#define ORT_API_MANUAL_INIT
#include "onnxruntime_cxx_api.h"
#define POCKETFFT_CACHE_SIZE 16
#define POCKETFFT_NO_MULTITHREADING
#include "pocketfft_hdronly.h"
#include <algorithm>
#include <complex>
#include <mutex>
#include <vector>

template<bool Inverse> struct FFTKernel {
 FFTKernel(const OrtApi&,const OrtKernelInfo*) {}
 void Compute(OrtKernelContext* raw) {
  Ort::KernelContext ctx(raw);
  auto x=ctx.GetInput(0);auto window=ctx.GetInput(1);auto hop=ctx.GetInput(2);
  auto shape=x.GetTensorTypeAndShapeInfo().GetShape();
  auto n=window.GetTensorTypeAndShapeInfo().GetElementCount();
  auto h=*hop.GetTensorData<int64_t>();
  if(shape.size()!=3 || shape[0]!=1 || (n!=150 && n!=600) || h<=0 || size_t(h)>n) throw std::runtime_error("Invalid FFT input");
  const auto* input=x.GetTensorData<float>();const auto* w=window.GetTensorData<float>();
  const size_t k=n/2+1;
  const size_t frames=Inverse ? shape[2] : (shape[2]-n)/h+1;
  if(frames==0 || frames>100000) throw std::runtime_error("Invalid FFT length");
  if constexpr(Inverse) {if(size_t(shape[1])!=2*k)throw std::runtime_error("Invalid spectrum");}
  else {if(shape[1]!=1 || size_t(shape[2])<n)throw std::runtime_error("Invalid waveform");}
  int64_t dims[]={1,Inverse?1:int64_t(2*k),int64_t(Inverse?(frames-1)*h+n:frames)};
  auto output=ctx.GetOutput(0,dims,3);auto* out=output.GetTensorMutableData<float>();
  std::vector<float> real(frames*n);std::vector<std::complex<float>> spectrum(frames*k);
  pocketfft::shape_t fftshape{frames,n};pocketfft::stride_t rs{ptrdiff_t(n*sizeof(float)),sizeof(float)},cs{ptrdiff_t(k*sizeof(std::complex<float>)),sizeof(std::complex<float>)};
  if constexpr(Inverse) {
   std::fill(out,out+dims[2],0.0f);
   for(size_t f=0;f<frames;++f)for(size_t j=0;j<k;++j)spectrum[f*k+j]={input[j*frames+f],input[(j+k)*frames+f]};
   pocketfft::c2r(fftshape,cs,rs,1,false,spectrum.data(),real.data(),1.0f/n,1);
   for(size_t f=0;f<frames;++f)for(size_t j=0;j<n;++j)out[f*h+j]+=real[f*n+j]*w[j];
  } else {
   for(size_t f=0;f<frames;++f)for(size_t j=0;j<n;++j)real[f*n+j]=input[f*h+j]*w[j];
   pocketfft::r2c(fftshape,rs,cs,1,true,real.data(),spectrum.data(),1.0f,1);
   for(size_t f=0;f<frames;++f)for(size_t j=0;j<k;++j){out[j*frames+f]=spectrum[f*k+j].real();out[(j+k)*frames+f]=spectrum[f*k+j].imag();}
  }
 }
};
template<bool Inverse> struct FFTOp:Ort::CustomOpBase<FFTOp<Inverse>,FFTKernel<Inverse>> {
 void* CreateKernel(const OrtApi& api,const OrtKernelInfo* info)const{return new FFTKernel<Inverse>(api,info);}
 const char* GetName()const{return Inverse?"ParadeeIRFFT":"ParadeeRFFT";}
 size_t GetInputTypeCount()const{return 3;}
 ONNXTensorElementDataType GetInputType(size_t i)const{return i==2?ONNX_TENSOR_ELEMENT_DATA_TYPE_INT64:ONNX_TENSOR_ELEMENT_DATA_TYPE_FLOAT;}
 size_t GetOutputTypeCount()const{return 1;}
 ONNXTensorElementDataType GetOutputType(size_t)const{return ONNX_TENSOR_ELEMENT_DATA_TYPE_FLOAT;}
};
extern "C" ORT_EXPORT OrtStatus* ORT_API_CALL RegisterCustomOps(OrtSessionOptions* options,const OrtApiBase* base) {
 Ort::InitApi(base->GetApi(ORT_API_VERSION));
 static FFTOp<false> forward;static FFTOp<true> inverse;
 static std::mutex mutex;static std::vector<Ort::CustomOpDomain> domains;
 try {
  std::lock_guard<std::mutex> lock(mutex);
  Ort::CustomOpDomain domain("ai.onnx.contrib");domain.Add(&forward);domain.Add(&inverse);
  Ort::UnownedSessionOptions session(options);session.Add(domain);domains.push_back(std::move(domain));return nullptr;
 }catch(const std::exception& e){return Ort::GetApi().CreateStatus(ORT_FAIL,e.what());}
}
