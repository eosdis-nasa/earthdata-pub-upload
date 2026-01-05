const hashWasm = require('hash-wasm');
const mime = require('mime/lite');
const fileSaver = require('file-saver');

const createSHA256 = hashWasm.createSHA256;
const saveAs = fileSaver.saveAs;

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

function yieldToBrowser() {
    return new Promise(resolve => setTimeout(resolve, 0));
}

class CueFileUtility {

    chunkSize = 8 * 1024 * 1024; // 8MB chunks (good for 10GB+)

    constructor() {
        this.avgUploadSpeed = null;
    }

    /* ===============================
       HASHING (PARALLEL, NO PROGRESS)
       =============================== */
    async generateHash(fileObj) {
        const hasher = await createSHA256();
        const reader = fileObj.stream().getReader();

        let chunks = 0;

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            hasher.update(value);
            chunks++;

            // Yield occasionally to keep UI responsive
            if (chunks % 5 === 0) {
                await yieldToBrowser();
            }
        }

        const hashBytes = hasher.digest('binary');
        return uint8ToBase64(hashBytes);
    }

    /* ===============================
       FILE TYPE DETECTION
       =============================== */
    async validateFileType(fileObj) {
        const ext = fileObj.name.split('.').pop().toLowerCase();
        const browserType = fileObj.type || "";

        const officeTypes = {
            doc: "application/msword",
            docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            xls: "application/vnd.ms-excel",
            xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            ppt: "application/vnd.ms-powerpoint",
            pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        };

        if (officeTypes[ext]) return officeTypes[ext];

        if (
            browserType &&
            !["application/octet-stream", "application/x-msdownload"].includes(browserType)
        ) {
            return browserType;
        }

        const mimeType = mime.getType(ext);
        if (
            mimeType &&
            !["application/octet-stream", "application/x-msdownload"].includes(mimeType)
        ) {
            return mimeType;
        }

        return "application/octet-stream";
    }

    /* ===============================
       SIGNED PART UPLOAD
       =============================== */
    async signedPost(url, blobSlice, onChunkProgress) {
        const xhr = new XMLHttpRequest();
        let lastEmit = 0;

        xhr.upload.onprogress = (event) => {
            const now = performance.now();
            if (now - lastEmit < 100) return;
            lastEmit = now;

            const percent = event.lengthComputable
                ? Math.round((event.loaded / event.total) * 100)
                : Math.round((event.loaded / blobSlice.size) * 100);

            onChunkProgress?.(percent);
        };

        xhr.open('PUT', url);

        return new Promise((resolve, reject) => {
            xhr.onload = () => {
                if (xhr.status === 200 || xhr.status === 204) resolve(xhr);
                else reject(new Error(`Upload failed: ${xhr.status}`));
            };
            xhr.onerror = () => reject(new Error("Network error"));
            xhr.send(blobSlice);
        });
    }

    /* ===============================
       MULTIPART UPLOAD (HASH + UPLOAD)
       =============================== */
    async multiPartUpload(
        { fileObj, apiEndpoint, authToken, submissionId, endpointParams },
        onProgress
    ) {
        let totalUploaded = 0;
        const totalSize = fileObj.size;
        const uploadStartTime = Date.now();
        let lastReportedPercent = 0;

        // Start hashing immediately (DO NOT await)
        const hashPromise = this.generateHash(fileObj);

        const fileType = await this.validateFileType(fileObj);

        /* ---- STEP 1: START UPLOAD ---- */
        const startResp = await fetch(apiEndpoint, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${authToken}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                file_name: fileObj.name,
                file_type: fileType,
                file_size_bytes: totalSize,
                ...(submissionId && { submission_id: submissionId }),
                ...endpointParams,
            }),
        }).then(r => r.json());

        if (startResp.error) return { error: startResp.error };

        const { file_id: fileId, upload_id: uploadId } = startResp;

        const totalParts = Math.ceil(totalSize / this.chunkSize);
        const uploadedParts = [];
        const partProgress = {};

        const MAX_CONCURRENCY = Math.min(8, totalParts); // Safe increase
        let active = 0;
        let index = 1;

        const waitForSlot = async () => {
            while (active >= MAX_CONCURRENCY) {
                await new Promise(res => setTimeout(res, 10));
            }
        };

        const runNext = async () => {
            await waitForSlot();
            if (index > totalParts) return;

            const partNumber = index++;
            active++;
            partProgress[partNumber] = 0;

            const start = (partNumber - 1) * this.chunkSize;
            const end = Math.min(start + this.chunkSize, totalSize);
            const blobSlice = fileObj.slice(start, end);

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
            ).then(r => r.json());

            const uploadRes = await this.signedPost(
                presigned.presigned_url,
                blobSlice,
                (percent) => {
                    const newUploaded = (percent / 100) * blobSlice.size;
                    const delta = newUploaded - partProgress[partNumber];

                    partProgress[partNumber] = newUploaded;
                    totalUploaded += delta;

                    const elapsed = (Date.now() - uploadStartTime) / 1000;
                    if (elapsed > 0) {
                        const speed = totalUploaded / elapsed;
                        this.avgUploadSpeed = this.avgUploadSpeed
                            ? this.avgUploadSpeed * 0.75 + speed * 0.25
                            : speed;
                    }

                    const etaSeconds = this.avgUploadSpeed
                        ? Math.round((totalSize - totalUploaded) / this.avgUploadSpeed)
                        : null;

                    const percentGlobal = Math.max(
                        lastReportedPercent,
                        Math.round((totalUploaded / totalSize) * 100)
                    );
                    lastReportedPercent = percentGlobal;

                    onProgress?.({
                        percent: percentGlobal,
                        phase: "upload",
                        etaSeconds,
                        uploadedBytes: totalUploaded,
                        totalBytes: totalSize,
                    }, fileObj);
                }
            );

            uploadedParts.push({
                PartNumber: partNumber,
                ETag: uploadRes.getResponseHeader("ETag").replace(/"/g, "")
            });

            active--;
            await runNext();
        };

        await Promise.all(
            Array.from({ length: MAX_CONCURRENCY }, runNext)
        );

        /* ---- STEP 3: COMPLETE (WAIT FOR HASH HERE) ---- */
        const finalChecksum = await hashPromise;
        uploadedParts.sort((a, b) => a.PartNumber - b.PartNumber);

        return fetch(
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
                    final_file_size: totalSize,
                }),
            }
        ).then(r => r.json());
    }

    async uploadFile(params, onProgress) {
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