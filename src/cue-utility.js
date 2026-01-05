
const hashWasm = require("hash-wasm");
const mime = require("mime/lite");
const fileSaver = require("file-saver");

const createSHA256 = hashWasm.createSHA256;
const saveAs = fileSaver.saveAs;

/* istanbul ignore next */
function uint8ToBase64(uint8) {
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < uint8.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, uint8.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function jitter(ms) {
  const j = Math.random() * 0.3 + 0.85; // 0.85–1.15
  return Math.round(ms * j);
}

async function withRetry(fn, { retries = 5, baseDelayMs = 500, maxDelayMs = 10_000 } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn(i);
    } catch (e) {
      lastErr = e;
      if (i === retries) break;
      const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** i);
      await sleep(jitter(delay));
    }
  }
  throw lastErr;
}

class CueFileUtility {
  // Tuneables
  chunkSize = 8 * 1024 * 1024; // 16MB (safer faster than 8MB for big files; avoid >32MB in browsers)
  minConcurrency = 2;
  maxConcurrency = 8;

  REQUIRE_CHECKSUM_AT_START = true;

  constructor() {
    this.avgUploadSpeed = null;
  }

  /* ===============================
     HASHING (NO PROGRESS)
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

      // yield occasionally to keep UI responsive
      if (chunks % 8 === 0) await sleep(0);
    }

    const hashBytes = hasher.digest("binary");
    return uint8ToBase64(hashBytes);
  }

  /* ===============================
     FILE TYPE DETECTION
     =============================== */
  async validateFileType(fileObj) {
    const ext = fileObj.name.split(".").pop().toLowerCase();
    const browserType = fileObj.type || "";

    const officeTypes = {
      doc: "application/msword",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      xls: "application/vnd.ms-excel",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ppt: "application/vnd.ms-powerpoint",
      pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    };

    if (officeTypes[ext]) return officeTypes[ext];

    if (browserType && !["application/octet-stream", "application/x-msdownload"].includes(browserType)) {
      return browserType;
    }

    const mimeType = mime.getType(ext);
    if (mimeType && !["application/octet-stream", "application/x-msdownload"].includes(mimeType)) {
      return mimeType;
    }

    return "application/octet-stream";
  }

  /* ===============================
     SIGNED PART UPLOAD (XHR for progress)
     - Adds timeout + better error propagation
     =============================== */
  async signedPut(url, blobSlice, onChunkProgress, { timeoutMs = 10 * 60 * 1000 } = {}) {
    const xhr = new XMLHttpRequest();
    let lastEmit = 0;

    xhr.upload.onprogress = (event) => {
      const now = performance.now();
      if (now - lastEmit < 120) return; // throttle
      lastEmit = now;

      const percent = event.lengthComputable
        ? Math.round((event.loaded / event.total) * 100)
        : Math.round((event.loaded / blobSlice.size) * 100);

      onChunkProgress?.(percent);
    };

    return await new Promise((resolve, reject) => {
      xhr.open("PUT", url, true);
      xhr.timeout = timeoutMs;

      xhr.onload = () => {
        if (xhr.status === 200 || xhr.status === 204) resolve(xhr);
        else reject(new Error(`PUT failed status=${xhr.status}`));
      };

      xhr.onerror = () => reject(new Error("PUT network error"));
      xhr.ontimeout = () => reject(new Error("PUT timeout"));
      xhr.send(blobSlice);
    });
  }

  /* ===============================
     MAIN MULTIPART UPLOAD
     =============================== */
  async multiPartUpload({ fileObj, apiEndpoint, authToken, submissionId, endpointParams }, onProgress) {
    const totalSize = fileObj.size;
    const fileType = await this.validateFileType(fileObj);

    // Start hash in parallel, but only usable if server allows checksum at COMPLETE
    const hashPromise = this.generateHash(fileObj);

    // If checksum is required at START, wait for it here
    const checksumToStart = this.REQUIRE_CHECKSUM_AT_START ? await hashPromise : undefined;

    // ---- STEP 1: START ----
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
        ...(this.REQUIRE_CHECKSUM_AT_START ? { checksum_value: checksumToStart } : {}),
        ...(submissionId && { submission_id: submissionId }),
        ...endpointParams,
      }),
    }).then((r) => r.json());

    if (startResp?.error) return { error: startResp.error };

    const fileId = startResp.file_id;
    const uploadId = startResp.upload_id;
    const origin = new URL(apiEndpoint).origin;

    const totalParts = Math.ceil(totalSize / this.chunkSize);
    const uploadedParts = [];
    const partUploadedBytes = new Array(totalParts + 1).fill(0);

    // Adaptive concurrency state
    let targetConcurrency = Math.min(this.maxConcurrency, totalParts);
    targetConcurrency = Math.max(this.minConcurrency, targetConcurrency);

    let inFlight = 0;
    let nextPart = 1;

    const uploadStartTime = Date.now();
    let lastReportedPercent = 0;
    let lastGlobalEmit = 0;

    const calcAndEmitGlobalProgress = () => {
      const now = Date.now();
      if (now - lastGlobalEmit < 150) return;
      lastGlobalEmit = now;

      const totalUploaded = partUploadedBytes.reduce((a, b) => a + b, 0);
      const percent = Math.max(lastReportedPercent, Math.round((totalUploaded / totalSize) * 100));
      lastReportedPercent = percent;

      const elapsed = (Date.now() - uploadStartTime) / 1000;
      let etaSeconds = null;

      if (elapsed > 1 && totalUploaded > 0) {
        const speed = totalUploaded / elapsed;
        const SMOOTHING = 0.25;
        this.avgUploadSpeed = this.avgUploadSpeed
          ? this.avgUploadSpeed * (1 - SMOOTHING) + speed * SMOOTHING
          : speed;

        etaSeconds = Math.round((totalSize - totalUploaded) / this.avgUploadSpeed);
      }

      onProgress?.(
        {
          percent,
          phase: "upload",
          etaSeconds,
          uploadedBytes: totalUploaded,
          totalBytes: totalSize,
        },
        fileObj
      );
    };

    const getPartUrl = async (partNumber) => {
      return await withRetry(
        async () => {
          const presigned = await fetch(`${new URL(apiEndpoint).origin}/api/data/upload/multipart/getPartUrl`, {
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
          }).then((r) => r.json());

          if (!presigned?.presigned_url) throw new Error("Missing presigned_url");
          return presigned.presigned_url;
        },
        { retries: 4, baseDelayMs: 400 }
      );
    };

    const uploadPart = async (partNumber) => {
      const start = (partNumber - 1) * this.chunkSize;
      const end = Math.min(start + this.chunkSize, totalSize);
      const blobSlice = fileObj.slice(start, end);

      const presignedUrl = await getPartUrl(partNumber);

      const xhr = await withRetry(
        async () => {
          return await this.signedPut(
            presignedUrl,
            blobSlice,
            (pct) => {
              partUploadedBytes[partNumber] = (pct / 100) * blobSlice.size;
              calcAndEmitGlobalProgress();
            },
            { timeoutMs: 15 * 60 * 1000 }
          );
        },
        { retries: 5, baseDelayMs: 600, maxDelayMs: 12_000 }
      );

      const etagRaw = xhr.getResponseHeader("ETag");
      const etag = etagRaw ? etagRaw.replace(/"/g, "") : null;
      if (!etag) throw new Error("Missing ETag (check S3 CORS ExposeHeaders: ETag)");

      // mark fully uploaded
      partUploadedBytes[partNumber] = blobSlice.size;
      calcAndEmitGlobalProgress();

      return { PartNumber: partNumber, ETag: etag };
    };

    // Worker loop (no recursion)
    const workers = [];
    const workerFn = async () => {
      while (true) {
        const partNumber = nextPart++;
        if (partNumber > totalParts) return;

        try {
          const result = await uploadPart(partNumber);
          uploadedParts.push(result);

          // If stable, gently increase concurrency over time
          if (targetConcurrency < this.maxConcurrency && totalParts >= targetConcurrency + 1) {
            targetConcurrency += 1; // slow ramp
          }
        } catch (e) {
          // Back off concurrency on repeated errors (helps ERR_SSL_PROTOCOL_ERROR)
          targetConcurrency = Math.max(this.minConcurrency, targetConcurrency - 1);
          throw e;
        }
      }
    };

    // Launch initial workers; additional workers can be added as targetConcurrency grows
    const launchWorkersUpTo = async (n) => {
      while (workers.length < n) {
        workers.push(workerFn());
        // tiny yield so we don't starve UI
        await sleep(0);
      }
    };

    await launchWorkersUpTo(targetConcurrency);

    // As concurrency ramps, workers are already enough; we won't spawn infinite.
    // Wait for all workers to finish (if any throws, Promise.all rejects)
    try {
      await Promise.all(workers);
    } catch (e) {
      return { error: e?.message || "Upload failed" };
    }

    // ---- STEP 3: COMPLETE ----
    const finalChecksum = this.REQUIRE_CHECKSUM_AT_START ? checksumToStart : await hashPromise;
    uploadedParts.sort((a, b) => a.PartNumber - b.PartNumber);

    const completeResp = await fetch( `${new URL(apiEndpoint).origin}/api/data/upload/complete`, {
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
    }).then((r) => r.json());

    return completeResp;
  }

    constructor() {
        this.avgUploadSpeed = null;
    }

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