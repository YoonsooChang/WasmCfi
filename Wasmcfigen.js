//handleElem.js
let startTime, endTime;
const {performance} = require('perf_hooks');

function myFunction() {

const fs = require("fs");
const execSync = require("child_process").execSync;

const TYPEVAL = {
  nil: -1,
  void: 0,
  i1: 1,
  i8: 2,
  i16: 3,
  i32: 4,
  f16: 5,
  f32: 6,
  f64 :7,
  "void*": 8,
};

let typeCountGlobal = Object.keys(TYPEVAL).length - 1;

let watFileData;
let callSiteObj = {};

class Wasmcfigen {
  constructor(wabtBinPath, functionSignatureFilePath, watPath) {

    this.externPaths = {
      wabtPath : `${wabtBinPath}`,
      watPath : `${watPath}`,
      wasmPath : '',
      funcSigPath : `${functionSignatureFilePath}`
    }

    this.indCallSigs = {};
    this.randIndexes = [];
    this.indCallCount = 0;
    this.elemFuncArr = []; 

    try {
      callSiteObj = JSON.parse(`{${fs.readFileSync(this.externPaths[`funcSigPath`], 'utf-8')}}`);
      this.#runFuncChains(this.#filterIndCalleeSync, this.#sortFuncsByTypeValue, this.#setIndCallSigs)(this.externPaths[`watPath`]);
    } catch (err) {
      console.log(`Signature Processing Failed`, err);
      return;
    }
  }

  #filterIndCalleeSync = (watPath) => {
      this.elemFuncArr = this.#readElemSync(watPath);
      this.indCallCount = this.elemFuncArr.length;
      let indCallObj = {};
      this.elemFuncArr.forEach((funcName, tableIdx) => {
        funcName = funcName.slice(1);
        indCallObj[funcName] = {};
        indCallObj[funcName].Type = ( (callSiteObj[funcName]) ? callSiteObj[funcName].Type : {ret:'', args :[]} );
        indCallObj[funcName].originalIdx = tableIdx + 1;
      });
      return indCallObj;
  }

  #isWatExist = (path, watFile) => fs.readdirSync(path).some(files => (files === watFile));

  #readElemSync = (watPath) => {
      let pathTokens = watPath.split("/");
      const watFileName = pathTokens.pop();
      const dirPath = ((pathTokens.length === 0) ? '.' : pathTokens.join('/'));
      this.externPaths[`wasmPath`] = `${dirPath}/${watFileName.split(".")[0]}.wasm`;

      const isExist = this.#isWatExist(dirPath, watFileName);
      !isExist && this.#createWat(this.externPaths[`wasmPath`], watPath);
      
      watFileData = fs.readFileSync(watPath, "utf8");
      return watFileData
              .match(/\(elem(.*)\)/g)[0]
              .match(/func .*/)[0]
              .slice(0,-1)
              .split(" ")
              .slice(1);
  }

  #createWat = (wasmPath, watPath) => this.#exec(`${this.externPaths['wabtPath']}/wasm2wat ${wasmPath} -o ${watPath}`);

 #getTypeVal = (typeStr) => {
    let expected = TYPEVAL[`${typeStr}`];
    if (typeof expected === "undefined") {
      TYPEVAL[`${typeStr}`] = typeCountGlobal;
      expected = typeCountGlobal++;
    }
    return expected;
  };


  #convertTypeToValues = (funcList) => ( 
    funcList.map((func) => {
      const typeObj = func[1].Type;
      let retType = (typeObj.ret==='' ? 'void' : typeObj.ret);
      let argTypes = (typeObj.args.length === 0  
                        ? ['nil']
                        : typeObj.args);
      return {
        name: func[0],
        ret: this.#getTypeVal(retType),
        params: argTypes.map((argType) => this.#getTypeVal(argType)),
        originalIdx: func[1].originalIdx,
      }
    })
  );

  #sortFuncsByTypeValue = (indCallObj) => {
    let sigValList = this.#convertTypeToValues(Object.entries(indCallObj));
    sigValList.sort((a, b) => {
      return a.ret - b.ret
        ? a.ret - b.ret
        : this.#compareParams(a.params, b.params);
    });

    return sigValList;
  };

  #compareParams = (a, b) => {
    const alen = a.length;
    const blen = b.length;
    const gap = Math.abs(alen - blen);

    let swapOrNot = false;
    let _a = Array.from(a);
    let _b = Array.from(b);
    if (alen > blen) {
      for (let i = 0; i < gap; i++) _b.push(0);
    } else {
      for (let i = 0; i < gap; i++) _a.push(0);
    }

    for (let i = 0; i < _a.length; i++) {
      if (_a[i] != _b[i]) {
        swapOrNot = _a[i] - _b[i];
        break;
      }
    }
    return swapOrNot;
  };

#setIndCallSigs = (funcObjValList) => {
    let arr, sig;
    return funcObjValList.map((obj, index) => {
      const funcSigVal = this.#getSigVal(obj.ret, obj.params);
      if (index === 0) {
        arr = Array.of({ funcName: obj.name, originalIdx: obj.originalIdx });
        sig = funcSigVal;
      }
      else if (sig !== funcSigVal) {
          this.indCallSigs[sig] = { funcMem: arr, count: arr.length };
          sig = funcSigVal;
          arr = Array.of({ funcName: obj.name, originalIdx: obj.originalIdx });
      } else {
         arr.push({ funcName: obj.name, originalIdx: obj.originalIdx });
      }

      if (index === funcObjValList.length - 1) 
        this.indCallSigs[sig] = { funcMem: arr, count: arr.length };
    });
  };

    #getSigVal = (ret, paramArr) => {
      (paramArr.length === 0) && (paramArr = [-1]);
      return `${ret}_${paramArr.reduce((acc, cur) => acc + "_" + cur)}`;
    }
  #genUniqueRands = (range) => {
    let arr = [];
    let rand;
    for (let i = 0; i < range; i++) {
      do {
        rand = Math.floor(Math.random() * range);
      } while (arr.some((e) => e === rand));
      arr.push(rand);
    }
    return arr;
  };

 indexRandomize = () => {
    let indexPairs = [];
    let acc = 1;
    Object.values(this.indCallSigs)
          .forEach((sigInfo) => {
                    const randArr = this.#genUniqueRands(sigInfo.count);
                    sigInfo.funcMem.forEach((func, index) => {
                      indexPairs.push([func.originalIdx, randArr[index] + acc]);
                    });
                    acc += sigInfo.count;
                  });

    this.randIndexes = indexPairs.sort((a, b) => a[0] - b[0])
                                 .map((pair) => pair[1]);
  };

  #isWatModified = () =>  (watFileData.split('\n').pop().match(/\(global(.*)\)/g) != null)
  
  modWatSync = () => {
    const watPath = this.externPaths['watPath'];
    console.log(`Mod Wat Start...`, watPath);

    try {
      this.indexRandomize();

      const isWatModifiedBefore = this.#isWatModified();
      isWatModifiedBefore 
          ? this.#renewElemAndIndexSection(watPath)
          : this.#modNaiveWat(watPath)

      this.#exec(`${this.externPaths[`wabtPath`]}/wat2wasm ${watPath} -o  ${this.externPaths[`wasmPath`]}`);
    } catch (err) {
      console.log(`Wasm-Cfi Error, Wat Modification Failed.`, err);
    }
  };

 #renewElemAndIndexSection = (watPath) => {
    console.log(`Wat Was Modified Before... Renew Functions In Elem Section And Index Data Section.`);
    this.#modElemSection();
    let newIndicesSection = watFileData.match(/\(data(.*)\)/g).pop();
    const newDataSectionStr = this.#getNewIndexesArray(
      this.randIndexes,
    );

    watFileData = watFileData.replace(
      newIndicesSection.match(/"(.*?)"/g)[0],
      `"${newDataSectionStr}"`
    );

    fs.writeFileSync(watPath, watFileData, "utf-8");
  };

  #getNewIndexesArray = (idxArr) => {
    let hexValStr = "";
    idxArr.forEach((newIdxStr, orignalIdx) => {
      let newIdx = parseInt(newIdxStr); 
      hexValStr += this.#toLittleEndian(parseInt(newIdx).toString(16));
    });
    return hexValStr;
  };

  #modNaiveWat = (watPath) => {
      console.log(`Wat Modification... Elem Section Will Be Modified, Call Indirect Statement And Data Sections For Randomized Index Will Be Added.`);
      const modifiedWat = this.#runFuncChains(this.#modElemSection, this.#modDataSection)();    
      fs.writeFileSync(watPath, modifiedWat, "utf-8", () => {
      console.log(`Wat Modification Is Done.`);
    });
  }

  #modElemSection = () => {
    console.log("Modify Elem Section...");
      let newElemFuncArr = Array.of(this.elemFuncArr.length);
      
      Object.values(this.indCallSigs)
              .map(sigInfo => sigInfo.funcMem)
              .flat()
              .forEach((func) => {    
                  const newIndex = this.randIndexes[func.originalIdx-1];
                  newElemFuncArr[newIndex-1] = func.funcName;
              }); 
      
      const newElemFuncStr = newElemFuncArr.reduce((acc, cur) => acc + `$${cur} ` , '').slice(0,-1);
      watFileData = watFileData.replace(this.elemFuncArr.join(" "), newElemFuncStr);
  }

  #modDataSection = () => { 
    console.log("Modify Data Section...");
        const originalOffset = 65535;

    this.#setIndexBoundaries();
    console.log("Set Fixed Range Checkers...");
    const funcBlockReg =  /\(func \$(.)*\n(\s*([^)(]*?)\(([^)(]+?)\)|\s*([^)(]*?))*([^)(]*?)\)/mg;
    
    watFileData.match(funcBlockReg).forEach((funcBlock)=>{      
      let modFuncBlock = funcBlock;
      const fName = funcBlock.match(/\(func \$[0-9|a-z|A-Z|\_]*/g)[0].split('$')[1];
      
      if(!callSiteObj[fName]){
         const rangeChecker = this.#getIndexRangeCheckStmt(
            originalOffset,
            this.indCallSigs[`0_-1`].lowerbound,
            this.indCallSigs[`0_-1`].upperbound
          );
          modFuncBlock = modFuncBlock.replace(/call_indirect/g, rangeChecker);
      }
      else if(callSiteObj[fName].Calls.length > 0){
        callSiteObj[fName].Calls.forEach(call => {
          let typeValueStr = 
            this.#getSigVal(this.#getTypeVal(call.ret), call.args.map((argType) => this.#getTypeVal(argType)));
          typeValueStr = (this.indCallSigs[typeValueStr] ? typeValueStr : `0_-1`);
          const rangeChecker = 
            this.#getIndexRangeCheckStmt(
            originalOffset,
            this.indCallSigs[typeValueStr].lowerbound,
            this.indCallSigs[typeValueStr].upperbound
          );
          modFuncBlock = modFuncBlock.replace(/call_indirect/, rangeChecker);
        })
      }
      watFileData =  watFileData.replace(funcBlock, modFuncBlock);
    });  
    watFileData = watFileData.replace(/call_mindirect/g, 'call_indirect');
    
    console.log("Render new index section...");
    const newIdxDataSection = `\n\t(data (i32.const ${originalOffset}) "${this.#getNewIndexesArray(this.randIndexes)}")`;
    const globalForOriginalIdx = `\n\t(global (mut i32) (i32.const ${originalOffset + 4 * this.indCallCount})))`;

    return (
      watFileData.slice(0,-2) +
      newIdxDataSection +
      globalForOriginalIdx
    );
  };

  #toLittleEndian = (hexStr) => {
    if (hexStr.length % 2 === 1) hexStr = "0".concat(hexStr);
    let rst = "";
    for (let i = hexStr.length / 2; i > 0; i--)
      rst += "\\" + hexStr.substr((i - 1) * 2, 2);
    if (hexStr.length / 2 < 4) {
      for (let i = 0; i < 4 - hexStr.length / 2; i++) rst += "\\00";
    }
    return rst;
  };

  #setIndexBoundaries = () => {
    console.log('set index bound ...');
    let acc = 1;
    Object.entries(this.indCallSigs)
          .forEach( (sigEntry) => {
             const sigValue = sigEntry[0];
             const sigDetail = sigEntry[1];

              const lowerbound = acc;
              const upperbound = (acc += parseInt(sigDetail.count));
              this.indCallSigs[sigValue].lowerbound = lowerbound;
              this.indCallSigs[sigValue].upperbound = upperbound;
          });
  };

  #getArrayRefStmt = (offset) =>
    `i32.const 1
        i32.sub
        i32.const 4
        i32.mul
        i32.load offset=${offset}`;

  #getIndexRangeCheckStmt = (
    idxOffset,
    lowerbound,
    upperbound
  ) => {
    const saveOriginalIdxStmt = `\n\t\t\tglobal.set 2`;
    const loadOriginalIdxStmt = '\n\t\t\tglobal.get 2';

    const modifiedIndCallStmt = `${saveOriginalIdxStmt}
      \t\t\ti32.const ${lowerbound}
      \t\t\ti32.const ${upperbound}
      \t\t\t${loadOriginalIdxStmt}
      ${this.#getArrayRefStmt(idxOffset)}
      \t\t\tcall $check_index_range
    
      ${loadOriginalIdxStmt}
      ${this.#getArrayRefStmt(idxOffset)}
		call_mindirect`;

    return modifiedIndCallStmt;
  };

  getIndCallSigs = () => {
    for (const [sig, detail] of Object.entries(this.indCallSigs)) {
      console.log(`${sig} : {\tfuncMem : {`);
      detail.funcMem.forEach((func) => {
        console.log(`\t\t{`);
        for (const [key, val] of Object.entries(func)) 
          console.log(`\t\t\t${key} : ${val}`);
        console.log(`\t\t}`);
      });
      console.log(`\t}`);
      
      console.log(`\tLB : ${detail.lowerbound},`);
      console.log(`\tUB : ${detail.upperbound},`);
      console.log(`\tcount : ${detail.count}}`);
    }
  };

  modWasmTable = (wasmTable) => {
        let webAssemblyFunctions = []; 
        for(let i=1; i<=this.indCallCount; i++){
          webAssemblyFunctions.push(wasmTable.get(i));
        }
        Object.values(this.indCallSigs)
              .map(sigInfo => sigInfo.funcMem)
              .flat()
              .forEach((func) => {    
                  let newIndex = this.randIndexes[func.originalIdx-1];
                  console.log("Set ", func.funcName , " at " , newIndex, " , original is ", func.originalIdx);
                  wasmTable.set(newIndex, webAssemblyFunctions[func.originalIdx-1]);
              }); 
    };

  #runFuncChains = (...funcArgs) => {
      return funcArgs.reduce(
        (prev, next) => (...args) => next(prev(...args)),
        k => k 
      )
  }

  #exec = (command) => execSync(command).toString().trim();
}

module.exports = Wasmcfigen;

let cfi = new Wasmcfigen(...argv.slice(1));
cfi.modWatSync();

}