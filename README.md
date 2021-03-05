#WasmCFI

> JS module for applying CFI in WebAssembly(wasm) Module **compiled from C language**

## Introduction

All value types in original source codes(C, C++, etc) map down to few value types(i32, i64, f32, and f64) in WebAssembly. Those types are used when [indirect calls](https://webassembly.github.io/spec/core/syntax/instructions.html#control-instructions)(originally function pointers, member methods in class) are executed at runtime to check if callee's function signature is correspondent with that of the indirect call target.

It seems that type vulnerability is able to be exploited by Function Reuse Attack if an attacker supply evil functions whose function signature is same as victim function.

WasmCFI makes more detailed signature check possible by classifying function signatures with types close to original language.

---

## Prerequisite

- `Linux` as System Requirements
- `Emscripten SDK`

  - C,C++ Compiler toolchain to WebAssembly
  - https://emscripten.org/
  - **emcc, wabt(wasm2wat, wat2wasm)** binary files are needed

- `LLVM opt`

  - LLVM >= 12
  - opt runs [profiler(Customed LLVM Pass)](https://github.com/YoonsooChang/WasmCfi/tree/master/src/Pass) which profiles function call sites in original sources from LLVM bitcode(.bc).
  - Building latest upstream EMSDK provides LLVM opt since EMSDK uses LLVM front-end. But we need to build LLVM opt with the profiler(written in C++) to run this LLVM pass.
  - https://llvm.org/docs/GettingStarted.html#id5

- `nodejs` >= 12

---

## Usage

#### Putting Index range checker function in original code

```c
void check_index_range(int lowerbound, int upperbound, int table_index){
  if(lowerbound > table_index || table_index >= upperbound){
      printf("Runtime Error: Out Of Signature Range");
      exit(-1);
  }
  return;
}
```

This index range checker function could be inserted to .wasm file in text by Javascript(WasmCFI) in WebAssembly Text Format(WAT). But wasm binary produced by emcc(Compiler) could be more optimized result.

#### Getting LLVM bitcode

    emcc -g2 -O0 -emit-llvm target.c -c -o target.bc -ldl -lm -lpthread

- `-emit-llvm` option provides LLVM bitcode and this will be served to LLVM opt for getting function call-sites of target code
- `-g2` (debug), `-O0` (optimization) is necessary because they preserve the function names in compiled wasm which are essential to figure out LLVM-type function signature.

- Other optional flags should be used depending to execution environment [(emcc options)](https://emscripten.org/docs/tools_reference/emcc.html)

#### Getting Function Callsites

    opt -load lib/LLVMFuncProfiler.so -funcprofiler target.bc -disable-output 2>target.callsite

At first, [profiler(Customed LLVM Pass)](https://github.com/YoonsooChang/WasmCfi/tree/master/src/Pass) directory should be included in `{root of LLVM source}/lib/Transforms`. Then building LLVM will produce `LLVMFuncProfiler.so` in `{build directory}/lib`. The result of this command `target.callsite` contains name of functions, type, and information about indirect calls that occur in each function in JSON format.

#### Getting Wasm

    emcc -g2 -O0 target.c -s EXPORTED_FUNCTIONS="['_main', '_check_index_range', ]" -o target.html

The target file name extension defines the output type to be generated(html, js, mjs, wasm). Functions unused in original code could be erased in compiled wasm binary. And call-statement for index range checker function will be inserted later by Javascript. `-s EXPORTED_FUNCTIONS = ['_main', '_func1', ...]` option maintain them and it is why this option is necessary.

#### Running WasmCFI

    yarn build

Now this module is written in Typescript, run this script. JS module will be generated in dist.

    node Wasmcfigen {path of wabt/bin} {path of Callsite file} {path of .wat file}

Constructor receives three command line arguments

- Path of `wabt/bin`(wabt is wasm binary toolkit, what needed is wasm2wat/wat2wasm, translator between wasm binary and text format)
- Path of `target.callsite`
- Path of `target.wat`(translated text format from wasm binary). **The .wat file should not exist in the beginning(directory path is same as that of .wasm file) and be generated in process. The .wat file should be reserved for additional execution with no errors.**

---

## Limit

...will be updated later
