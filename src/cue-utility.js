
const hashWasm = require('hash-wasm');
const mime = require('mime/lite');
const fileSaver = require('file-saver');

const createSHA256 = hashWasm.createSHA256;
const saveAs = fileSaver.saveAs;

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

class CueFileUtility{

    chunkSize  = 8 * 1024 * 1024; // 8MB
    multiPartUploadThreshold = 100 * 1024 * 1024; // 100MB based on https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html
    maxSingleFileSize = 5 * 1024 * 1024 * 1024; // 5GB
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
        const fileType = mime.getType(fileObj.name.split('.').pop());
        if (fileType === 'application/x-msdownload'||
            fileType === 'application/octet-stream') return '';
        else return fileType;
    }

    async signedPost(url, fileObj, contentType, fileSize, onProgress) {

        // Create XMLHttpRequest object
        // This is used over fetch because it allow progress tracking
        const xhr = new XMLHttpRequest();

        // Configure progress tracking
        xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
                const percentage = Math.round((event.loaded / event.total) * 100);
                onProgress(percentage, fileObj)
            }
        };

        // Send the request
        xhr.open('PUT', url);
        xhr.setRequestHeader('Content-Type', contentType);

        // Wrap XMLHttpRequest in a promise
        const response = await new Promise((resolve, reject) => {
            xhr.onload = () => {
                if (xhr.status === 204 || xhr.status == 200) {
                    resolve(xhr);
                } else {
                    reject({ error: `Upload failed with status ${xhr.status}` });
                }
            };
            xhr.onerror = () => {
                reject({ error: 'Upload failed due to network error' });
            };
            xhr.send(fileObj);
        });
        return response;
    }

    async singleFileUpload({fileObj, apiEndpoint, authToken, submissionId, endpointParams}, onProgress) {

        const hash  = await this.generateHash(fileObj);
        const fileType = await this.validateFileType(fileObj);

        let presignedUrlResponse;
        let etag;

        try {
            presignedUrlResponse = await fetch(apiEndpoint, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${authToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    file_name: fileObj.name,
                    file_type: fileType,
                    checksum_value: hash,
                    file_size_bytes: fileObj.size,
                    ...(submissionId && {submission_id: submissionId}),
                    ...endpointParams
                })
            }).then((response)=>response.json());
            if(presignedUrlResponse.error) return ({error: presignedUrlResponse.error});
        } catch (err) {
            return ({error: "Failed to get upload URL"});
        }
        try{
            const uploadResult = await this.signedPost(presignedUrlResponse.presigned_url, fileObj, fileType, fileObj.size, onProgress);
            etag = uploadResult.getResponseHeader('ETag');
        }catch(err){
            console.error(err);
            return ({error: "Failed to upload to bucket"});
        }
        try{
            const completeResponse = await fetch(`${(new URL(apiEndpoint)).origin}/api/data/upload/complete`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${authToken}`
                },
                body: JSON.stringify({
                    file_id: presignedUrlResponse.file_id,
                    file_name: fileObj.name,
                    file_size_bytes: fileObj.size,
                    checksum_value: hash,
                    collection_path: presignedUrlResponse.collection_path,
                    content_type: fileType,
                    etags: [ { PartNumber: 1, Etag: etag}]
                })
            });
            await completeResponse.json();
        }catch(err){
            return ({error: "Unable to confirm upload to CUE"})
        }
    }

    async multiPartUpload({fileObj, apiEndpoint, authToken, submissionId, endpointParams}) {

        // const fileType = await this.validateFileType(fileObj);

        // // start multipart upload api query
        // let upload_id;
        // try {
        //     const response = await fetch(apiEndpoint, {
        //         method: 'POST',
        //         headers: {
        //             Authorization: `Bearer ${authToken}`
        //         },
        //         body: JSON.stringify({
        //             file_name: fileObj.name,
        //             content_type: fileType,
        //             ...(submissionId && {submission_id: submissionId}),
        //             ...endpointParams
        //         })
        //     });
        //     upload_id = response?.upload_id;
        // } catch (err) {
        //     console.error(err);
        //     return ({error: "Failed to start multipart upload."})
        // }
        // iterate over parts:
            // get presigned url for part
            // upload each part
        let offset = 0;
        while (offset < fileObj.size) {
            const chunk = fileObj.slice(offset, offset + this.chunkSize);

            const chunkHash = await this.hashChunk(chunk);

            offset += this.chunkSize;
        }
        // const chunkNumber = Math.floor(fileObj.size / this.chunkSize);
        // for (let i = 0; i <= chunkNumber; i++){
        //     const chunk = fileObj.slice(
        //         i * this.chunkSize,
        //         Math.min(this.chunkSize * (i + 1), fileObj.size)
        //     )
        //     await this.hashChunk(chunk);
        // }
        // complete multipart upload api query

    }

    constructor(){};

    async uploadFile(params, onProgress){

        if (params.fileObj.size > this.maxSingleFileSize) return {error: "File above max single file size of 5GB"}
        return this.singleFileUpload(params, onProgress);
        // TODO - Include multipart upload logic
        // if (params.fileObj.size < this.multiPartUploadThreshold) return this.singleFileUpload(params, onProgress);
        // return {error: "Multipart upload not implemented"}
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

module.exports = CueFileUtility;
