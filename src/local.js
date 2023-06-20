import { createReadStream } from 'fs'
import { createSHA256 } from 'hash-wasm'
import mime from 'mime-types';
import pkg from 'form-data'
const FormData =  pkg;

class LocalUpload{

    chunkSize  = 64 * 1024 * 1024; // 64MB
    maxFileSize = 5 * 1024 * 1024 * 1024; // 5GB
    hasher = null;

    hashChunk(chunk){
        return new Promise((resolve, reject) => {
             fileReader.onload = async (e) => {
                const view = new Uint8Array(e.target.result);
                this.hasher.update(view);
                resolve();
            };
            fileReader.readAsArrayBuffer(chunk);
        });
    }

    async generateHash(fileObj){
        if (this.hasher){
            this.hasher.init();
        } else {
            this.hasher = await createSHA256();
        }

        const chunkNumber = Math.floor(fileObj.size / this.hunkSize);

        for (let i = 0; i < chunkNumber; i++){
            const chunk = fileObj.slice(
                i * chunkSize,
                Math.min(chunkSize * (i + 1), fileObj.size)
            )
            await hashChunk(chunk);
        }
        const hash = this.hasher.digest();
        return Promise.resolve(hash);
    };

    async validateFileType(fileObj){
        const fileType = mime.lookup(fileObj.name.split('.').pop());
        console.log(fileType);
        if (fileType.includes('application')) return '';
        else return fileType;
        // if(fileObj.type.split('/').pop() !== 'unknown')return fileObj.type;
        // switch(fileObj.name.split('.').pop()){ // added additional cases later
        //     case 'png': return 'image/png';
        //     case 'txt': return 'text/plain';
        //     case 'exe': return '';
        //     default: return `${fileObj.type.split('/')[0]}/${fileObj.name.split('.').pop()}`;
        // }
    }

    async signedPost (url, fields, fileObj, fPath){
        
        const form = new FormData();
        Object.entries(fields).forEach(([field, value]) => {
            form.append(field, value);
        });

        fPath? form.append('file', createReadStream(fPath)): form.append('file', fileObj);
        
        const resp = await fetch(url, {
            method: 'POST',
            body: form
        }).then((response)=>{
            if (response.status === 204) return 'Upload successfull';
            else throw new Error(`Upload failed with status ${response.status}`);
        });
        return resp;
    }

    constructor(){};

    async uploadFile(params){
        const { fileObj, apiEndpoint, authToken, fPath, submissionId } = params;
        if (fileObj.size > this.maxFileSize){return ('File too large')}
        const hash  = this.generateHash(fileObj);
        const fileType = this.validateFileType(fileObj);
        const payload = {
            file_name: fileObj.name,
            file_type: await fileType,
            checksum_value: await hash,
            ...(submissionId && {submission_id: submissionId})
        };
        const uploadUrl = await fetch(apiEndpoint, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        }).then((response)=>response.json()); //finish fetch
        const uploadResult = await this.signedPost(uploadUrl.url, uploadUrl.fields, fileObj, fPath? fPath: null);
        return uploadResult;
    };
};

export default LocalUpload;