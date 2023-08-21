import { createReadStream } from 'fs'
import { createSHA256 } from 'hash-wasm'
import mime from 'mime-types';
import pkg from 'form-data'
import saveAs from 'file-saver';
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
        const hash = this.hasher.digest('base64');
        return Promise.resolve(hash);
    };

    async validateFileType(fileObj){
        const fileType = mime.lookup(fileObj.name.split('.').pop());
        if (fileType === 'application/x-msdownload'||
            fileType === 'application/octet-stream') return '';
        else return fileType;
    }

    async signedPost (url, fields, fileObj, hash, fPath){
        
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
            else return ({error:`Upload failed with status ${response.status}`});
        });
        return resp;
    }

    constructor(){};

    async uploadFile(params){
        let uploadUrl
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
        try {
            uploadUrl = await fetch(apiEndpoint, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${authToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            }).then((response)=>response.json());
            if(uploadUrl.error) return ({error: uploadUrl.error});
        } catch (err) {
            return ({error: "Failed to get upload URL"});
        }
        
        const uploadResult = await this.signedPost(uploadUrl.url, uploadUrl.fields, fileObj, await hash, fPath? fPath: null);
        return uploadResult;
    };

    async downloadFile(key, apiEndpoint, authToken){
        let downloadUrl;
        const apiUrl = `${apiEndpoint}?key=${key}`;
        try{
            downloadUrl = await fetch(apiUrl, {
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${authToken}`,
                    'Content-Type': 'application/json'
                }
            }).then((response)=>response.json());
        }catch(err){
            console.error('Download failed');
            return ({error: 'Download failed'})
        }
        if(downloadUrl.error) return ({error: downloadUrl.error});

        try{
            const resp = await fetch(downloadUrl)
            const blob = await resp.blob();
            saveAs(blob, key.split('/').pop());
        } catch (err){
            console.error(err);
            return ({error: 'Download failed'})
        };
        return ('Download successfull');
    };
};

export default LocalUpload;