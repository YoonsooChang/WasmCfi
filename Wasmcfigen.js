const fs = require("fs");
const execSync = require("child_process").execSync;

const WABTPATH = `../../bin/`;
const UNDECLARED_FUNCS = 5;
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

  "void*": 17,
  "char*": 18,
  "int*": 19,
};

let typeCountGlobal = Object.keys(TYPEVAL).length - 2;

let declObj = {};

class Wasmcfigen {
  constructor(functionSigFile, watPath) {
    
    this.indCallObj = {};
    this.sigObj = {};
    this.declCounts = 0;
    this.indCalls = 0;
    this.randIndexes = [];
    
    try {
      const sigFileData = fs.readFileSync(functionSigFile, "utf8");
      this.#parseSigFileIntoObj(sigFileData);
      this.#filterIndCallSync(watPath);

      // this.declCounts = funcDeclArr.length;
      // let funcObj = funcDeclArr.map((decl, index) => this.#parseIntoObj(decl, index));
      
      let indCallSigValList = this.#sortFuncsByTypeValue(this.indCallObj);
      this.#setSigObj(indCallSigValList);
      console.log(TYPEVAL)
    } catch (err) {
      console.log(`Processing Function Signature Failed`, err);
      return;
    }
  }

  #filterIndCallSync = (watPath) => {
      const elemFuncSection = this.#readElemSync(watPath);
      elemFuncSection.forEach((funcName, tableIdx) => {
        funcName = funcName.slice(1);
        this.indCallObj[funcName] = ( (declObj[funcName]) ? declObj[funcName] : {} );
        this.indCallObj[funcName].originalIdx = tableIdx + 1;
      });
  }

  #readElemSync = (watPath) => {
      let pathTokens = watPath.split("/");
      const watFileName = pathTokens.pop();
      const dirPath = ((pathTokens.length === 0) ? '.' : pathTokens.join('/'));
      const wasmPath = `${dirPath}/${watFileName.split(".")[0]}.wasm`;

      const isExist = this.#isWatExist(dirPath, watFileName);
      !isExist && this.#createWat(wasmPath, watPath);
      
      const watFileData = fs.readFileSync(watPath, "utf8");
      return watFileData
              .match(/\(elem(.*)\)/g)[0]
              .match(/func .*/)[0]
              .slice(0,-1)
              .split(" ")
              .slice(1);
  }

  #createWat = (wasmPath, watPath) => this.#exec(`${WABTPATH}/wasm2wat ${wasmPath} -o ${watPath}`);
  
  #parseSigFileIntoObj = (funcSigFile) => {
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
          declObj[funcName]=fs;
      })
  }

  modWatSync = (watPath) => {
    let pathTokens = watPath.split("/");
    const watFileName = pathTokens.pop();
    const dirPath = ((pathTokens.length === 0) ? '.' : pathTokens.join('/'));
    const wasmPath = `${dirPath}/${watFileName.split(".")[0]}.wasm`;

    // console.log("Mod Wat Start...", wasmPath, watPath);

    try {
      this.#indexRandomize();
      
      const isExist = this.#isWatExist(dirPath, watFileName);
      isExist
        ? this.#renewIndexSection(watPath)
        : this.#createAndModWat(wasmPath, watPath);

      this.#exec(`${WABTPATH}/wat2wasm ${watPath} -o ${wasmPath}`);
    } catch (err) {
      console.log(`Wasm-Cfi Error, Wat Modification Failed.`, err);
    }
  };

  // #parseIntoObj = (declStr, index) => {
  //   const funcName = declStr.split(",")[0];
  //   const retAndParams = declStr.match(/\[(.*?)\]/g);
  //   const typeLen = retAndParams.length;

  //   if (typeLen === 0)
  //     throw new Error("Wrong Format, At Least 1 Tokens(Name)");
  //   (typeLen === 1) && tokenArr.push("['void']");
    
  //   return {
  //     name: funcName,
  //     ret: this.#getRetTypeVal(retAndParams[0]),
  //     params: this.#getParamTypeVal(retAndParams.slice(1)),
  //     originalIdx: index + 1,
  //   };
  // };

 #getRetTypeVal = (retTypeStr) => {
    let expected = TYPEVAL[`${retTypeStr}`];
    if (typeof expected === "undefined") {
      TYPEVAL[`${retTypeStr}`] = typeCountGlobal;
      expected = typeCountGlobal++;
    }
    return expected;
  };

  #getParamTypeVal = (paramTypeStrArr) => {
    let expectedArr = paramTypeStrArr
      .map((paramTypeStr) => {
        let expected = TYPEVAL[`${paramTypeStr}`];
        if (typeof expected === "undefined") {
          TYPEVAL[`${paramTypeStr}`] = typeCountGlobal;
          expected = typeCountGlobal++;
        }
        return expected;
      });

    return expectedArr;
  };

  #convertTypeToValues = (funcSigList) => ( 
    funcSigList.map((sig) => {
      let retType = (sig[1].funcRets ? sig[1].funcRets : 'nil');
      let argTypes = (sig[1].funcArgs ? sig[1].funcArgs : ['void']);
      return {
        name: sig[0],
        ret: this.#getRetTypeVal(retType),
        params: this.#getParamTypeVal(argTypes),
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

  modWasmTable = (wasmTable, exported) => {
      Object.values(this.sigObj)
            .map(sigInfo => sigInfo.funcMem)
            .flat()
            .forEach((func) => {    
                let newIndex = this.randIndexes[func.originalIdx-1];
                if(newIndex > this.indCalls) newIndex += UNDECLARED_FUNCS;
                console.log("Set ", func.funcName , " at " , newIndex, " , original is ", func.originalIdx);

                wasmTable.set(newIndex, exported[func.funcName]);
            });
  };

  #isWatExist = (path, watFile) => fs.readdirSync(path).some(files => (files === watFile));

  #indexRandomize = () => {
    let indexPairs = [];
    let acc = 1;
    Object.values(this.sigObj)
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

  #renewIndexSection = (watPath) => {
    // console.log("WAT file exists... Renew Index Section...", watPath);

    let watFileData = fs.readFileSync(watPath, "utf8");
    let modifiedElemOffset = watFileData
      .match(/\(elem(.*)\)/g)[0]
      .match(/i32.const [0-9]*/)[0]
      .split(" ")[1];

    this.indCalls = parseInt(modifiedElemOffset) - 1;
    // console.log("Indirect Calls", this.indCalls);
    let newIndicesSection = watFileData.match(/\(data(.*)\)/g).pop();
    const newDataSectionStr = this.#getNewIndexesArray(
      this.randIndexes,
      this.indCalls
    );

    watFileData = watFileData.replace(
      newIndicesSection.match(/"(.*?)"/g)[0],
      `"${newDataSectionStr}"`
    );

    fs.writeFileSync(watPath, watFileData, "utf-8");
  };

  #composeFunc = (...funcArgs) => {
      return funcArgs.reduce(
        (prev, next) => (...args) => next(prev(...args)),
        k => k 
      )
  }

  #createAndModWat = (wasmPath, watPath) => {
    // console.log("WAT file does not exist... Create WAT file...", wasmPath, watPath);
    this.#exec(`${WABTPATH}/wasm2wat ${wasmPath} -o ${watPath}`);

    const watFileData = fs.readFileSync(watPath, "utf8");
    const modifiedWat = this.#composeFunc(this.#modTableSize, this.#modElemSection, this.#modElemSection)(watFileData);
    // const modifiedWat = this.#modDataSection(
    //   this.#modElemSection(this.#modTableSize(watFileData))
    // );
    fs.writeFileSync(watPath, modifiedWat, "utf-8", () => {
      console.log("Wat Creation & Modification Is Done.");
    });
  };

  #modTableSize = (watFileData) => {
    let tableSection = watFileData.match(/(table .* funcref)/g)[0];
    let preSize = tableSection.split(" ")[2];
    return watFileData.replace(
      tableSection,
      tableSection.replace(preSize, parseInt(preSize) + UNDECLARED_FUNCS + 1)
    );
  };

  #modElemSection = (watFileData) => {
    let elemSequence = 0;
    const elemFuncSection = watFileData
      .match(/\(elem(.*)\)/g)[0]
      .match(/func ([0-9]\s*)*/)[0]
      .split(" ")
      .slice(1);

    elemFuncSection.every((v) => {
      const funcNum = parseInt(v);
      let ret = true;
      elemSequence === 0
        ? (elemSequence = funcNum)
        : (elemSequence + 1 === funcNum)
        ? elemSequence++
        : (ret = false);
      ret == true && this.indCalls++;
      return ret;
    });

    return watFileData.replace(
      /\(elem(.*)\)/g,
      `(elem (;0;) (i32.const ${
        1 + this.indCalls
      }) func ${elemFuncSection.slice(this.indCalls).join(" ")})`
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

  #getDataSectionOffset = (lastDataSection) =>
    parseInt(
      lastDataSection
        .match(/i32.const [0-9]*/)[0]
        .split(" ")
        .pop()
    ) +
    lastDataSection
      .match(/"(.*?)"/g)[0]
      .split("\\")
      .slice(1).length;

  #getPaddingForUndeclaredIndCalls = (offset) => {
      let rst = '';   
      for (let i = 0; i < UNDECLARED_FUNCS; i++) {
          rst += this.#toLittleEndian(
            (offset + parseInt(i) + 1).toString(16)
          );
      }
      return rst;
  }

  #getNewIndexesArray = (idxArr, indcalleeCount) => {
    let hexValStr = "";
    idxArr.forEach((idx, originalIdx) => {
      (originalIdx == indcalleeCount) && (hexValStr += this.#getPaddingForUndeclaredIndCalls(indcalleeCount));
     
      let newIdx = parseInt(idx); 
      (newIdx > indcalleeCount)&& (newIdx += UNDECLARED_FUNCS);
      hexValStr += this.#toLittleEndian(parseInt(newIdx).toString(16));
    });
    return hexValStr;
  };

  #setIndexBoundaries = () => {
    let acc = 1;
    let result = "";
    let idxBoundPtrArray = [];
    Object.values(this.sigObj)
          .forEach( (sigInfo, funcSigIndex) => {
              sigInfo.funcMem.forEach((f) =>
                idxBoundPtrArray.push([f.originalIdx, funcSigIndex])
              );

              let lowerbound = acc;
              let upperbound = (acc += parseInt(sigInfo.count));
              
              result += (this.#toLittleEndian(lowerbound.toString(16)) +
                          this.#toLittleEndian(upperbound.toString(16)));
          });
                              
    const idxBoundForLibs =
      this.#toLittleEndian((this.indCalls + 1).toString(16)) +
      this.#toLittleEndian((this.indCalls + 5).toString(16));

    result += idxBoundForLibs;

    return {
      idxBounds: result,
      idxBoundBytes: (Object.keys(this.sigObj).length + 1) * 4 * 2,
      idxBoundPtrArray,
      idxBoundPtrBytes: (acc - 1 + UNDECLARED_FUNCS) * 4,
    };
  };

  #setIndexBoundPtrs = (
    offset,
    idxBoundBytes,
    idxBoundPtrArray,
    idxBoundPtrBytes
  ) => {
    let result = "";
    let offsetToIdxBounds = offset + idxBoundPtrBytes;
    idxBoundPtrArray
      .sort((a, b) => a[0] - b[0])
      .forEach((pair, index) => {
        if (index == this.indCalls) {
          for (let i = 0; i < UNDECLARED_FUNCS; i++) {
            result += this.#toLittleEndian(
              (offsetToIdxBounds + idxBoundBytes - 8).toString(16)
            );
          }
        }
        result += this.#toLittleEndian(
          (offsetToIdxBounds + 8 * pair[1]).toString(16)
        );
      });
    return result;
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
      idxBoundBytes,
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

  #getArrayRefStmt = (offset) =>
    `i32.const 1
        i32.sub
        i32.const 4
        i32.mul
        i32.load offset=${offset}`;

  #addDataSectionRefStmt = (
    watFileData,
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
          i32.load offset=4

          ${loadOriginalIdxStmt}
          ${this.#getArrayRefStmt(idxOffset)}
          
          i32.ge_u
          br_if 1
          br 0
        end
        call 24
    end
    ${loadOriginalIdxStmt}
    ${this.#getArrayRefStmt(idxOffset)}
		call_indirect`;

    return watFileData.replace(/call_indirect/g, dataSectionRefStmt).slice(0, -2);
  };

  #modDataSection = (watFileData) => { 
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
        watFileData,
        originalOffset,
        originalOffset + idxBoundPtrBytes + idxBoundBytes,
      ) +
      idxBoundDataSection +
      newIdxDataSection +
      globalForOriginalIdx
    );
  };

  getSigObj = () => {
    for (const [sig, detail] of Object.entries(this.sigObj)) {
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

  #setSigObj = (funcObjValList) => {
    let arr, sig;
    return funcObjValList.map((obj, index) => {
      if (index === 0) {
        arr = Array.of({ funcName: obj.name, originalIdx: obj.originalIdx });
        sig = this.#getSigVal(obj.ret, obj.params);
      }
      else if (index === funcObjValList.length - 1) {
        arr.push({ funcName: obj.name, originalIdx: obj.originalIdx });
        this.sigObj[sig] = { funcMem: arr, count: arr.length };
      }
      else {
        if (sig != this.#getSigVal(obj.ret, obj.params)) {
          this.sigObj[sig] = { funcMem: arr, count: arr.length };
          arr = Array.of({ funcName: obj.name, originalIdx: obj.originalIdx });
          sig = this.#getSigVal(obj.ret, obj.params);
        } else arr.push({ funcName: obj.name, originalIdx: obj.originalIdx });
      }
    });
  };

  #getSigVal = (ret, paramArr) =>
    `${ret}_${paramArr.reduce((acc, cur) => acc + "_" + cur)}`;

  #exec = (command) => execSync(command).toString().trim();
}

module.exports = Wasmcfigen;

let cfi = new Wasmcfigen(process.argv[2], process.argv[3]);
cfi.getSigObj();