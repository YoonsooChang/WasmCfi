#include "llvm/ADT/Statistic.h"
#include "llvm/IR/AbstractCallSite.h"
#include "llvm/IR/DebugInfoMetadata.h"
#include "llvm/IR/Function.h"
#include "llvm/IR/InstIterator.h"
#include "llvm/IR/Instructions.h"
#include "llvm/IR/IntrinsicInst.h"
#include "llvm/IR/Metadata.h"
#include "llvm/IR/Module.h"
#include "llvm/Pass.h"
#include "llvm/Support/Casting.h"
#include "llvm/Support/raw_ostream.h"

using namespace llvm;

#define DEBUG_TYPE "FuncProfile"
STATISTIC(FuncProfilerCounter, "Counts number of functions greeted");

namespace {
  struct FuncProfiler : public FunctionPass {
    static char ID;
    static int Fflag;
    FuncProfiler() : FunctionPass(ID) { }

    bool runOnFunction(Function &F) override {
      DebugLoc DL;
      ++FuncProfilerCounter;
      int Cflag = 0;

      if(Fflag) errs() << ",\"";
      else {
        errs() << "\"";
        Fflag++;
      }

      errs() << F.getName() << "\" : {\n";

      errs() << "\t\"Type\": {\n";
      errs() << "\t\t\"ret\" : \"" << *(F.getFunctionType()->getReturnType()) <<"\"\n";
      errs() << "\t\t,\"args\" : [\n";
      for(unsigned int i=0; i<F.getFunctionType()->getNumParams(); i++){
        if(i) errs() << "\t\t\t,"; else errs() << "\t\t\t";
        errs() << "\"" << *(F.getFunctionType()->getParamType(i)) <<"\"\n";
      }
      errs() << "\t\t]\n\t}\n";

      errs() << "\t,\"Calls\": [\n";
      for (Function::iterator BB = F.begin(), BE = F.end(); BB != BE; BB++) {
        for (BasicBlock::iterator i = BB->begin(), e = BB->end(); i != e; i++) {
          // If current instruction is call
          if (const CallBase *Call = dyn_cast<CallBase>(i)) {
            // indirect call
            if (Call->isIndirectCall()) {
              if(Cflag) errs() << ","; else Cflag++;

              errs() << "\t\t\t{\"ret\" : \"" << *(Call->getFunctionType()->getReturnType()) <<"\"\n";
              errs() << "\t\t\t,\"args\" : [\n";
              for(unsigned int i=0; i<Call->getFunctionType()->getNumParams(); i++){
                if(i) errs() << "\t\t\t\t,"; else errs() << "\t\t\t\t";
                errs() << "\"" << *(Call->getFunctionType()->getParamType(i)) <<"\"\n";
              }
              errs() << "\t\t\t]\n\t\t\t}\n";
            }
          }   // End of CallBase
        }     // End of Instruction
      }
      errs() << "\t]\n}\n";
      return false;
    };
  };    // namespace
}       // namespace
char FuncProfiler::ID = 0;
int FuncProfiler::Fflag = 0;
static RegisterPass<FuncProfiler> X("funcprofiler", "Function Profiler Pass");