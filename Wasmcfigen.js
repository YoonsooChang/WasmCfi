const fs = require("fs");
const execSync = require("child_process").execSync;

const TYPEVAL = {
  nil: -1,
  void: 0,
  bool: 1,
  char: 2,
  "unsigned char": 3,
  short: 4,
  "unsigned short": 5,
  int: 6,
  unsigned: 7,
  "unsigned int": 8,
  long: 9,
  "unsigned long": 10,
  "long long": 11,
  "long long int": 12,
  "unsigned long long": 13,
  "unsigned long long int": 14,
  float: 15,
  double: 16,
  "long double": 17,

  "void*": 18,
  "char*": 19,
  "int*": 20,
};

let typeCountGlobal = Object.keys(TYPEVAL).length - 2;

let watFileData;
let originalSigObj = {};

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
      const sigFileData = fs.readFileSync(this.externPaths[`funcSigPath`], "utf8");
      this.#parseSignaturesIntoObj(sigFileData);
      this.#runFuncChains(this.#filterIndCallSync, this.#sortFuncsByTypeValue, this.#setIndCallSigs)(this.externPaths[`watPath`]);
    } catch (err) {
      console.log(`Signature Processing Failed`, err);
      return;
    }
  }

   #parseSignaturesIntoObj = (funcSigFile) => {
      const openParenthesis = '(';
      const closeParenthesis =')';
      
     funcSigFile.split("\n").forEach((line)=>{
          let fs = {};
          let funcName;
          const indexOfFront = line.indexOf(openParenthesis);  
          const indexOfBack = line.indexOf(closeParenthesis);
          if(indexOfFront != -1 && indexOfBack != -1){
              fs.funcArgs = line.slice(indexOfFront+1, indexOfBack)
                          .split(", ")
                          .map((arg)=> arg.split(" ").slice(0, -1).join(" "));
              const retTypeAndName = line.slice(0, indexOfFront).trim().split(' ');
              funcName = retTypeAndName.pop();
              fs.funcRets = retTypeAndName.join(" ");            
          }
          originalSigObj[funcName] = fs;
      })
  }

  #filterIndCallSync = (watPath) => {
      this.elemFuncArr = this.#readElemSync(watPath);
      this.indCallCount = this.elemFuncArr.length;
      let indCallObj = {};
      this.elemFuncArr.forEach((funcName, tableIdx) => {
        funcName = funcName.slice(1);
        indCallObj[funcName] = ( (originalSigObj[funcName]) ? originalSigObj[funcName] : {} );
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

  #convertTypeToValues = (funcSigList) => ( 
    funcSigList.map((sig) => {
      let retType = (sig[1].funcRets ? sig[1].funcRets : 'nil');
      let argTypes = (typeof sig[1].funcArgs === 'undefined'  
                        ? ['nil']
                        : ((sig[1].funcArgs[0] === '') ? ['void'] : sig[1].funcArgs));
      return {
        name: sig[0],
        ret: this.#getTypeVal(retType),
        params: argTypes.map((argType) => this.#getTypeVal(argType)),
        originalIdx: sig[1].originalIdx,
      }
    })
  );

  #sortFuncsByTypeValue = (funcSigObj) => {
    let sigValList = this.#convertTypeToValues(Object.entries(funcSigObj));
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
  
  modWatSync = (watPath) => {

    console.log(`Mod Wat Start...`, watPath);

    try {
      this.indexRandomize();

      const isWatModifiedBefore = this.#isWatModified();
      isWatModifiedBefore 
          ? this.#renewElemAndIndexSection(watPath)
          : this.#modNaiveWat(watPath)

      this.#exec(`${this.externPaths[`wabtPath`]}/wat2wasm ${watPath} -o ${this.externPaths[`wasmPath`]}`);
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
      this.indCallCount
    );

    watFileData = watFileData.replace(
      newIndicesSection.match(/"(.*?)"/g)[0],
      `"${newDataSectionStr}"`
    );

    fs.writeFileSync(watPath, watFileData, "utf-8");
  };

  #getNewIndexesArray = (idxArr) => {
    let hexValStr = "";
    idxArr.forEach((newIdxStr) => {
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
      let newElemFuncArr = Array.of(this.elemFuncArr.length);
      
      Object.values(this.indCallSigs)
              .map(sigInfo => sigInfo.funcMem)
              .flat()
              .forEach((func) => {    
                  const newIndex = this.randIndexes[func.originalIdx-1];
                  newElemFuncArr[newIndex-1] = func.funcName;
              }); 
      
      const newElemFuncStr = newElemFuncArr.reduce((acc, cur) => acc + `$${cur} ` , '').slice(0,-1);
      // console.log(watFileData);
      // console.log('ORIGINAL: ', this.elemFuncArr.join(" "));
      // console.log('NEW : ' , newElemFuncStr);
      watFileData = watFileData.replace(this.elemFuncArr.join(" "), newElemFuncStr);
  }

  #modDataSection = () => { 
    const originalOffset = this.#getDataSectionOffset(
      watFileData.match(/\(data(.*)\)/g).pop()
    );

    const {
      idxBoundDataSection,
      idxBoundPtrBytes,
      idxBoundBytes,
    } = this.#getIndexBoundarySections(originalOffset);
    
    const newIdxDataSection = `\n\t(data (i32.const ${originalOffset + idxBoundPtrBytes + idxBoundBytes}) "${this.#getNewIndexesArray(this.randIndexes, this.indCalls)}")`;
    const globalForOriginalIdx = `\n\t(global (mut i32) (i32.const ${originalOffset + idxBoundPtrBytes * 2 + idxBoundBytes})))`;

    return (
      this.#addDataSectionRefStmt(
        originalOffset,
        originalOffset + idxBoundPtrBytes + idxBoundBytes,
      ) +
      idxBoundDataSection +
      newIdxDataSection +
      globalForOriginalIdx
    );
  };

  #getDataSectionOffset = (lastDataSection) => parseInt(lastDataSection.match(/i32.const [0-9]*/)[0]
                                                                       .split(" ")
                                                                       .pop() )
                                                 + lastDataSection.match(/"(.*?)"/g)[0]
                                                                 .split("\\")
                                                                 .slice(1).length;

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

  #getIndexBoundarySections = (currentOffset) => {
    let result = "";
    let {
      idxBounds,
      idxBoundBytes,
      idxBoundPtrArray,
      idxBoundPtrBytes,
    } = this.#setIndexBoundaries();
    let idxBoundPtrs = this.#setIndexBoundPtrs(
      currentOffset,
      idxBoundPtrArray,
      idxBoundPtrBytes
    );

    result += `\n\t(data (i32.const ${currentOffset}) "${idxBoundPtrs}")
        \t(data (i32.const ${
          currentOffset + idxBoundPtrBytes
        }) "${idxBounds}")`;

    return {
      idxBoundDataSection: result,
      idxBoundPtrBytes,
      idxBoundBytes,
    };
  };

  #setIndexBoundaries = () => {
    let acc = 1;
    let result = "";
    let idxBoundPtrArray = [];
    Object.values(this.indCallSigs)
          .forEach( (sigDetail, sigIndex) => {
              sigDetail.funcMem.forEach((funcInfo) =>
                idxBoundPtrArray.push([funcInfo.originalIdx, sigIndex])
              );

              let lowerbound = acc;
              let upperbound = (acc += parseInt(sigDetail.count));
              
              result += (this.#toLittleEndian(lowerbound.toString(16)) +
                          this.#toLittleEndian(upperbound.toString(16)));
          });

    return {
      idxBounds: result,
      idxBoundBytes: (Object.keys(this.indCallSigs).length + 1) * 4 * 2,
      idxBoundPtrArray,
      idxBoundPtrBytes: (acc - 1) * 4,
    };
  };

  #setIndexBoundPtrs = (
    offset,
    idxBoundPtrArray,
    idxBoundPtrBytes
  ) => {
    let result = "";
    let offsetToIdxBounds = offset + idxBoundPtrBytes;
    idxBoundPtrArray
      .sort((a, b) => a[0] - b[0])
      .forEach((pair, index) => {
        result += this.#toLittleEndian(
          (offsetToIdxBounds + 8 * pair[1]).toString(16)
        );
      });
    return result;
  };


  #getArrayRefStmt = (offset) =>
    `i32.const 1
        i32.sub
        i32.const 4
        i32.mul
        i32.load offset=${offset}`;

  #addDataSectionRefStmt = (
    ptrOffset,
    idxOffset,
  ) => {
    const saveOriginalIdxStmt = `\n\t\t\tglobal.set 2`;
    const loadOriginalIdxStmt = '\n\t\t\tglobal.get 2';

    const dataSectionRefStmt = `${saveOriginalIdxStmt}
      \t\t\tblock 
        block
          ${loadOriginalIdxStmt}
          ${this.#getArrayRefStmt(ptrOffset)}
          i32.load ;; lower bound

          ${loadOriginalIdxStmt}
          ${this.#getArrayRefStmt(idxOffset)}

          i32.lt_u
          br_if 1

          ${loadOriginalIdxStmt}
          ${this.#getArrayRefStmt(ptrOffset)}
          i32.load offset=4 ;; upper bound

          ${loadOriginalIdxStmt}
          ${this.#getArrayRefStmt(idxOffset)}
          
          i32.ge_u
          br_if 1
          br 0
        end
        call $print_err
    end
    ${loadOriginalIdxStmt}
    ${this.#getArrayRefStmt(idxOffset)}
		call_indirect`;

    return watFileData.replace(/call_indirect/g, dataSectionRefStmt).slice(0, -2);
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
      console.log(`\tcount : ${detail.count}}`);
    }
  };

  #setIndCallSigs = (funcObjValList) => {
    let arr, sig;
    return funcObjValList.map((obj, index) => {
      if (index === 0) {
        arr = Array.of({ funcName: obj.name, originalIdx: obj.originalIdx });
        sig = this.#getSigVal(obj.ret, obj.params);
      }
      else if (index === funcObjValList.length - 1) {
        arr.push({ funcName: obj.name, originalIdx: obj.originalIdx });
        this.indCallSigs[sig] = { funcMem: arr, count: arr.length };
      }
      else {
        if (sig != this.#getSigVal(obj.ret, obj.params)) {
          this.indCallSigs[sig] = { funcMem: arr, count: arr.length };
          arr = Array.of({ funcName: obj.name, originalIdx: obj.originalIdx });
          sig = this.#getSigVal(obj.ret, obj.params);
        } else arr.push({ funcName: obj.name, originalIdx: obj.originalIdx });
      }
    });
  };

    #getSigVal = (ret, paramArr) =>
    `${ret}_${paramArr.reduce((acc, cur) => acc + "_" + cur)}`;

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

// let cfi = new Wasmcfigen(process.argv[2], process.argv[3], process.argv[4]);
// cfi.getIndCallSigs();
// // cfi.indexRandomize();
// // console.log(TYPEVAL)
// // console.log(cfi.randIndexes)
//  cfi.modWatSync(process.argv[3]);