
const hashWasm = require('hash-wasm');
const mime = require('mime/lite');
const fileSaver = require('file-saver');

const createSHA256 = hashWasm.createSHA256;
const saveAs = fileSaver.saveAs;

// Ignoring for coverage due to an inability to meaningfully mock
// File and FileReader objects in the test environment
/* istanbul ignore next */
function uint8ToBase64(uint8) {
    const chunkSize = 0x8000; 
    let binary = "";

    for (let i = 0; i < uint8.length; i += chunkSize) {
        binary += String.fromCharCode.apply(
            null,
            uint8.subarray(i, i + chunkSize)
        );
    }
    return btoa(binary);
}

class CueFileUtility{

    chunkSize  = 100 * 1024 * 1024; // 100MB
    /* istanbul ignore next */
    hasher = null;

    // Ignoring for coverage due to an inability to meaningfully mock
    //File and FileReader objects in the test environment
    /* istanbul ignore next */
    async generateHash(fileObj) {
        if (this.hasher) {
            this.hasher.init();
        } else {
            this.hasher = await createSHA256();
        }

        // Stream the file in optimal chunks (browser native)
        const reader = fileObj.stream().getReader();

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            // Update hash incrementally
            this.hasher.update(value);
        }

        // Final digest
        const hash = this.hasher.digest('binary');

        // Convert to Base64
        const hashBase64 = uint8ToBase64(hash);

        return Promise.resolve(hashBase64);
    }


    async validateFileType(fileObj) {
        const ext = fileObj.name.split('.').pop().toLowerCase();
        let browserType = fileObj.type || "";

        // Explicit mappings for Microsoft Office file types
        const officeTypes = {
            doc:  "application/msword",
            docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",

            xls:  "application/vnd.ms-excel",
            xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",

            ppt:  "application/vnd.ms-powerpoint",
            pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        };

        // Office type
        if (officeTypes[ext]) {
            return officeTypes[ext];
        }

        // Use browser type if it's reliable
        if (
            browserType &&
            !["application/octet-stream", "application/x-msdownload"].includes(browserType)
        ) {
            return browserType;
        }

        // Try mime/lite fallback by extension
        const mimeType = mime.getType(ext);

        if (
            mimeType &&
            !["application/octet-stream", "application/x-msdownload"].includes(mimeType)
        ) {
            return mimeType;
        }

        // return a safe generic type
        return "application/octet-stream";
    }


    async signedPost(url, blobSlice, onChunkProgress) {
        
        // Create XMLHttpRequest object
        // This is used over fetch because it allow progress tracking
        const xhr = new XMLHttpRequest();

        // Configure progress tracking
        xhr.upload.onprogress = (event) => {
            let percent = 0;
            if (event.lengthComputable) {
                percent = Math.round((event.loaded / event.total) * 100);
            } else {
                percent = Math.round((event.loaded / blobSlice.size) * 100);
            }

            if (onChunkProgress) {
                onChunkProgress(percent);
            }
        };

        xhr.open('PUT', url);

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
            xhr.send(blobSlice);
        });
        return response;
    }

    // MULTIPART PARALLEL UPLOAD
    async multiPartUpload({ fileObj, apiEndpoint, authToken, submissionId, endpointParams }, onProgress) {
        const fileType = await this.validateFileType(fileObj);
        const hash = await this.generateHash(fileObj);

        // STEP 1 — START
        const startResp = await fetch(apiEndpoint, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${authToken}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                file_name: fileObj.name,
                file_type: fileType,
                checksum_value: hash,
                file_size_bytes: fileObj.size,
                ...(submissionId && { submission_id: submissionId }),
                ...endpointParams,
            }),
        }).then((r) => r.json());

        if (startResp.error) return { error: startResp.error };

        const fileId = startResp.file_id;
        const uploadId = startResp.upload_id;

        const totalSize = fileObj.size;
        const totalParts = Math.ceil(totalSize / this.chunkSize);
        const uploadedParts = [];
        const partProgress = {};

        // Concurrency limiter
        const MAX_CONCURRENCY = 5;
        let active = 0;
        let index = 1;

        const waitForSlot = async () => {
            while (active >= MAX_CONCURRENCY) {
                await new Promise((res) => setTimeout(res, 10));
            }
        };

        const uploadQueue = [];

        const runNext = async () => {
            await waitForSlot();

            if (index > totalParts) return;

            const partNumber = index++;
            active++;
            partProgress[partNumber] = 0;

            const start = (partNumber - 1) * this.chunkSize;
            const end = Math.min(start + this.chunkSize, totalSize);
            const blobSlice = fileObj.slice(start, end);

            // STEP 2A — GET PRESIGNED URL
            const presigned = await fetch(
                `${new URL(apiEndpoint).origin}/api/data/upload/multipart/getPartUrl`,
                {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${authToken}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        file_id: fileId,
                        upload_id: uploadId,
                        part_number: partNumber,
                    }),
                }
            ).then((r) => r.json());

            const presignedUrl = presigned.presigned_url;

            // STEP 2B — UPLOAD
            const uploadRes = await this.signedPost(
                presignedUrl,
                blobSlice,
                (percent) => {
                    // per-chunk progress (percent)
                    partProgress[partNumber] = percent * blobSlice.size / 100;

                    const totalUploaded = Object.values(partProgress)
                        .reduce((s, v) => s + v, 0);

                    const globalPercent = Math.min(
                        100,
                        Math.round((totalUploaded / totalSize) * 100)
                    );

                    onProgress(globalPercent, fileObj);
                }
            );

            const etag = uploadRes.getResponseHeader("ETag").replace(/"/g, "");
            uploadedParts.push({ PartNumber: partNumber, ETag: etag });

            active--;
            await runNext();
        };

        // Start initial workers
        for (let i = 0; i < MAX_CONCURRENCY && i < totalParts; i++) {
            uploadQueue.push(runNext());
        }

        await Promise.all(uploadQueue);

        // STEP 3 — COMPLETE UPLOAD
        const finalChecksum = hash;
        uploadedParts.sort((a, b) => a.PartNumber - b.PartNumber);

        const completeResp = await fetch(
            `${new URL(apiEndpoint).origin}/api/data/upload/complete`,
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${authToken}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    file_id: fileId,
                    upload_id: uploadId,
                    parts: uploadedParts,
                    file_name: fileObj.name,
                    collection_name: endpointParams.collection_name,
                    collection_path: startResp.collection_path,
                    content_type: fileType,
                    checksum: finalChecksum,
                    final_file_size: fileObj.size,
                }),
            }
        ).then((r) => r.json());

        return completeResp;
    }

    constructor(){};

    async uploadFile(params, onProgress){
        return this.multiPartUpload(params, onProgress);
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
