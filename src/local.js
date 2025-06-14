const hashWasm = require('hash-wasm');
const mime = require('mime-types');
const formData = require('form-data');
const fileSaver = require('file-saver');

const createSHA256 = hashWasm.createSHA256;
const saveAs = fileSaver.saveAs;
const FormData = formData;

// Ignoring for coverage due to an inability to meaningfully mock
// File and FileReader objects in the test environment
/* istanbul ignore next */
async function unit8ToBase64(unit8Array) {
    // use a FileReader to generate a base64 data URI:
    const base64url = await new Promise(r => {
        const reader = new FileReader()
        reader.onload = () => r(reader.result)
        reader.readAsDataURL(new Blob([unit8Array]))
    });
    // remove the `data:...;base64,` part from the start
    return base64url.slice(base64url.indexOf(',') + 1);        
}

class LocalUpload{

    chunkSize  = 64 * 1024 * 1024; // 64MB
    maxFileSize = 5 * 1024 * 1024 * 1024; // 5GB
    /* istanbul ignore next */
    fileReader = new FileReader();
    hasher = null;

    
    // Ignoring for coverage due to an inability to meaningfully mock
    // File and FileReader objects in the test environment
   /* istanbul ignore next */
    hashChunk(chunk){
        return new Promise((resolve, reject) => {
             this.fileReader.onload = async (e) => {
                const view = new Uint8Array(e.target.result);
                this.hasher.update(view);
                resolve();
            };
            this.fileReader.readAsArrayBuffer(chunk);
        });
    }
    // Ignoring for coverage due to an inability to meaningfully mock
    //File and FileReader objects in the test environment
    /* istanbul ignore next */
    async generateHash(fileObj){
        if (this.hasher){
            this.hasher.init();
        } else {
            this.hasher = await createSHA256();
        }

        const chunkNumber = Math.floor(fileObj.size / this.chunkSize);
        for (let i = 0; i <= chunkNumber; i++){
            const chunk = fileObj.slice(
                i * this.chunkSize,
                Math.min(this.chunkSize * (i + 1), fileObj.size)
            )
            await this.hashChunk(chunk);
        }
        const hash = this.hasher.digest('binary');
        const hashBase64 = await unit8ToBase64(hash);
        return Promise.resolve(hashBase64);
    };

    async validateFileType(fileObj){
        const fileType = mime.lookup(fileObj.name.split('.').pop());
        if (fileType === 'application/x-msdownload'||
            fileType === 'application/octet-stream') return '';
        else return fileType;
    }

    async signedPost(url, fields, fileObj, hash, onProgress) {
        const formData = new FormData();
        
        // Append fields to FormData
        for (const [field, value] of Object.entries(fields)) {
            formData.append(field, value);
        }
    
        // Append file to FormData
        formData.append('file', fileObj);

        // Create XMLHttpRequest object
        const xhr = new XMLHttpRequest();

        // Configure progress tracking
        xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
                const percentage = Math.round((event.loaded / event.total) * 100);
                onProgress(percentage, fileObj)
            }
        };

        // Send the request
        xhr.open('POST', url);
        xhr.setRequestHeader('x-amz-checksum-sha256', hash);
        xhr.setRequestHeader('x-amz-checksum-algorithm', 'SHA256');
        
        // Wrap XMLHttpRequest in a promise
        const response = await new Promise((resolve, reject) => {
            xhr.onload = () => {
                if (xhr.status === 204) {
                    resolve('Upload successful');
                } else {
                    reject({ error: `Upload failed with status ${xhr.status}` });
                }
            };
            xhr.onerror = () => {
                reject({ error: 'Upload failed due to network error' });
            };
            xhr.send(formData);
        });

        return response;
    }
    
    

    constructor(){};

    async uploadFile(params, onProgress){
        let uploadUrl
        const { fileObj, apiEndpoint, authToken, submissionId, endpointParams } = params;
        if (fileObj.size > this.maxFileSize){return ('File too large')}
        const hash  = this.generateHash(fileObj);
        const fileType = this.validateFileType(fileObj)
        const payload = {
            file_name: fileObj.name,
            file_type: await fileType,
            checksum_value: await hash,
            ...(submissionId && {submission_id: submissionId}),
            ...endpointParams
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
        try{
            const uploadResult = await this.signedPost(uploadUrl.url, uploadUrl.fields, fileObj, await hash, onProgress);
            return uploadResult;
        }catch(err){
            return ({error: "failed to upload to bucket"});
        }
    };

    // Ignoring coverage due to an inability to meaningfully mock fetch
    // and retain the ability to test the download functionality
    /* istanbul ignore next */
    async downloadFile(key, apiEndpoint, authToken){
        let downloadUrl;
        const apiUrl = `${apiEndpoint}?key=${encodeURIComponent(key)}`;
        try{
            downloadUrl = await fetch(apiUrl, {
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${authToken}`,
                    'Content-Type': 'application/json'
                }
            }).then((response)=>response.json());
        }catch(err){
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
        return ('Download successful');
    };
};

module.exports = LocalUpload;