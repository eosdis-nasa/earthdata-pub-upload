const CueFileUtility = require('../src/cue-utility.js');
const fs = require('fs');
const { Blob } = require('buffer');


const open = jest.fn();
const onload = jest.fn((x) => {/* <your response data> */});
const onerror = jest.fn();
const send = jest.fn(function(){
    this.onload()
})

const xhrMockClass = function () {
    return {
        open,
        send,
        onerror,
        onload
    };
};

global.XMLHttpRequest = jest.fn().mockImplementation(xhrMockClass);

// Mocking FileReader functionality
global.FileReader = class {
    constructor() {
        this.onload = null;
    }

    readAsArrayBuffer(blob) {
        const reader = new global.FileReader();
        reader.onload = () => {
            if (this.onload) {
                const view = new Uint8Array(reader.result);
                this.onload({ target: { result: view } });
            }
        };
        reader.readAsArrayBuffer(blob);
    }
};

// Mocking fetch functionality
global.fetch = jest.fn().mockImplementation((url, options) => {
    if (url.includes('success')) {
        // Mock successful response
        return Promise.resolve({
            status: 200,
            blob: () => Promise.resolve(new Blob(['fake file content'], { type: 'text/plain' }))
        });
    } else {
        // Mock failed response
        return Promise.reject(new Error('Failed to fetch'));
    }
});

// Mocking FormData
global.FormData = FormData;

global.saveAs = jest.fn();

describe('File validation', () => {
    test('validateFileType correctly identifies file types', async () => {
        // Create a CueFileUtility instance
        const upload = new CueFileUtility();
        // Mock file object
        const fileObj = { name: 'test.txt' };
        // Call validateFileType method
        const fileType = await upload.validateFileType(fileObj);
        // Assert the file type
        expect(fileType).toEqual('text/plain');
    });
});

describe('CueFileUtility', () => {
 
    it('should handle download failure', async () => {
        const authToken = 'fake-auth-token';
        const key = 'failure-key';
        const apiEndpoint = 'https://fake/api';
        
        // Create a CueFileUtility instance
        const upload = new CueFileUtility();
        
        // Call downloadFile method
        const result = await upload.downloadFile(key, apiEndpoint, authToken);
        
        // Expectations
        expect(global.fetch).toHaveBeenCalledWith(`${apiEndpoint}?key=${key}`, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            }
        });
        expect(global.saveAs).not.toHaveBeenCalled();
        expect(result).toEqual({ error: 'Download failed' });
    });
    
    it('should upload a file', async () => {
        const authToken = process.env.AUTH_TOKEN;
        const filePath = './test/test_files/test01.txt';

        // Mocking FileReader functionality
        global.FileReader = class {
            constructor() {
                this.onload = null;
            }

            readAsArrayBuffer(blob) {
                const reader = new global.FileReader();
                reader.onload = () => {
                    if (this.onload) {
                        const view = new Uint8Array(reader.result);
                        this.onload({ target: { result: view } });
                    }
                };
                reader.readAsArrayBuffer(blob);
            }
        };

        // Mocking fetch functionality
        global.fetch = jest.fn().mockResolvedValue({
            status: 204,
            json: () => Promise.resolve({
                field_id: "file_id",
                presigned_url: "https://fake-bucket.s3.amazonaws.com/fake/url"
            })
        });

        const uploadUrl = 'https://fake/upload/url';
        const mockHash = 'd41d8cd98f00b204e9800998ecf8427e';

        // Mocking fs.createReadStream
        const fStream = fs.createReadStream(filePath);
        const fileData = [];
        fStream.on('data', (chunk) => {
            fileData.push(chunk);
        });
        fStream.on('end', async () => {
            const fileObj = new Blob(fileData, { type: 'text/plain' });
            fileObj.name = filePath.split('/').pop();

            // Mocking CueFileUtility class instance
            const upload = new CueFileUtility();
            upload.generateHash = jest.fn().mockResolvedValue(mockHash);
            upload.signedPost = jest.fn().mockImplementation((url, fileObj, contentType, fileSize, onProgress)=>{
                expect(url).toEqual('https://fake-bucket.s3.amazonaws.com/fake/url');
                expect(fileObj).toEqual(fileObj);
                expect(contentType).toEqual('text/plain');
                expect(fileSize).toEqual(fileObj.size);
                expect(onProgress).toBeDefined();
                return('Upload successful');
            });

            // Mocking onProgress function
            const onProgress = jest.fn();

            // Uploading the file
            const resp = await upload.uploadFile({
                fileObj,
                apiEndpoint: uploadUrl,
                authToken
            }, onProgress);

            // Assertions
            expect(resp).toEqual(expect.objectContaining({
                file_id: expect.any(String),
                status: expect.any(String),
                message: expect.any(String)
            }));
            expect(upload.generateHash).toHaveBeenCalledWith(fileObj);
        });
    });
});