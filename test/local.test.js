const LocalUpload = require('../src/local.js');
const fs = require('fs');
const { Blob } = require('buffer');
const path = require('path'); // Add this line to import the 'path' module


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
        // Create a LocalUpload instance
        const upload = new LocalUpload();
        // Mock file object
        const fileObj = { name: 'test.txt' };
        // Call validateFileType method
        const fileType = await upload.validateFileType(fileObj);
        // Assert the file type
        expect(fileType).toEqual('text/plain');
    });
});

describe('LocalUpload', () => {
 
    it('should handle download failure', async () => {
        const authToken = 'fake-auth-token';
        const key = 'failure-key';
        const apiEndpoint = 'https://fake/api';
        
        // Create a LocalUpload instance
        const upload = new LocalUpload();
        
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
            status: 200,
            json: () => Promise.resolve({
                url: 'https://amz/upload/url',
                fields: {
                    key: 'ef229725-1cad-485e-a72b-a276d2ca3175/35672b6e-caeb-46b9-a6e8-74599dc07163/848bd037-b09d-4f6b-9811-3bec1fde0f0b/ISS_LIS_SC_V2.2_20230620_185353_NRT.hdf',
                    AWSAccessKeyId: 'test',
                    policy: 'test',
                    signature: 'test',
                    'Content-Type': 'text/plain'
                }
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

            // Mocking LocalUpload class instance
            const upload = new LocalUpload();
            upload.generateHash = jest.fn().mockResolvedValue(mockHash);
            upload.signedPost = jest.fn().mockResolvedValue('Upload successful');

            // Mocking onProgress function
            const onProgress = jest.fn();

            // Uploading the file
            const resp = await upload.uploadFile({
                fileObj,
                apiEndpoint: uploadUrl,
                authToken
            }, onProgress);

            // Assertions
            expect(resp).toEqual('Upload successful');
            expect(upload.generateHash).toHaveBeenCalledWith(fileObj);
            expect(upload.signedPost).toHaveBeenCalledWith(
                'https://amz/upload/url',
                {
                    key: 'ef229725-1cad-485e-a72b-a276d2ca3175/35672b6e-caeb-46b9-a6e8-74599dc07163/848bd037-b09d-4f6b-9811-3bec1fde0f0b/ISS_LIS_SC_V2.2_20230620_185353_NRT.hdf',
                    AWSAccessKeyId: 'test',
                    policy: 'test',
                    signature: 'test',
                    'Content-Type': 'text/plain'
                },
                fileObj,
                mockHash,
                null,
                onProgress
            );
        });
    });
});

