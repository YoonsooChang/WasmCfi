import * as FS from "fs";
import * as CHILDPROCESS from "child_process";

interface IndirectCallee {
  name: string;
  ret: number;
  params: number[];
  originalIdx: number;
}

const TYPEVALUES: object = {
  nil: -1,
  void: 0,
  i1: 1,
  i8: 2,
  i16: 3,
  i32: 4,
  f16: 5,
  f32: 6,
  f64: 7,
  "void*": 8,
};

let typeCountGlobal: number = Object.keys(TYPEVALUES).length - 1;

let watFileData: string;
let callSiteFuncs: object = {};

class Wasmcfigen {
  private _externPaths: object;
  private _indCallSigs: object = {};
  private _indCallCount: number = 0;
  private _funcInElemSections: string[];
  private _randIndices: number[];

  constructor(
    wabtBinPath: string,
    functionSignatureFilePath: string,
    watFilePath: string
  ) {
    this._externPaths = {
      wabtPath: `${wabtBinPath}`,
      watPath: `${watFilePath}`,
      wasmPath: "",
      funcSigPath: `${functionSignatureFilePath}`,
    };

    try {
      callSiteFuncs = JSON.parse(
        `{${FS.readFileSync(this._externPaths[`funcSigPath`], "utf-8")}}`
      );
      this.runFuncChains(
        this.filterIndCalleeSync,
        this.sortFuncsByTypeValue,
        this.setIndCallSigs
      )(this._externPaths[`watPath`]);
    } catch (err) {
      console.log(`Signature Processing Failed`, err);
      return;
    }
  }

  public getIndCallSigs = (): object => this._indCallSigs;

  private filterIndCalleeSync = (watPath: string): object => {
    this._funcInElemSections = this.readElemSync(watPath);
    this._indCallCount = this._funcInElemSections.length;

    let indCallObj = {};
    this._funcInElemSections.forEach((funcName, tableIdx) => {
      funcName = funcName.slice(1);

      const Type = callSiteFuncs[funcName]
        ? callSiteFuncs[funcName].Type
        : { ret: "", args: [] };

      indCallObj[funcName] = {
        Type: Type,
        originalIdx: tableIdx + 1,
      };
    });

    return indCallObj;
  };

  private isWatExist = (path: string, watFile: string): boolean =>
    FS.readdirSync(path).some((files) => files === watFile);

  private readElemSync = (watPath: string): string[] => {
    let pathTokens = watPath.split("/");
    const watFileName = pathTokens.pop();
    const dirPath = pathTokens.length === 0 ? "." : pathTokens.join("/");

    this._externPaths[`wasmPath`] = `${dirPath}/${
      watFileName.split(".")[0]
    }.wasm`;

    const isExist = this.isWatExist(dirPath, watFileName);
    !isExist && this.createWat(this._externPaths[`wasmPath`], watPath);

    watFileData = FS.readFileSync(watPath, "utf8");

    return watFileData
      .match(/\(elem(.*)\)/g)[0]
      .match(/func .*/)[0]
      .slice(0, -1)
      .split(" ")
      .slice(1);
  };

  private createWat = (wasmPath: string, watPath: string): string =>
    this.exec(
      `${this._externPaths["wabtPath"]}/wasm2wat ${wasmPath} -o ${watPath}`
    );

  private getTypeValue = (typeStr: string): number => {
    let expected = TYPEVALUES[`${typeStr}`];
    if (typeof expected === "undefined") {
      TYPEVALUES[`${typeStr}`] = typeCountGlobal;
      expected = typeCountGlobal++;
    }

    return expected;
  };

  private convertTypeToValues = (funcList: object[]): IndirectCallee[] =>
    funcList.map((func) => {
      const typeObj = func[1].Type;
      let retType = typeObj.ret === "" ? "void" : typeObj.ret;
      let argTypes = typeObj.args.length === 0 ? ["nil"] : typeObj.args;

      return {
        name: func[0],
        ret: this.getTypeValue(retType),
        params: argTypes.map((argType) => this.getTypeValue(argType)),
        originalIdx: func[1].originalIdx,
      };
    });

  private sortFuncsByTypeValue = (indCallObj: object): IndirectCallee[] => {
    let sigValList = this.convertTypeToValues(Object.entries(indCallObj));
    sigValList.sort((a, b) => {
      return a.ret - b.ret
        ? a.ret - b.ret
        : this.compareParams(a.params, b.params);
    });

    return sigValList;
  };

  private compareParams = (a: number[], b: number[]): number => {
    const alen = a.length;
    const blen = b.length;
    const gap = Math.abs(alen - blen);

    let swapOrNot = -1;
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

  private setIndCallSigs = (funcObjValList: IndirectCallee[]): void => {
    let arr, sig;
    funcObjValList.forEach((obj, index) => {
      const funcSigVal = this.getSigVal(obj.ret, obj.params);

      if (index === 0) {
        arr = Array.of({ funcName: obj.name, originalIdx: obj.originalIdx });
        sig = funcSigVal;
      } else if (sig !== funcSigVal) {
        this._indCallSigs[sig] = { funcMem: arr, count: arr.length };
        sig = funcSigVal;
        arr = Array.of({ funcName: obj.name, originalIdx: obj.originalIdx });
      } else {
        arr.push({ funcName: obj.name, originalIdx: obj.originalIdx });
      }

      if (index === funcObjValList.length - 1)
        this._indCallSigs[sig] = { funcMem: arr, count: arr.length };
    });
  };

  private getSigVal = (ret: number, paramArr: number[]): string => {
    paramArr.length === 0 && (paramArr = [-1]);
    return `${ret}_${paramArr.join("_")}`;
  };

  private genUniqueRands = (range: number): number[] => {
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

  private indexRandomize = (): void => {
    let indexPairs = [];
    Object.values(this._indCallSigs).reduce((acc, sigInfo) => {
      const randArr = this.genUniqueRands(sigInfo.count);
      sigInfo.funcMem.forEach((func, index) =>
        indexPairs.push([func.originalIdx, randArr[index] + acc])
      );
      return (acc += sigInfo.count);
    }, 1);

    this._randIndices = indexPairs
      .sort((a, b) => a[0] - b[0])
      .map((pair) => pair[1]);
  };

  public modWatSync = (): void => {
    const watPath = this._externPaths["watPath"];
    console.log(`Starting Wat File Modification...`, watPath);

    try {
      this.indexRandomize();

      const isWatModifiedBefore = this.isWatModified();
      isWatModifiedBefore
        ? this.renewElemAndIndexSection(watPath)
        : this.modNaiveWat(watPath);

      this.exec(
        `${this._externPaths[`wabtPath`]}/wat2wasm ${watPath} -o  ${
          this._externPaths[`wasmPath`]
        }`
      );
    } catch (err) {
      console.error(`Wasm-Cfi Error, Wat Modification Failed.`, err);
    }
  };

  private isWatModified = (): boolean =>
    watFileData
      .split("\n")
      .pop()
      .match(/\(global(.*)\)/g) != null;

  private renewElemAndIndexSection = (watPath: string): void => {
    console.log(
      `Wat Was Modified Before... Renew Functions In Elem Section And Index Data Section.`
    );
    this.modElemSection();
    let newIndicesSection = watFileData.match(/\(data(.*)\)/g).pop();
    const newDataSectionStr = this.getNewIndexesArray(this._randIndices);

    watFileData = watFileData.replace(
      newIndicesSection.match(/"(.*?)"/g)[0],
      `"${newDataSectionStr}"`
    );

    FS.writeFileSync(watPath, watFileData, "utf-8");
  };

  private getNewIndexesArray = (idxArr: number[]): string => {
    const hexValueStr = idxArr.reduce(
      (pre, newIdxStr) =>
        pre +
        this.toLittleEndian(parseInt(newIdxStr.toString(10)).toString(16)),
      ""
    );

    return hexValueStr;
  };

  private modNaiveWat = (watPath: string): void => {
    console.log(
      `Wat Modification... Elem Section Will Be Modified, Call Indirect Statement And Data Sections For Randomized Index Will Be Added.`
    );

    const modifiedWat = this.runFuncChains(
      this.modElemSection,
      this.modDataSection
    )();

    FS.writeFileSync(watPath, modifiedWat, "utf-8");
  };

  private modElemSection = (): void => {
    console.log("Modify Elem Section...");
    let newElemFuncArr = Array.of(this._indCallCount);

    Object.values(this._indCallSigs)
      .map((sigInfo) => sigInfo.funcMem)
      .flat()
      .forEach((func) => {
        const newIndex = this._randIndices[func.originalIdx - 1];
        newElemFuncArr[newIndex - 1] = func.funcName;
      });

    const newElemFuncStr = newElemFuncArr
      .reduce((acc, cur) => acc + `$${cur} `, "")
      .slice(0, -1);

    watFileData = watFileData.replace(
      this._funcInElemSections.join(" "),
      newElemFuncStr
    );
  };

  private modDataSection = (): string => {
    console.log("Modify Data Section...");
    const originalOffset = 65535;
    const funcBlockRegex = /\(func \$(.)*\n(\s*([^)(]*?)\(([^)(]+?)\)|\s*([^)(]*?))*([^)(]*?)\)/gm;
    const isFromExternalLib = (func) => !callSiteFuncs[func];
    const hasIndCall = (func) => callSiteFuncs[func].Calls.length > 0;

    this.setIndexBoundaries();
    console.log("Set Fixed Range Checkers...");

    watFileData.match(funcBlockRegex).forEach((funcBlock) => {
      let modFuncBlock = funcBlock;
      const fName = funcBlock
        .match(/\(func \$[0-9|a-z|A-Z|\_]*/g)[0]
        .split("$")[1];

      if (isFromExternalLib(fName)) {
        const rangeChecker = this.getIndexRangeCheckStmt(
          originalOffset,
          this._indCallSigs[`0_-1`].lowerbound,
          this._indCallSigs[`0_-1`].upperbound
        );
        modFuncBlock = modFuncBlock.replace(/call_indirect/g, rangeChecker);
      } else if (hasIndCall(fName)) {
        callSiteFuncs[fName].Calls.forEach((call) => {
          let typeValueStr = this.getSigVal(
            this.getTypeValue(call.ret),
            call.args.map((argType) => this.getTypeValue(argType))
          );
          typeValueStr = this._indCallSigs[typeValueStr]
            ? typeValueStr
            : `0_-1`;
          const rangeChecker = this.getIndexRangeCheckStmt(
            originalOffset,
            this._indCallSigs[typeValueStr].lowerbound,
            this._indCallSigs[typeValueStr].upperbound
          );
          modFuncBlock = modFuncBlock.replace(/call_indirect/, rangeChecker);
        });
      }
      watFileData = watFileData.replace(funcBlock, modFuncBlock);
    });
    watFileData = watFileData.replace(/call_mindirect/g, "call_indirect");

    console.log("Render new index section...");
    const newIdxDataSection = `\n\t(data (i32.const ${originalOffset}) "${this.getNewIndexesArray(
      this._randIndices
    )}")`;
    const globalForOriginalIdx = `\n\t(global (mut i32) (i32.const ${
      originalOffset + 4 * this._indCallCount
    })))`;

    return watFileData.slice(0, -2) + newIdxDataSection + globalForOriginalIdx;
  };

  private toLittleEndian = (hexStr: string): string => {
    if (hexStr.length % 2 === 1) hexStr = "0".concat(hexStr);
    let rst = "";
    for (let i = hexStr.length / 2; i > 0; i--)
      rst += "\\" + hexStr.substr((i - 1) * 2, 2);
    if (hexStr.length / 2 < 4) {
      for (let i = 0; i < 4 - hexStr.length / 2; i++) rst += "\\00";
    }
    return rst;
  };

  private setIndexBoundaries = (): void => {
    console.log("set index bound ...");
    let acc = 1;
    Object.entries(this._indCallSigs).forEach((sigEntry) => {
      const sigValue = sigEntry[0];
      const sigDetail = sigEntry[1];
      const lowerbound = acc;
      const upperbound = (acc += parseInt(sigDetail.count));
      this._indCallSigs[sigValue].lowerbound = lowerbound;
      this._indCallSigs[sigValue].upperbound = upperbound;
    });
  };

  private getArrayRefStmt = (offset: number): string =>
    `i32.const 1
        i32.sub
        i32.const 4
        i32.mul
        i32.load offset=${offset}`;

  private getIndexRangeCheckStmt = (
    idxOffset: number,
    lowerbound: number,
    upperbound: number
  ): string => {
    const saveOriginalIdxStmt = `\n\t\t\tglobal.set 2`;
    const loadOriginalIdxStmt = "\n\t\t\tglobal.get 2";

    const modifiedIndCallStmt = `${saveOriginalIdxStmt}
      \t\t\ti32.const ${lowerbound}
      \t\t\ti32.const ${upperbound}
      \t\t\t${loadOriginalIdxStmt}
      ${this.getArrayRefStmt(idxOffset)}
      \t\t\tcall $check_index_range
    
      ${loadOriginalIdxStmt}
      ${this.getArrayRefStmt(idxOffset)}
		call_mindirect`;

    return modifiedIndCallStmt;
  };

  private runFuncChains = (...funcArgs) => {
    return funcArgs.reduce(
      (prev, next) => (...args) => next(prev(...args)),
      (k) => k
    );
  };

  private exec = (command) => CHILDPROCESS.execSync(command).toString().trim();

  static printSignatureSets = (cfiGen: Wasmcfigen): void => {
    const signatureSets = cfiGen.getIndCallSigs();
    const result = Object.entries(signatureSets).reduce(
      (pre, [sig, detail]) =>
        pre +
        `${sig} : {\tfuncMem : {\n` +
        detail.funcMem.reduce(
          (pre, func) =>
            pre +
            `\t\t{\n` +
            Object.entries(func).reduce(
              (pre, [key, val]) => pre + `\t\t\t${key} : ${val}\n`,
              ""
            ) +
            `\t\t}\n`,
          ``
        ) +
        `\t}\n` +
        `\tLB : ${detail.lowerbound},\n` +
        `\tUB : ${detail.upperbound},\n` +
        `\tcount : ${detail.count}}\n`,
      ``
    );
    console.log(result);
  };
}

module.exports = Wasmcfigen;

let cfi = new Wasmcfigen(process.argv[2], process.argv[3], process.argv[4]);
cfi.modWatSync();
Wasmcfigen.printSignatureSets(cfi);
