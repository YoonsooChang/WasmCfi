const fs = require('fs');
const execSync = require('child_process').execSync;

const WABTPATH = `../bin/`;
const TYPEVAL = {
    'nil' : -1,
    'void' : 0,
    'bool' : 1,
    'char' : 2,
    'unsigned char' : 3,
    'short' : 4,
    'unsigned short' : 5,
    'int' : 6,
    'unsigned' : 7,
    'unsigned int' : 8,
    'long' : 9,
    'unsigned long' : 10,
    'long long' : 11,
    'long long int': 12,
    'unsigned long long': 13,
    'unsigned long long int':14,
    'float' : 15,
    'double' : 16,
    'long double' : 17,
    
    'void*' : 17,
    'char*' : 18,
    'int*' : 19,
};

let typeCountGlobal = Object.keys(TYPEVAL).length - 1;

class WasmCfigen { 
    constructor(functionSigFile) {
        try {
            this.sigObj = {};
            this.declCounts = 0;
            this.indCalls = 0;
            this.randIndexes  = [];

            const funcDeclArr = fs.readFileSync(functionSigFile, 'utf8').split('\n');
            let funcObj = funcDeclArr.map((decl, index) => this.#parseIntoObj(decl, index));
            
            this.#sortFuncsByTypeValue(funcObj); 
            this.#setSigObj(funcObj);
        } catch (err) {
            console.log(`Processing Function Signature Failed`, err);
            return;
        } 
    }

    modWasmTable = (wasmTable, exported) => {
         
    }

    modWat = (watPath) => {
        let pathTokens = watPath.split('/');
        const watFileName = pathTokens.pop();
        const dirPath = pathTokens.join('/');
        const wasmPath = `${dirPath}/${watFileName.split('.')[0]}.wasm`;

        try {
            this.#isWatExist(dirPath, watFileName, (err, isExist) => {
                if(err) throw(err);
            
                this.indexRandomize();

                (isExist) 
                ? this.renewIndexSection(watPath)
                : this.#createAndModWat(wasmPath, watPath);
                
                this.#exec(`${WABTPATH}/wat2wasm ${watPath} -o ${wasmPath}`);
            });
        } catch(err){
            console.log(`Wasm-Cfi Error, Wat Modification Failed.`, err);
        }
    }
 
    #isWatExist = (path, watFile, callback) => {
        fs.readdir(path, (err, files) => {
            if(err) return callback(err);
            let isExist = files.some((files === watFile));
            return callback(null, isExist);
        }) 
    }

    indexRandomize = () => {
        let indexPairs = []
        let acc = 1;
        Object.values(this.sigObj).map((obj) => {
            const randArr = this.#getRands(obj.count);
            obj.funcMem.forEach( (func, index)  => {
                                        indexPairs.push( [func.originalIdx, randArr[index] + acc] )
                                    });
            acc += obj.count;
        })
        this.randIndexes = indexPairs.sort((a,b) => (a[0] - b[0]))
                                        .map(pair => pair[1]);
    }

    #getRands = (cnt) => {
        let arr = [];
        let rand;
        for(let i=0; i < cnt; i++) {
            do { 
                rand = Math.floor(Math.random()  * cnt);
            } while(arr.some((e) => e === rand))
            arr.push(rand);
        }
        return arr;
    }

    renewIndexSection = (watPath) => {
        let watFileData = fs.readFileSync(watPath, 'utf8');
        let modifiedElemOffset = watFileData .match(/\(elem(.*)\)/g)[0]
                                        .match(/i32.const [0-9]*/)[0]
                                        .split(' ')[1];

        this.indCalls = modifiedElemOffset - 1;

        let newIndicesSection = watFileData.match(/\(data(.*)\)/g).pop();
        const newDataSectionStr = this.#getNewIndexesArray(this.randIndexes, this.indCalls);
        
        watFileData = watFileData.replace(newIndicesSection.match(/"(.*?)"/g)[0], `"${newDataSectionStr}"`);

        fs.writeFileSync(watPath, watFileData, 'utf-8', ()=>{console.log("Index Array Is Renewed.")});
    }

    #createAndModWat = (wasmPath, watPath) => {
        this.#exec(`${WABTPATH}/wasm2wat ${wasmPath} -o ${watPath}`);

        const watFileData = fs.readFileSync(watPath, 'utf8');
        this.modDataSection( this.#modElemSection( this.#modTableSize(watFileData) ) );
        
    } 

    #modTableSize = (watFileData) =>{
        let tableSection = (watFileData.match(/(table .* funcref)/g)[0]);
        let preSize = tableSection.split(' ')[2];
        return watFileData.replace(tableSection,
                                   tableSection.replace(preSize,  parseInt(preSize)+5));
    }

    #modElemSection = (watFileData)=>{
        isSequential = (cur, next) => (cur + 1 === next); 

        elemSequence = 0;
        let elemFuncSection = watFileData.match(/\(elem(.*)\)/g)[0]
                                        .match(/func ([0-9]\s*)*/)[0]
                                        .split(' ')
                                        .slice(1);

        elemFuncSection.every((v) => {
                const funcNum = parseInt(v);
                let ret = true;
                (elemSequence === 0)  ? (elemSequence = funcNum) 
                                      : (isSequential(elemSequence, funcNum)) ? (elemSequence++)
                                                                              : (ret = false);
                (ret == true && this.indCalls++); 
                return ret;
            });
        
        return watFileData.replace(/\(elem(.*)\)/g,
                        `(elem (;0;) (i32.const ${1 + this.indCalls}) func ${elemFuncSection.slice(this.indCalls).join(' ')})`);
    }
    
    #toLittleEndian = (hexStr) => {
        if((hexStr.length)%2 === 1) hexStr = '0'.concat(hexStr); 
        let rst = '';
        for(let i = hexStr.length/2 ; i > 0; i--)
            rst += ('\\' + hexStr.substr((i-1)*2, 2));
        if(hexStr.length/2 < 4){
            for(let i=0; i < 4-hexStr.length/2; i++)
                (rst += '\\00');
        }
        return rst;
    }

    #getDataSection = (lastDataSection) => (
        {
            offset : lastDataSection.match(/i32.const [0-9]*/)[0].split(' ').pop(),
            bytes : lastDataSection.match(/"(.*?)"/g)[0].split('\\').slice(1,-1).length,
        }
    );

    #getNewIndexesArray = (idxArr, indcalleeCount ) => {
        // console.log(idxArr, indcalleeCount);
        let hexValStr ='';
        idxArr.forEach((idx, originalIdx) => {
            let newIdx = parseInt(idx);
            if(originalIdx == indcalleeCount) {
                for(let i=0; i<5; i++){
                    hexValStr += this.#toLittleEndian((indcalleeCount + parseInt(i) + 1).toString(16)); 
                }
            }
            if(newIdx > indcalleeCount - 1) newIdx += 5;
            hexValStr += this.#toLittleEndian(parseInt(newIdx).toString(16));
        })
        return hexValStr;
    }

    setIndexBoundaries = () => {
        let acc = 1;
        let result = '';
        let idxBoundPtrArray = [];
        let funcSigCnt = 0;
        for(const [_, funcSigInfo] of Object.entries(this.sigObj)){
            funcSigInfo.funcMem.forEach((f) => idxBoundPtrArray.push([f.originalIdx, funcSigCnt]));
            funcSigCnt++;

            let lowerbound = acc;
            let upperbound = (acc += parseInt(funcSigInfo.count));
            result += ( this.#toLittleEndian(lowerbound.toString(16)) + this.#toLittleEndian(upperbound.toString(16)) );
        }

        const idxBoundForLibs = this.#toLittleEndian((this.indCalls+1).toString(16)) + this.#toLittleEndian((this.indCalls+5).toString(16))
        result += idxBoundForLibs;
        return {
                    idxBounds : result,
                    idxBoundBytes : (funcSigCnt + 1) * 4 * 2,
                    idxBoundPtrArray,
                    idxBoundPtrBytes : (acc + 5) * 4,         
                };
    }

    setIndexBoundPtrs = (offset, idxBoundBytes, idxBoundPtrArray, idxBoundPtrBytes) => {
        let result = '';
        let offsetToIdxBounds = offset  + idxBoundPtrBytes;
        idxBoundPtrArray.sort((a,b) => a[0] - b[0]).forEach((pair, index) => {
             if(index == this.indCalls) {
                for(let i=0; i<5; i++){
                    result += this.#toLittleEndian((offsetToIdxBounds + idxBoundBytes - 8).toString(16)); 
                }
            }
            result += (this.#toLittleEndian((offsetToIdxBounds + (8 * pair[1]) ).toString(16)));
        });
        console.log(idxBoundPtrArray);
        return result;
    }

    getIndexBoundarySections = (offset, bytes) => {
        let result = '';
        let currentOffset = parseInt(offset) + bytes;
        let { idxBounds, idxBoundBytes, idxBoundPtrArray, idxBoundPtrBytes } = this.setIndexBoundaries();
        let idxBoundPtrs = this.setIndexBoundPtrs(currentOffset, idxBoundBytes, idxBoundPtrArray, idxBoundPtrBytes ); 
       
        result += ( (`\n\t(data (i32.const ${currentOffset}) "${idxBoundPtrs}")
        \n\t(data (i32.const ${currentOffset + idxBoundPtrBytes}) "${idxBounds}")`));
        
        return { 
                    idxBoundDataSection : result,
                    lastOffset : currentOffset + idxBoundPtrBytes + idxBoundBytes,
               };     
    }

    modDataSection = (watFileData) =>{    
        //tmp
                let modifiedElemOffset = watFileData .match(/\(elem(.*)\)/g)[0]
                                        .match(/i32.const [0-9]*/)[0]
                                        .split(' ')[1];

                this.indCalls = modifiedElemOffset - 1;
        //tmp

            const { offset , bytes } = this.#getDataSection(watFileData.match(/\(data(.*)\)/g).pop());
            console.log('ORIGINAL OFFSET : ' , parseInt(offset)+bytes);
            const {idxBoundDataSection, lastOffset } = this.getIndexBoundarySections(offset, bytes); 
            const newIdxDataSection =  `\n\t(data (i32.const ${lastOffset})
                                         "${this.#getNewIndexesArray(this.randIndexes, this.indCalls)}"))`

            console.log('IB SECT : ', idxBoundDataSection);
            console.log('LAST OFFSET : ', lastOffset);
            console.log('IDX SECT : ', newIdxDataSection);

            const idxCheckStmt = `i32.const 1\ni32.sub\ni32.const 4\ni32.mul\ni32.load offset=${lastOffset}\ncall_indirect`
            const boundCheckStmt = ;

            watFileData.replace(/call_indirect/g, 
                        `i32.const 1\ni32.sub\ni32.const 4\ni32.mul\ni32.load offset=${parseInt(offset) + bytes}\ncall_indirect`)
                                    + '\n' + idxBoundDataSection + newIdxDataSection;
    }

    getSigObj = () => {
        for(const [sig, detail] of Object.entries(this.sigObj)){
            console.log(`${sig} : { `);
            detail.funcMem.forEach((func)=>{
                console.log(`   {`);
                for(const [key, val] of Object.entries(func)){
                    console.log(`       ${key} : ${val}`);
                }
                console.log(`   }`);
            });
            console.log(`   count : ${detail.count}`);
        }
    }
    
    #setSigObj = (funcObjList) => {
         let arr, sig;
         return funcObjList.map((obj, index) => {
                if(index === 0) {
                    arr = Array.of({funcName : obj.name,  originalIdx : obj.originalIdx});
                    sig = this.#getSigVal(obj.ret, obj.params);
                }
                else if(index === funcObjList.length-1) this.sigObj[sig] = { funcMem : arr, count : arr.length };
                else {
                    if(sig != this.#getSigVal(obj.ret, obj.params)){
                        this.sigObj[sig] = { funcMem : arr, count : arr.length };
                        arr = Array.of({funcName : obj.name,  originalIdx : obj.originalIdx});
                        sig = this.#getSigVal(obj.ret, obj.params);
                    } else arr.push({funcName : obj.name,  originalIdx : obj.originalIdx});    
                }
            })
    };

    #getSigVal = (ret, paramArr) => `${ret}_${paramArr.reduce((acc, cur) => acc+"_"+cur)}`;

    #parseIntoObj = (declStr, index) => {
        this.declCounts++;

        const funcName = declStr.split(',')[0];
        let retAndParams = declStr.match(/\[(.*?)\]/g);

        const typeCount = retAndParams.length;
        if(typeCount === 0) throw new Error("Wrong Format, At Least 1 Tokens(Name)");
        if(typeCount < 2) {
            for(let i = 0; i < 3-typeCount; i++) 
                tokenArr.push("['void']");
        }

        return {
            name : funcName,
            ret : this.#getRetTypeStr(retAndParams[0]),
            params : this.#getParamTypeStr(retAndParams.slice(1)),
            originalIdx : index+1,
        } 
    }

    #getRetTypeStr = (retTypeStr) => {
        retTypeStr = retTypeStr.split("', '").join(' ').slice(2,-2);

        let expected = TYPEVAL[retTypeStr];
        if(expected === 'undefined') {
            TYPEVAL[retTypeStr] = typeCountGlobal;
            expected = typeCountGlobal;
            typeCountGlobal++;
        }
        return expected;
    }

    #getParamTypeStr = (paramTypeStrArr) => {
        let typeArr = paramTypeStrArr.map((str) => str.slice(2,-2))
                    .map((type) => {
                            let expected = TYPEVAL[type];
                            if(typeof(expected)==='undefined') {
                                TYPEVAL[type] = typeCountGlobal;
                                expected = typeCountGlobal;
                                typeCountGlobal++;
                            }
                            return expected;
                        });

        return typeArr;
    }

    #sortFuncsByTypeValue = (funcSigList) => {
        funcSigList.sort((a, b) => {
            return (a.ret - b.ret) 
                ?  (a.ret - b.ret)
                : this.#compareParams(a.params, b.params)
        });
    }

    #compareParams = (a, b) => {
        const alen = a.length;
        const blen = b.length;
        const gap = Math.abs(alen - blen);
        
        let swapOrNot = false;
        let _a = Array.from(a);
        let _b = Array.from(b);
        if(alen > blen){
            for(let i = 0; i < gap; i++)
                _b.push(0);
        } else {
            for(let i = 0; i < gap; i++)
                _a.push(0);
        }

        for(let i = 0; i< _a.length; i++){
            if(_a[i] != _b[i]){
                swapOrNot = _a[i] - _b[i];
                break;
            }
        }
        return swapOrNot;
    } 
        
    #exec = (command) => execSync(command).toString().trim();
} 

let inst = new WasmCfigen(process.argv[2]);
inst.getSigObj();
inst.indexRandomize();
            let watFileData = fs.readFileSync('newcfi_icall/newcfi.wat', 'utf8');       

inst.modDataSection(watFileData);
// inst.renewDataSection(`newcfi_icall/newcfi.wat`);

module.exports = WasmCfigen;